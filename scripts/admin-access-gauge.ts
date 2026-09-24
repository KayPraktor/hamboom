import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

import { signAccessToken } from "@hamboom/auth-core";
import { MockGateway } from "@hamboom/billing-core";
import { databaseEnvSchema, loadEnv } from "@hamboom/config";
import {
  boardRoots,
  createBoardDoc,
  decodeMessage,
  encodeMessage,
  MSG_TYPES,
  writeElement,
  type BoardRole,
} from "@hamboom/ydoc-schema";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import pg from "pg";
import * as syncProtocol from "y-protocols/sync";
import { WebSocket } from "ws";
import * as Y from "yjs";

import { buildApp } from "../apps/api/src/app.ts";
import { loadApiConfig } from "../apps/api/src/config.ts";
import { addMember, cleanupSeed, gaugeChildEnv, RT_SEED_SECRET, seedBoard } from "./rt-seed.ts";

/**
 * ★★ سنجه‌ی `admin:access` — M6 فاز ۵ (۵٫۲ و ۵٫۳)، [ADR-066](../ARCHITECTURE_DECISIONS.md#adr-066).
 *
 * همان اسکریپتِ probeِ فاز ۱ (`admin-probe-access`) که **وضعِ پیش از رفع را با عدد ثبت کرد**
 * (staff = owner و می‌نویسد؛ تعلیق روی هیچ‌چیز اثر ندارد) — حالا با انتظارِ **برعکس** و exit 1 روی هر
 * انحراف. api‌ی واقعی (`buildApp` روی همان DB) + realtime‌ی واقعی (فرزند)، سبکِ `rt:permission`:
 *
 *   ۱٫۱  staffِ بی‌عضویت روی بوردِ **خصوصیِ** غریبه: rt-token **viewer**، realtime هم viewer اعلام می‌کند،
 *        نوشتنِ staff **رد** می‌شود (هیچ ردیفی، HB_ERROR)، سوکت باز می‌مانَد (می‌بیند، نمی‌نویسد).
 *   ۱٫۲  `users.status='suspended'`: refresh **۴۰۱ USER_SUSPENDED**، rt-token با access-tokenِ زنده **۴۰۳**،
 *        درخواستِ OTP **۲۰۰ی بی‌صدا بدونِ چالش**، دست‌دادنِ نو با rt-tokenِ قبلی **رد** —
 *        ★ و **سوکتِ از-قبل-باز هنوز می‌نویسد**: این را هم assert می‌کنیم، به‌عنوانِ **محدودیتِ مستندِ D4-الف**
 *        (ADR-066 §۴). اگر روزی گزینه‌ی M2 (بستنِ سوکت) پذیرفته شد، این انتظار عوض می‌شود — نه پنهان.
 *
 * ⚠️ سنجه گزارش می‌دهد، crash نمی‌کند (درسِ ۳ی M4): هر انتظار جدا سنجیده و آخرش جمع می‌شود.
 *
 * اجرا:  pnpm db:up && pnpm db:migrate && pnpm admin:access
 */

const PORT = 15394;
const SECRET_BYTES = new TextEncoder().encode(RT_SEED_SECRET);

function fail(message: string): never {
  process.stderr.write(`✖ سنجه خراب است: ${message}\n`);
  process.exit(1);
}
/** انتظارها — همه جمع می‌شوند، هیچ‌کدام وسطِ کار نمی‌اندازد. */
const expectations: { name: string; ok: boolean; got: string }[] = [];
function expect(name: string, ok: boolean, got: string): void {
  expectations.push({ name, ok, got });
  process.stdout.write(`  ${ok ? "✔" : "✖"} ${name} — ${got}\n`);
}
const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

function startRealtime(): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    ["--env-file-if-exists=.env", "apps/realtime/src/main.ts"],
    {
      env: gaugeChildEnv(PORT, {
        RT_SNAPSHOT_EVERY_UPDATES: "99999",
        RT_SNAPSHOT_EVERY_MS: "99999999",
      }),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return new Promise((resolve_, reject) => {
    const timer = setTimeout(() => reject(new Error("realtime در ۲۰ ثانیه بالا نیامد")), 20_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("realtime آماده است")) {
        clearTimeout(timer);
        resolve_(child);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`realtime با کد ${String(code)} بسته شد`));
    });
  });
}

interface Client {
  socket: WebSocket;
  doc: Y.Doc;
  errors: string[];
  roles: BoardRole[];
  closed: { code: number } | null;
  close(): void;
}

function connect(boardId: string, token: string): Promise<Client> {
  const doc = createBoardDoc();
  const socket = new WebSocket(`ws://127.0.0.1:${PORT}/rt?board=${boardId}&token=${token}`);
  const client: Client = {
    socket,
    doc,
    errors: [],
    roles: [],
    closed: null,
    close: () => socket.close(),
  };
  socket.on("close", (code) => {
    client.closed = { code };
  });
  socket.on("message", (data: Buffer) => {
    const message = decodeMessage(new Uint8Array(data));
    if (!message) return;
    if (message.type === MSG_TYPES.HB_ERROR) {
      client.errors.push(message.code);
      return;
    }
    if (message.type === MSG_TYPES.HB_PERMISSION) {
      client.roles.push(message.role);
      return;
    }
    if (message.type !== MSG_TYPES.SYNC) return;
    const reply = encoding.createEncoder();
    syncProtocol.readSyncMessage(
      decoding.createDecoder(message.payload),
      reply,
      doc,
      "probe",
      () => {},
    );
    if (encoding.length(reply) > 0) {
      socket.send(encodeMessage({ type: MSG_TYPES.SYNC, payload: encoding.toUint8Array(reply) }));
    }
  });
  return new Promise((resolve_, reject) => {
    socket.once("error", reject);
    socket.once("open", () => resolve_(client));
    socket.once("close", (code) =>
      reject(new Error(`سوکت پیش از باز شدن بسته شد (${String(code)})`)),
    );
  });
}

/** یک updateِ کاملاً معتبرِ Yjs (همان الگوی `rt:permission`). */
function writeSticky(id: string): Uint8Array {
  const doc = createBoardDoc();
  doc.transact(() => {
    writeElement(boardRoots(doc).elements, {
      id,
      type: "rectangle",
      x: 1,
      y: 2,
      width: 50,
      height: 50,
      angle: 0,
      index: "a1",
      frameId: null,
      groupIds: [],
      locked: false,
      strokeColor: "#1a1a1a",
      backgroundColor: "#FFF9B1",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 0,
      opacity: 100,
      roundness: null,
      seed: 1,
      version: 1,
      versionNonce: 1,
      updated: 0,
      isDeleted: false,
      boundElements: null,
      link: null,
      customData: {
        hb: { schema: 1, kind: "sticky", createdBy: "u", lastEditedBy: "u", createdAt: 0 },
      },
    } as never);
  });
  const inner = encoding.createEncoder();
  syncProtocol.writeUpdate(inner, Y.encodeStateAsUpdate(doc));
  return encodeMessage({ type: MSG_TYPES.SYNC, payload: encoding.toUint8Array(inner) });
}

/** نقشِ داخلِ rtToken (بدنه‌ی مسیر فقط توکن را می‌دهد). */
const roleOf = (jwt: string | undefined): string =>
  jwt
    ? ((
        JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString()) as {
          role?: string;
        }
      ).role ?? "?")
    : "?";

const settle = (ms = 700): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const env = loadEnv(databaseEnvSchema);
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 3 });
  const rows = async (boardId: string): Promise<number> =>
    Number(
      (
        await pool.query<{ c: string }>(
          "SELECT count(*) AS c FROM board_updates WHERE board_id=$1",
          [boardId],
        )
      ).rows[0]?.c ?? 0,
    );

  // ── seed ────────────────────────────────────────────────────────────────
  const board = await seedBoard(pool); // private، فقط مالک
  const staffId = randomUUID();
  await pool.query(
    "INSERT INTO users (id, display_name, presence_color, is_staff) VALUES ($1,'probe-staff','#10b981',true)",
    [staffId],
  );
  const editorId = await addMember(pool, board.boardId, "editor"); // کاندیدِ تعلیق
  const phone = "09120009777";
  say(
    `▶ بورد ${board.boardId} (private) · staff ${staffId.slice(0, 8)} · editor ${editorId.slice(0, 8)}`,
  );

  // api‌ی واقعی روی همان DB؛ رازِ سنجه تا rt-tokenِ api را realtime‌ی فرزند بپذیرد.
  const app = await buildApp({
    config: {
      ...loadApiConfig(),
      JWT_SECRET: RT_SEED_SECRET,
      OTP_DEV_FIXED_CODE: "424242",
      ACCESS_TOKEN_TTL_SECONDS: 900,
    },
    gateway: new MockGateway({ checkoutBaseUrl: "http://local/billing/mock/pay" }),
  });
  await app.ready();
  const realtime = await startRealtime();
  const findings: string[] = [];

  try {
    // ── ۱٫۱ staff روی بوردِ خصوصیِ غریبه ────────────────────────────────
    const staffAccess = await signAccessToken(SECRET_BYTES, staffId, 900);
    const rt = await app.inject({
      method: "GET",
      url: `/boards/${board.boardId}/rt-token`,
      headers: { authorization: `Bearer ${staffAccess}` },
    });
    const rtBody = rt.json<{ token?: string }>();
    say(
      `1.1  GET /boards/:id/rt-token as staff → ${String(rt.statusCode)} role=${roleOf(rtBody.token)}`,
    );
    if (rt.statusCode !== 200 || !rtBody.token)
      fail(`rt-token برای staff ${String(rt.statusCode)} — probe نمی‌تواند ادامه دهد`);
    const staff = await connect(board.boardId, rtBody.token);
    await settle();
    const before = await rows(board.boardId);
    staff.socket.send(writeSticky("stk_staff"));
    await settle();
    const after = await rows(board.boardId);
    say(
      `1.1  realtime announced role=${staff.roles[0] ?? "?"} · staff wrote: board_updates ${String(before)} → ${String(after)} · errors=[${staff.errors.join(",")}]`,
    );
    expect(
      "1.1a rt-token برای staff نقشِ viewer دارد (نه owner)",
      roleOf(rtBody.token) === "viewer",
      `role=${roleOf(rtBody.token)}`,
    );
    expect(
      "1.1b realtime هم viewer اعلام می‌کند (همان تابع، سمتِ WS)",
      staff.roles[0] === "viewer",
      `announced=${staff.roles[0] ?? "?"}`,
    );
    expect(
      "1.1c نوشتنِ staff رد می‌شود: هیچ ردیفی + HB_ERROR، سوکت باز (می‌بیند، نمی‌نویسد)",
      after === before && staff.errors.length > 0 && staff.closed === null,
      `board_updates ${String(before)}→${String(after)} errors=[${staff.errors.join(",")}] socket=${staff.closed ? "closed" : "OPEN"}`,
    );
    findings.push(
      `1.1 staff=${roleOf(rtBody.token)}/${staff.roles[0] ?? "?"}, write ${after > before ? "ACCEPTED" : "rejected"}`,
    );
    staff.close();

    // ── ۱٫۲ تعلیق ────────────────────────────────────────────────────────
    // ورودِ واقعیِ editor با OTP (نشست + کوکیِ refresh)، بعد بورد را باز می‌کند، بعد معلق می‌شود.
    await pool.query("UPDATE users SET phone=$1, phone_verified_at=now() WHERE id=$2", [
      phone,
      editorId,
    ]);
    await app.inject({ method: "POST", url: "/auth/otp/request", payload: { phone } });
    const verified = await app.inject({
      method: "POST",
      url: "/auth/otp/verify",
      payload: { phone, code: "424242" },
    });
    const v = verified.json<{
      accessToken: string;
      refreshToken?: string;
      user?: { id: string };
    }>();
    if (verified.statusCode !== 200 || v.user?.id !== editorId)
      fail(`ورودِ editor ${String(verified.statusCode)} / user=${String(v.user?.id)}`);
    const rtE = await app.inject({
      method: "GET",
      url: `/boards/${board.boardId}/rt-token`,
      headers: { authorization: `Bearer ${v.accessToken}` },
    });
    const rtEBody = rtE.json<{ token: string }>();
    const editor = await connect(board.boardId, rtEBody.token);
    await settle();
    const b0 = await rows(board.boardId);
    editor.socket.send(writeSticky("stk_before_suspend"));
    await settle();
    const b1 = await rows(board.boardId);
    say(
      `1.2  editor logged in (OTP) · rt-token ${String(rtE.statusCode)} role=${roleOf(rtEBody.token)} · wrote before suspension: ${String(b0)} → ${String(b1)}`,
    );

    await pool.query("UPDATE users SET status='suspended' WHERE id=$1", [editorId]);
    say("1.2  UPDATE users SET status='suspended' ✓");

    // (الف) refresh با کوکی
    const refresh = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: v.refreshToken },
    });
    const refreshCode = refresh.json<{ error?: { code?: string } }>().error?.code ?? "";
    say(
      `1.2a POST /auth/refresh after suspension → ${String(refresh.statusCode)} ${refresh.statusCode === 200 ? "(NEW ACCESS TOKEN ISSUED)" : refreshCode}`,
    );
    expect(
      "1.2a refresh بعد از تعلیق ⇒ ۴۰۱ USER_SUSPENDED + کوکی پاک",
      refresh.statusCode === 401 &&
        refreshCode === "USER_SUSPENDED" &&
        /refresh_token=;/.test(String(refresh.headers["set-cookie"] ?? "")),
      `${String(refresh.statusCode)} ${refreshCode} set-cookie=${String(refresh.headers["set-cookie"] ?? "—")}`,
    );
    // (ب) rt-token با access-tokenِ زنده
    const rtS = await app.inject({
      method: "GET",
      url: `/boards/${board.boardId}/rt-token`,
      headers: { authorization: `Bearer ${v.accessToken}` },
    });
    say(
      `1.2b GET rt-token with live access token after suspension → ${String(rtS.statusCode)} role=${roleOf(rtS.json<{ token?: string }>().token)}`,
    );
    expect(
      "1.2b rt-token با access-tokenِ زنده بعد از تعلیق ⇒ ۴۰۳ (isSuspended ⇒ null)",
      rtS.statusCode === 403,
      String(rtS.statusCode),
    );
    // (ج) OTP request برای شماره‌ی معلق — پیامک؟ (mock: چالش ساخته می‌شود؟)
    const chBefore = Number(
      (
        await pool.query<{ c: string }>(
          "SELECT count(*) AS c FROM otp_challenges WHERE destination=$1",
          [phone],
        )
      ).rows[0]?.c ?? 0,
    );
    const otp = await app.inject({ method: "POST", url: "/auth/otp/request", payload: { phone } });
    const chAfter = Number(
      (
        await pool.query<{ c: string }>(
          "SELECT count(*) AS c FROM otp_challenges WHERE destination=$1",
          [phone],
        )
      ).rows[0]?.c ?? 0,
    );
    say(
      `1.2c POST /auth/otp/request for suspended phone → ${String(otp.statusCode)} · otp_challenges ${String(chBefore)} → ${String(chAfter)} ${chAfter > chBefore ? "(CHALLENGE CREATED = SMS WOULD BE SENT)" : ""}`,
    );
    expect(
      "1.2c OTP برای شماره‌ی معلق ⇒ ۲۰۰ی بی‌صدا، بدونِ چالش (پیامکی فرستاده نمی‌شد)",
      otp.statusCode === 200 && chAfter === chBefore,
      `${String(otp.statusCode)} challenges ${String(chBefore)}→${String(chAfter)}`,
    );
    // (د) سوکتِ از-قبل-باز
    const s0 = await rows(board.boardId);
    editor.socket.send(writeSticky("stk_after_suspend"));
    await settle();
    const s1 = await rows(board.boardId);
    say(
      `1.2d already-open WS after suspension: board_updates ${String(s0)} → ${String(s1)} ${s1 > s0 ? "(STILL WRITES)" : "(rejected)"} · socket ${editor.closed ? `closed ${String(editor.closed.code)}` : "OPEN"} · errors=[${editor.errors.join(",")}]`,
    );
    // ★★ محدودیتِ مستندِ D4-الف: سوکتِ باز تا reconnect می‌نویسد. عمداً assert می‌شود تا اگر رفتار عوض شد
    //    (گزینه‌ی M2 در ADR-066 §⏳)، سند و سنجه با هم عوض شوند — نه اینکه بی‌صدا «بهتر» شود.
    expect(
      "1.2d ⚠️ سوکتِ از-قبل-باز هنوز می‌نویسد و باز است (محدودیتِ مستندِ D4-الف، ADR-066 §۴)",
      s1 > s0 && editor.closed === null,
      `board_updates ${String(s0)}→${String(s1)} socket=${editor.closed ? "closed" : "OPEN"}`,
    );
    // (ه) دست‌دادنِ نو با rt-tokenِ از قبل‌گرفته (۶۰s)
    let handshake = "n/a";
    try {
      // ★ upgradeِ WS قبل از دست‌دادنِ پروتکل موفق می‌شود (`open`)؛ ردِ دست‌دادن **بعدش** با HB_ERROR/بستن می‌آید.
      //   پس «رد» = خطای پروتکل یا بسته‌شدن، نه شکستِ `open` (probe ۱٫۲ی فاز ۱ این را درشت می‌دید).
      const again = await connect(board.boardId, rtEBody.token);
      await settle(700);
      handshake =
        again.errors.length > 0 || again.closed !== null
          ? `rejected (errors=[${again.errors.join(",")}] socket=${again.closed ? `closed ${String(again.closed.code)}` : "OPEN"})`
          : `ACCEPTED role=${again.roles[0] ?? "?"}`;
      again.close();
    } catch (e) {
      handshake = `rejected (${e instanceof Error ? e.message : String(e)})`;
    }
    say(`1.2e new handshake with the pre-suspension rt-token → ${handshake}`);
    expect(
      "1.2e دست‌دادنِ نو با rt-tokenِ پیش از تعلیق ⇒ رد (currentRole از DB ⇒ null)",
      handshake.startsWith("rejected"),
      handshake,
    );
    findings.push(
      `1.2 refresh=${String(refresh.statusCode)} rt-token=${String(rtS.statusCode)} otp-challenge=${chAfter > chBefore ? "created" : "none"} open-ws=${s1 > s0 ? "writes" : "rejected"} handshake=${handshake.split(" ")[0]}`,
    );
    editor.close();
  } finally {
    realtime.kill("SIGKILL");
    await app.close();
    await pool.query("UPDATE users SET status='active' WHERE id=$1", [editorId]);
    await cleanupSeed(pool, board);
    // ورودِ OTP برای editor تیمِ شخصی ساخته (owner_user_id RESTRICT) — اول تیم‌ها، بعد کاربرها.
    await pool.query("DELETE FROM teams WHERE owner_user_id = ANY($1::uuid[])", [
      [staffId, editorId],
    ]);
    await pool.query("DELETE FROM otp_challenges WHERE destination = $1", [phone]);
    // ردیف‌های auditِ این اجرا (support.board.view با actor=staff) — FK RESTRICT روی actor.
    await pool.query("DELETE FROM audit_logs WHERE actor_user_id = ANY($1::uuid[])", [
      [staffId, editorId],
    ]);
    await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[staffId, editorId]]);
    await pool.end();
  }

  say("\n── اندازه‌گیری‌شده ──");
  for (const f of findings) say(`  • ${f}`);
  const failed = expectations.filter((e) => !e.ok);
  say(
    failed.length === 0
      ? `\n✔ admin:access — هر ${String(expectations.length)} انتظار روی api+realtime‌ی واقعی برآورده شد (staff ⇒ viewer، تعلیق fail-closed در نقاطِ ورود، WSِ باز = محدودیتِ مستند).`
      : `\n✖ admin:access — ${String(failed.length)} از ${String(expectations.length)} انتظار برآورده نشد:\n${failed.map((e) => `  • ${e.name} — ${e.got}`).join("\n")}`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

void main().catch((error: unknown) => {
  if (error instanceof AggregateError)
    for (const inner of error.errors) process.stderr.write(`  ↳ ${String(inner)}\n`);
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
