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
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import pg from "pg";
import * as syncProtocol from "y-protocols/sync";
import { WebSocket } from "ws";
import * as Y from "yjs";

/**
 * ★★ معیارِ پذیرشِ گام ۴٫۷ — **دو پروسه‌ی سرورِ واقعی روی یک Redis**.
 *
 * «کلاینت A به نود ۱ و B به نود ۲؛ تغییرِ A در B دیده می‌شود؛ `board_updates`
 * **هیچ ردیفِ تکراری** ندارد (اثباتِ قفلِ صاحب).»
 *
 * ── چرا این یکی حتماً باید **دو فرایند** باشد ─────────────────────────
 *
 * تستِ واحدِ خوشه دو `RoomManager` را در **یک** فرایند می‌سازد. آن ادعا لازم است
 * ولی سه چیز را نمی‌تواند بسنجد:
 *
 * ۱. **انحصارِ واقعی**: قفلِ حافظه‌ای بینِ دو پروسه مشترک نیست. فقط `SET NX` روی
 *    Redisِ واقعی ثابت می‌کند دو نود همزمان صاحب نمی‌شوند.
 * ۲. **کانالِ واقعی**: pub/sub، دو اتصال، و codecِ روی سیم.
 * ۳. **ردیفِ تکراری**: فقط با شمردنِ `board_updates`ِ واقعی دیده می‌شود.
 *
 * ⚠️ و درسِ ۴٫۳ تا ۴٫۶ همین بود: هر چهار سنجه‌ی زنده باگی گرفتند که همه‌ی
 * تست‌های واحد سبز از رویش رد شده بودند.
 *
 * اجرا:
 *   pnpm db:up && pnpm db:migrate
 *   pnpm rt:cluster
 */

const SECRET = "hamboom-cluster-secret-at-least-32-chars-ok";
const PORT_ONE = 15395;
const PORT_TWO = 15396;
const GESTURES = 40;

function fail(message: string): never {
  process.stderr.write(`✖ ${message}\n`);
  process.exit(1);
}

function startServer(port: number, label: string): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    ["--env-file-if-exists=.env", "apps/realtime/src/main.ts"],
    {
      env: {
        ...process.env,
        RT_PORT: String(port),
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
    const timer = setTimeout(() => reject(new Error(`${label} در ۲۰ ثانیه بالا نیامد`)), 20_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split("\n")) {
        if (line.trim() && !line.includes("realtime آماده است")) {
          process.stdout.write(`  │${label} ${line.trim()}\n`);
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
      reject(new Error(`${label} با کد ${String(code)} بسته شد`));
    });
  });
}

interface Client {
  socket: WebSocket;
  doc: Y.Doc;
  awareness: Awareness;
  clientId: number;
  ephemeral: number;
  save(): { save: string; seq: number } | null;
  peers(): number[];
  announce(): void;
  close(): void;
}

function connect(port: number, boardId: string, token: string, name: string): Promise<Client> {
  const doc = createBoardDoc();
  const awareness = new Awareness(doc);
  awareness.setLocalState({ user: { name } });

  const socket = new WebSocket(`ws://127.0.0.1:${port}/rt?board=${boardId}&token=${token}`);
  const state = { ephemeral: 0, save: null as { save: string; seq: number } | null };

  socket.on("message", (data: Buffer) => {
    const message = decodeMessage(new Uint8Array(data));
    if (!message) return;
    if (message.type === MSG_TYPES.HB_ROOM_INFO) {
      state.save = { save: message.save, seq: message.seq };
      return;
    }
    if (message.type === MSG_TYPES.HB_EPHEMERAL) {
      state.ephemeral++;
      return;
    }
    if (message.type === MSG_TYPES.AWARENESS) {
      applyAwarenessUpdate(awareness, message.payload, "server");
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
        awareness,
        clientId: doc.clientID,
        get ephemeral() {
          return state.ephemeral;
        },
        save: () => state.save,
        peers: () => [...awareness.getStates().keys()].filter((id) => id !== doc.clientID),
        announce() {
          socket.send(
            encodeMessage({
              type: MSG_TYPES.AWARENESS,
              payload: encodeAwarenessUpdate(awareness, [doc.clientID]),
            }),
          );
        },
        close: () => socket.close(),
      }),
    );
  });
}

function sticky(id: string, index: number) {
  return {
    id,
    type: "rectangle",
    x: index,
    y: index,
    width: 40,
    height: 40,
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
  } as never;
}

/** یک ژستِ واقعی از سندِ محلیِ همان کلاینت. */
function gesture(client: Client, id: string, index: number): void {
  const before = Y.encodeStateVector(client.doc);
  client.doc.transact(() => {
    writeElement(boardRoots(client.doc).elements, sticky(id, index));
  });
  const inner = encoding.createEncoder();
  syncProtocol.writeUpdate(inner, Y.encodeStateAsUpdate(client.doc, before));
  client.socket.send(
    encodeMessage({ type: MSG_TYPES.SYNC, payload: encoding.toUint8Array(inner) }),
  );
}

const settle = (ms = 900): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

  const one = await startServer(PORT_ONE, "۱");
  const two = await startServer(PORT_TWO, "۲");

  const alice = await connect(PORT_ONE, boardId, token("editor"), "الف");
  const bob = await connect(PORT_TWO, boardId, token("editor"), "ب");
  await settle();

  // ── ۱) ★★ تغییرِ نودِ ۱ در نودِ ۲ دیده می‌شود ─────────────────────
  gesture(alice, "stk_from_alice", 1);
  await settle();
  if (!boardRoots(bob.doc).elements.has("stk_from_alice")) {
    fail("کلاینتِ نودِ ۲ تغییرِ نودِ ۱ را ندید. گام قبول نیست.");
  }

  gesture(bob, "stk_from_bob", 2);
  await settle();
  if (!boardRoots(alice.doc).elements.has("stk_from_bob")) {
    fail("کلاینتِ نودِ ۱ تغییرِ نودِ ۲ را ندید. گام قبول نیست.");
  }
  process.stdout.write("✔ تغییرِ هر نود روی نودِ دیگر دیده شد\n");

  // ── ۲) ★ حضور و ephemeral هم از گذرگاه رد می‌شوند ────────────────
  alice.announce();
  bob.announce();
  await settle();
  if (!alice.peers().includes(bob.clientId) || !bob.peers().includes(alice.clientId)) {
    fail("حضور بینِ دو نود پخش نشد. گام قبول نیست.");
  }

  const seenBefore = bob.ephemeral;
  alice.socket.send(
    encodeMessage({
      type: MSG_TYPES.HB_EPHEMERAL,
      clientId: alice.clientId,
      payload: '{"kind":"laser"}',
    }),
  );
  await settle();
  if (bob.ephemeral <= seenBefore) {
    fail("ephemeral بینِ دو نود پخش نشد. گام قبول نیست.");
  }
  process.stdout.write("✔ حضور و ephemeral هم بینِ نودها رد شدند\n");

  // ── ۳) ★★ بارِ همزمان از هر دو نود ───────────────────────────────
  for (let i = 0; i < GESTURES; i++) {
    gesture(alice, `stk_a_${String(i)}`, i);
    gesture(bob, `stk_b_${String(i)}`, i);
    await new Promise((tick) => setTimeout(tick, 15));
  }
  await settle(2000);

  // ── ۴) ★★ هیچ ردیفِ تکراری — اثباتِ قفلِ صاحب ─────────────────────
  const duplicates = await db.query<{ seq: string; n: string }>(
    `SELECT seq, COUNT(*) AS n FROM board_updates
     WHERE board_id = $1 GROUP BY seq HAVING COUNT(*) > 1`,
    [boardId],
  );
  if (duplicates.rowCount !== 0) {
    fail(`${String(duplicates.rowCount)} شماره‌ی تکراری در board_updates. قفلِ صاحب کار نکرد.`);
  }

  const rows = await db.query<{ count: string; max: string }>(
    "SELECT COUNT(*) AS count, COALESCE(MAX(seq), 0) AS max FROM board_updates WHERE board_id = $1",
    [boardId],
  );
  const count = Number(rows.rows[0]?.count ?? 0);
  const max = Number(rows.rows[0]?.max ?? 0);
  if (count !== max) {
    // ⚠️ شکاف در `seq` یعنی یک نوشتن افتاده — چیزی که ایندکسِ یکتا وقتی دو نود
    //    همزمان می‌نویسند تولید می‌کند.
    fail(`لاگ سوراخ است: ${count} ردیف ولی بزرگ‌ترین seq برابرِ ${max}. گام قبول نیست.`);
  }
  process.stdout.write(`✔ ${count} ردیف، بدونِ تکرار و بدونِ شکاف در seq\n`);

  // ── ۵) ★★ و هر دو کلاینت **همان** سند را دارند ───────────────────
  const expected = 2 + GESTURES * 2;
  const aliceCount = boardRoots(alice.doc).elements.size;
  const bobCount = boardRoots(bob.doc).elements.size;
  if (aliceCount !== expected || bobCount !== expected) {
    fail(`عناصر: الف=${aliceCount}، ب=${bobCount}، انتظار=${expected}. گام قبول نیست.`);
  }

  // ── ۶) ★ «ذخیره شد» روی **هر دو** نود صادق است ───────────────────
  //
  // ⚠️ نودِ غیرِ صاحب خودش نمی‌نویسد؛ اگر بدونِ پیامِ صاحب ادعای دوام کند،
  //    ADR-009 شکسته است.
  for (const [name, client] of [
    ["الف", alice],
    ["ب", bob],
  ] as const) {
    const save = client.save();
    if (save?.save !== "saved") {
      fail(`کلاینتِ ${name} در وضعیتِ ${save?.save ?? "نامعلوم"} مانده. گام قبول نیست.`);
    }
    if (save.seq !== max) {
      fail(`کلاینتِ ${name} تا seq=${save.seq} می‌داند ولی دیتابیس ${max} دارد.`);
    }
  }
  process.stdout.write(`✔ هر دو کلاینت ${expected} عنصر دارند و «ذخیره شد» تا seq=${max}\n`);

  // ── ۷) ★★ و بعد از **مرگِ صاحب**، کار از دست نمی‌رود ──────────────
  //
  // ⚠️ نودی که صاحب نیست نمی‌نویسد؛ اگر صاحب بمیرد و نودِ بعدی کارِ در حافظه را
  //    ننویسد، همه‌چیزِ نانوشته می‌رود. صاحبِ تازه اول حالتِ کامل را می‌نویسد.
  one.kill("SIGKILL");
  await new Promise((r) => one.once("exit", r));
  process.stdout.write("✔ نودِ ۱ با SIGKILL کشته شد\n");

  gesture(bob, "stk_after_death", 99);
  // اجاره ۳۰ ثانیه است؛ نودِ ۲ باید در همین بازه صاحب شود.
  const deadline = Date.now() + 45_000;
  let survived = false;
  while (Date.now() < deadline) {
    const found = await db.query(
      "SELECT 1 FROM board_updates WHERE board_id = $1 AND seq > $2 LIMIT 1",
      [boardId, max],
    );
    if (found.rowCount && found.rowCount > 0) {
      survived = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!survived) {
    fail("بعد از مرگِ صاحب، هیچ نوشتنِ تازه‌ای ثبت نشد. گام قبول نیست.");
  }
  process.stdout.write("✔ نودِ ۲ صاحب شد و نوشتن ادامه یافت\n");

  alice.close();
  bob.close();
  await db.end();
  two.kill("SIGKILL");

  process.stdout.write("\n✔ خوشه تایید شد.\n");
  process.exit(0);
}

void main().catch((error: unknown) => {
  if (error instanceof AggregateError) {
    for (const inner of error.errors) process.stderr.write(`  ↳ ${String(inner)}\n`);
  }
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
