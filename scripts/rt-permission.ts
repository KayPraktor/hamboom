import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

import { databaseEnvSchema, loadEnv } from "@hamboom/config";
import { signDevToken } from "@hamboom/realtime";
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

/**
 * ★★ معیارِ پذیرشِ گام ۴٫۵ — **تستِ مهاجم، روی سیمِ واقعی**.
 *
 * «یک کلاینت با نقشِ `viewer` مستقیماً یک updateِ باینریِ معتبرِ Yjs می‌فرستد
 * (دور زدنِ UI) → **سرور ردش می‌کند و سند تغییر نمی‌کند**.»
 *
 * ── چرا اینجا هم اسکریپت، در حالی که تستِ واحدش هست ────────────────────
 *
 * تستِ واحد `room.ts` را با سوکتِ ساختگی می‌سنجد. آن ادعا لازم است ولی کافی
 * نیست، چون **سه چیزِ دیگر** فقط اینجا دیده می‌شوند:
 *
 * ۱. updateِ رد‌شده به **دیتابیس** هم نرسیده باشد (`board_updates` نباید رشد کند).
 * ۲. به **همتای واقعی** هم پخش نشده باشد.
 * ۳. مسیرِ کاملِ `ws` → `server.ts` → `room.ts` واقعاً از گیت رد می‌شود، نه فقط
 *    تابعی که تست مستقیم صدایش می‌زند.
 *
 * ⚠️ و درسِ گام‌های ۴٫۳ و ۴٫۴ همین بود: هر دو باگی گرفتند که همه‌ی تست‌های واحد
 * سبز از رویش رد شده بودند. برای یک گیتِ **امنیتی** این ریسک را نمی‌شود پذیرفت.
 *
 * اجرا:
 *   pnpm db:up && pnpm db:migrate
 *   pnpm rt:permission
 */

const SECRET = "hamboom-permission-secret-at-least-32-chars";
const PORT = 15393;

function fail(message: string): never {
  process.stderr.write(`✖ ${message}\n`);
  process.exit(1);
}

function startServer(): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    ["--env-file-if-exists=.env", "apps/realtime/src/main.ts"],
    {
      env: {
        ...process.env,
        RT_PORT: String(PORT),
        RT_DEV_JWT_SECRET: SECRET,
        RT_SNAPSHOT_DIR: ".hamboom/snapshots-probe",
        RT_SNAPSHOT_EVERY_UPDATES: "99999",
        RT_SNAPSHOT_EVERY_MS: "99999999",
        APP_ENV: "local",
        LOG_LEVEL: "info",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  return new Promise((resolve_, reject) => {
    const timer = setTimeout(() => reject(new Error("سرور در ۲۰ ثانیه بالا نیامد")), 20_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split("\n")) {
        if (line.trim() && !line.includes("realtime آماده است")) {
          process.stdout.write(`  │ ${line.trim()}\n`);
        }
      }
      if (text.includes("realtime آماده است")) {
        clearTimeout(timer);
        resolve_(child);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`سرور با کد ${String(code)} بسته شد`));
    });
  });
}

interface Client {
  socket: WebSocket;
  doc: Y.Doc;
  /** کدهای `HB_ERROR`ی که سرور فرستاده. */
  errors: string[];
  /** نقش‌هایی که سرور با `HB_PERMISSION` اعلام کرده. */
  roles: BoardRole[];
  seq(): number;
  close(): void;
}

function connect(boardId: string, token: string, doc: Y.Doc): Promise<Client> {
  const socket = new WebSocket(`ws://127.0.0.1:${PORT}/rt?board=${boardId}&token=${token}`);
  const errors: string[] = [];
  const roles: BoardRole[] = [];
  let latestSeq = 0;

  socket.on("message", (data: Buffer) => {
    const message = decodeMessage(new Uint8Array(data));
    if (!message) return;
    if (message.type === MSG_TYPES.HB_ERROR) {
      errors.push(message.code);
      return;
    }
    if (message.type === MSG_TYPES.HB_PERMISSION) {
      roles.push(message.role);
      return;
    }
    if (message.type === MSG_TYPES.HB_ROOM_INFO) {
      latestSeq = message.seq;
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
    socket.once("open", () =>
      resolve_({
        socket,
        doc,
        errors,
        roles,
        seq: () => latestSeq,
        close: () => socket.close(),
      }),
    );
  });
}

/**
 * ★ بایت‌های یک updateِ **کاملاً معتبرِ** Yjs — ساخته‌شده بیرونِ هر UI.
 *
 * ⚠️ حالتِ کامل و نه دیفِ افزایشی: وگرنه Yjs آن را در `pendingStructs` بایگانی
 * می‌کند و «سند عوض نشد» هیچ‌چیز را اثبات نمی‌کرد.
 */
function attack(id: string): Uint8Array {
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

const settle = (ms = 600): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const env = loadEnv(databaseEnvSchema);
  const boardId = randomUUID();
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = (role: BoardRole): string =>
    signDevToken({ sub: randomUUID(), boardId, role, exp }, SECRET);

  process.stdout.write(`▶ بورد: ${boardId}\n`);

  const db = new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  });
  await db.connect();
  const rowCount = async (): Promise<number> => {
    const result = await db.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM board_updates WHERE board_id = $1",
      [boardId],
    );
    return Number(result.rows[0]?.count ?? 0);
  };

  const server = await startServer();

  // ── ۱) یک editorِ واقعی که همتا هم هست ──────────────────────────
  const editorDoc = createBoardDoc();
  const editor = await connect(boardId, token("editor"), editorDoc);
  await settle();

  const before = await rowCount();
  editor.socket.send(attack("stk_legit"));
  await settle();

  // ⚠️ **اثر را روی سرور بسنج، نه روی سندِ خودِ فرستنده.** سرور پخش را از
  //    فرستنده جدا می‌کند (`session !== from`)، پس سندِ محلیِ editor چیزی که
  //    خودش فرستاده را پس نمی‌گیرد. نسخه‌ی اولِ این سنجه همین را اشتباه گرفت و
  //    قبل از رسیدن به ادعای امنیتی افتاد.
  const baselineRows = await rowCount();
  if (baselineRows <= before) {
    fail("نوشتنِ خودِ editor هم ثبت نشد — سنجه پیش از ادعای امنیتی خراب است.");
  }
  process.stdout.write(`✔ editor نوشت؛ ${baselineRows} ردیف در board_updates\n`);

  // ── ۲) ★★ حمله: viewer همان بایت‌ها را مستقیم می‌فرستد ───────────
  const viewerDoc = new Y.Doc();
  const viewer = await connect(boardId, token("viewer"), viewerDoc);
  await settle();

  if (viewer.roles[0] !== "viewer") {
    fail(`سرور نقش را اعلام نکرد (${viewer.roles.join(",") || "هیچ"}). گام قبول نیست.`);
  }
  process.stdout.write("✔ سرور در لحظه‌ی اتصال نقش را اعلام کرد: viewer\n");

  // ★ تماشاگر باید بورد را **ببیند** — وگرنه نقشش بی‌معنا است.
  if (!boardRoots(viewerDoc).elements.has("stk_legit")) {
    fail("viewer بورد را نگرفت — رد کردنِ خواندن هم به‌اندازه‌ی پذیرفتنِ نوشتن غلط است.");
  }
  process.stdout.write("✔ viewer بورد را کامل گرفت (خواندن باز است)\n");

  viewer.socket.send(attack("stk_attack"));
  await settle();

  // ── ۳) سه ادعا، هر سه باید برقرار باشند ─────────────────────────
  if (boardRoots(viewerDoc).elements.has("stk_attack")) {
    fail("سند از دیدِ خودِ مهاجم عوض شد. گام قبول نیست.");
  }
  if (boardRoots(editorDoc).elements.has("stk_attack")) {
    fail("updateِ مهاجم به همتا پخش شد. گام قبول نیست.");
  }
  const afterRows = await rowCount();
  if (afterRows !== baselineRows) {
    fail(`updateِ مهاجم پایدار شد (${baselineRows} → ${afterRows} ردیف). گام قبول نیست.`);
  }
  if (!viewer.errors.includes("FORBIDDEN")) {
    fail(`سرور FORBIDDEN نفرستاد (خطاها: ${viewer.errors.join(",") || "هیچ"}). گام قبول نیست.`);
  }
  if (viewer.socket.readyState !== WebSocket.OPEN) {
    fail("اتصالِ viewer بسته شد — تنزلِ نقش حمله نیست (ADR-038). گام قبول نیست.");
  }
  process.stdout.write(
    `✔ رد شد: نه در سند، نه در دیتابیس (${afterRows} ردیف)، نه نزدِ همتا — و اتصال باز مانْد\n`,
  );

  // ── ۴) و editor هنوز کار می‌کند ─────────────────────────────────
  const rowsBeforeLast = await rowCount();
  editor.socket.send(attack("stk_after"));
  await settle();
  if ((await rowCount()) <= rowsBeforeLast || !boardRoots(viewerDoc).elements.has("stk_after")) {
    fail("بعد از ردِ مهاجم، editor هم نتوانست بنویسد. گام قبول نیست.");
  }
  process.stdout.write("✔ editor بعدش هم نوشت — گیت فقط جلوی بی‌مجوز را گرفت\n");

  viewer.close();
  editor.close();
  await db.end();
  server.kill("SIGKILL");

  process.stdout.write("\n✔ اعمالِ مجوز تایید شد.\n");
  process.exit(0);
}

void main().catch((error: unknown) => {
  // ⚠️ `String(error)` روی `AggregateError` فقط «AggregateError» می‌دهد — یعنی
  //    هیچ. علت‌های تودرتو را باز کن، وگرنه دیباگ کور است.
  if (error instanceof AggregateError) {
    for (const inner of error.errors)
      process.stderr.write(`  ↳ ${String(inner)}
`);
  }
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
