import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

import { databaseEnvSchema, loadEnv } from "@hamboom/config";
import { signDevToken } from "@hamboom/realtime";
import { decodeMessage, encodeMessage, MSG_TYPES, type BoardRole } from "@hamboom/ydoc-schema";
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import pg from "pg";
import * as syncProtocol from "y-protocols/sync";
import { WebSocket } from "ws";
import * as Y from "yjs";

/**
 * ★★ معیارِ پذیرشِ گام ۴٫۶ — **حضور و ephemeral، روی سیمِ واقعی**.
 *
 * «تستی که بعد از هزار پیامِ ephemeral، `board_updates` **صفر ردیفِ جدید** دارد؛
 * و قطعِ ناگهانیِ کلاینت مکان‌نمایش را از بقیه پاک می‌کند.»
 *
 * ── ★ چرا این یکی **باید** زنده باشد ──────────────────────────────────
 *
 * `canvas-sync/CLAUDE.md` از گام ۳٫۵ این را پین کرده بود: جاروی ۳۰ثانیه‌ایِ
 * awareness با زمان‌بندِ ساختگی آزمودنی **نیست**، چون `lib0/time` مقدارِ
 * `Date.now` را در لحظه‌ی بارگذاریِ ماژول می‌گیرد — «مسیرِ واقعی هم همان نیست:
 * در فاز ۴ **سرور** قطعِ سوکت را می‌بیند و حذف را پخش می‌کند».
 *
 * ★ اینجا همان جاست. و «قطعِ ناگهانی» یعنی `terminate()` — نه `close()`ِ مودبانه،
 * که به سرور فرصتِ خداحافظی می‌دهد و چیزی را که ادعا کرده‌ایم نمی‌سنجد.
 *
 * ⚠️ و «صفر ردیف» را باید در **خودِ Postgres** شمرد: لاگِ حافظه‌ای می‌تواند سبز
 * باشد در حالی که مسیرِ واقعی چیزی می‌نویسد (درسِ گام‌های ۴٫۳ تا ۴٫۵).
 *
 * اجرا:
 *   pnpm db:up && pnpm db:migrate
 *   pnpm rt:presence
 */

const SECRET = "hamboom-presence-secret-at-least-32-chars-x";
const PORT = 15394;
const EPHEMERAL_COUNT = 1000;

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
  awareness: Awareness;
  clientId: number;
  /** پیام‌های ephemeralِ رسیده — سرور نباید هیچ‌کدام را ذخیره کند. */
  ephemeral: { clientId: number; payload: string }[];
  users(): number;
  /** حاضرانِ دیگر، از دیدِ همین کلاینت. */
  peers(): number[];
  announce(state: Record<string, unknown>): void;
  close(): void;
}

function connect(boardId: string, token: string, name: string): Promise<Client> {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  awareness.setLocalState({ user: { name } });

  const socket = new WebSocket(`ws://127.0.0.1:${PORT}/rt?board=${boardId}&token=${token}`);
  const ephemeral: { clientId: number; payload: string }[] = [];
  let users = 0;

  socket.on("message", (data: Buffer) => {
    const message = decodeMessage(new Uint8Array(data));
    if (!message) return;
    if (message.type === MSG_TYPES.HB_ROOM_INFO) {
      users = message.users;
      return;
    }
    if (message.type === MSG_TYPES.HB_EPHEMERAL) {
      ephemeral.push({ clientId: message.clientId, payload: message.payload });
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
        awareness,
        clientId: doc.clientID,
        ephemeral,
        users: () => users,
        peers: () => [...awareness.getStates().keys()].filter((id) => id !== doc.clientID),
        announce(state) {
          for (const [key, value] of Object.entries(state)) {
            awareness.setLocalStateField(key, value);
          }
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

const settle = (ms = 700): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

  const alice = await connect(boardId, token("editor"), "الف");
  const bob = await connect(boardId, token("viewer"), "ب");
  await settle();

  // ── ۱) همدیگر را می‌بینند ───────────────────────────────────────
  alice.announce({ cursor: { x: 10, y: 20 } });
  bob.announce({ cursor: { x: 30, y: 40 } });
  await settle();

  if (!alice.peers().includes(bob.clientId) || !bob.peers().includes(alice.clientId)) {
    fail("دو کلاینت همدیگر را ندیدند. گام قبول نیست.");
  }
  if (alice.users() !== 2) {
    fail(`HB_ROOM_INFO.users برابرِ ${alice.users()} است، نه ۲. گام قبول نیست.`);
  }
  process.stdout.write("✔ هر دو همدیگر را می‌بینند و users=۲ اعلام شد\n");

  // ── ۲) ★★ هزار پیامِ ephemeral، صفر ردیف ────────────────────────
  const before = await rowCount();
  for (let i = 0; i < EPHEMERAL_COUNT; i++) {
    alice.socket.send(
      encodeMessage({
        type: MSG_TYPES.HB_EPHEMERAL,
        clientId: alice.clientId,
        payload: `{"kind":"stroke","i":${String(i)}}`,
      }),
    );
  }
  await settle(1500);

  const after = await rowCount();
  if (after !== before) {
    fail(`ephemeral پایدار شد (${before} → ${after} ردیف). گام قبول نیست.`);
  }
  if (bob.ephemeral.length !== EPHEMERAL_COUNT) {
    fail(`همتا ${bob.ephemeral.length} پیام گرفت، نه ${EPHEMERAL_COUNT}. گام قبول نیست.`);
  }
  process.stdout.write(
    `✔ ${EPHEMERAL_COUNT} پیامِ ephemeral پخش شد و board_updates همان ${after} ردیف مانْد\n`,
  );

  // ── ۳) ★★ قطعِ **ناگهانی** — نه خداحافظیِ مودبانه ────────────────
  //
  // ⚠️ `terminate()` و نه `close()`: با بستنِ مودبانه سرور فرصتِ تشریفات دارد و
  //    چیزی را می‌سنجیم که ادعا نکرده‌ایم. ادعا این است که **قطعِ برق** هم
  //    مکان‌نما را پاک می‌کند.
  bob.socket.terminate();
  await settle();

  if (alice.peers().includes(bob.clientId)) {
    fail("بعد از قطعِ ناگهانی، مکان‌نمای همتا هنوز روی بومِ بقیه است. گام قبول نیست.");
  }
  if (alice.users() !== 1) {
    fail(`بعد از خروج، users برابرِ ${alice.users()} است، نه ۱. گام قبول نیست.`);
  }
  process.stdout.write("✔ قطعِ ناگهانی: مکان‌نما فوراً پاک شد و users=۱ شد\n");

  // ── ۴) و بعدش همه‌چیز سالم است ──────────────────────────────────
  const carol = await connect(boardId, token("editor"), "ج");
  await settle();
  carol.announce({ cursor: { x: 1, y: 1 } });
  await settle();

  if (!alice.peers().includes(carol.clientId) || !carol.peers().includes(alice.clientId)) {
    fail("کلاینتِ تازه حاضرانِ قبلی را ندید. گام قبول نیست.");
  }
  process.stdout.write("✔ کلاینتِ تازه حاضرانِ قبلی را دید\n");

  alice.close();
  carol.close();
  await db.end();
  server.kill("SIGKILL");

  process.stdout.write("\n✔ حضور و ephemeral تایید شد.\n");
  process.exit(0);
}

void main().catch((error: unknown) => {
  if (error instanceof AggregateError) {
    for (const inner of error.errors) process.stderr.write(`  ↳ ${String(inner)}\n`);
  }
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
