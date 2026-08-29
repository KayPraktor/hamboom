import { randomUUID } from "node:crypto";

import {
  createMemoryBoardAccessReader,
  type MemoryBoardAccessReader,
  signRtToken,
} from "@hamboom/auth-core";
import { databaseEnvSchema, loadEnv, redisEnvSchema, s3EnvSchema } from "@hamboom/config";
import {
  createCompactor,
  createPersistedBoardStore,
  createPgPool,
  createPostgresSnapshotCatalog,
  createPostgresUpdateLog,
  createRealtimeAuthority,
  createRedisBoardBus,
  createRedisOwnerLock,
  createRoomManager,
  createRtServer,
  createStorageSnapshotStore,
  gracefulShutdown,
  type RtServer,
} from "@hamboom/realtime";
import { createS3ObjectStore } from "@hamboom/storage";
import {
  boardRoots,
  createBoardDoc,
  decodeMessage,
  encodeMessage,
  MSG_TYPES,
  writeElement,
} from "@hamboom/ydoc-schema";
import Redis from "ioredis";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import pg from "pg";
import * as syncProtocol from "y-protocols/sync";
import { WebSocket } from "ws";
import * as Y from "yjs";

import { addMember, cleanupSeed, seedBoard } from "./rt-seed.ts";

/**
 * ★★ معیارِ پذیرشِ گام ۴٫۸ — **خاموشیِ مودبانه**.
 *
 * «`SIGTERM` → سند snapshot می‌شود، کلاینت‌ها کدِ ۱۰۰۱ می‌گیرند، و **هیچ updateای
 * گم نمی‌شود**.»
 *
 * ── ⚠️ چرا این یکی سرور را **در همین فرایند** بالا می‌آورد ─────────────
 *
 * چهار سنجه‌ی قبلی سرور را با `spawn` بالا می‌آوردند. اینجا نمی‌شود، و دلیلش
 * محیط است نه سلیقه: **روی ویندوز `child.kill("SIGTERM")` فرایند را بی‌درنگ
 * می‌کشد و هیچ handlerی اجرا نمی‌شود.** آزموده شد — فرزندی با
 * `process.once("SIGTERM", …)` بدونِ اجرای handler با `exit code=1, signal=null`
 * تمام شد. یعنی مسیرِ خاموشیِ مودبانه از راهِ سیگنال، روی این ماشین **اصلاً
 * قابلِ راه‌اندازی نیست**.
 *
 * ★ پس همان چیزی صدا زده می‌شود که `main.ts` روی سیگنال صدا می‌زند:
 * [`gracefulShutdown`](../apps/realtime/src/shutdown.ts). هر چیزِ دیگری واقعی
 * است — Postgres، Redis، سوکت، فایل‌سیستم.
 *
 * ⚠️ **پس این سنجه تحویلِ خودِ سیگنال را ادعا نمی‌کند.** آن کارِ سیستم‌عامل است و
 * روی لینوکس (جایی که مستقر می‌شویم) رفتارِ استانداردِ Node. هرچه **بعد از**
 * سیگنال می‌آید، اینجا آزموده می‌شود.
 *
 * اجرا:
 *   pnpm db:up && pnpm db:migrate
 *   pnpm rt:shutdown
 */

const SECRET = new TextEncoder().encode("hamboom-shutdown-secret-at-least-32-chars-x");
// سقفِ عمرِ توکن که authority می‌پذیرد (exp_too_far) — برابرِ عمرِ توکنِ این سنجه.
const AUTHORITY_MAX_TTL_SECONDS = 3600;

function fail(message: string): never {
  process.stderr.write(`✖ ${message}\n`);
  process.exit(1);
}

interface Node {
  server: RtServer;
  shutdown: () => Promise<void>;
  hardClose: () => Promise<void>;
}

/** یک نودِ کامل — دقیقاً همان چیزی که `main.ts` سرِ هم می‌کند. */
async function startNode(
  env: {
    DATABASE_URL: string;
    DATABASE_SSL: boolean;
    REDIS_URL: string;
    S3_ENDPOINT: string;
    S3_REGION: string;
    S3_ACCESS_KEY_ID: string;
    S3_SECRET_ACCESS_KEY: string;
    S3_FORCE_PATH_STYLE: boolean;
    S3_BUCKET_SNAPSHOTS: string;
    S3_PRESIGN_TTL_SECONDS: number;
  },
  reader: MemoryBoardAccessReader,
): Promise<Node> {
  const nodeId = randomUUID();
  const pool = createPgPool({ connectionString: env.DATABASE_URL, ssl: env.DATABASE_SSL });
  const log = createPostgresUpdateLog({ pool });
  const catalog = createPostgresSnapshotCatalog({ pool });
  // ★ فاز ۷: انبارِ واقعیِ MinIO از پشتِ packages/storage (P4)، نه فایل‌سیستم.
  const store = createStorageSnapshotStore(
    createS3ObjectStore({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      bucket: env.S3_BUCKET_SNAPSHOTS,
      defaultPresignTtl: env.S3_PRESIGN_TTL_SECONDS,
    }),
  );
  const publisher = new Redis(env.REDIS_URL);
  const subscriber = new Redis(env.REDIS_URL);
  for (const client of [publisher, subscriber]) client.on("error", () => undefined);

  const rooms = createRoomManager({
    store: createPersistedBoardStore({ log, snapshots: { store, catalog } }),
    log,
    bus: createRedisBoardBus({ publisher, subscriber }),
    ownerLock: createRedisOwnerLock({ redis: publisher, nodeId }),
    nodeId,
    compactor: createCompactor({
      log,
      store,
      catalog,
      // ⚠️ آستانه‌ها بزرگ‌اند: هر snapshotی که ببینیم باید کارِ **خاموشی** باشد،
      //    نه فشرده‌سازیِ دوره‌ای.
      thresholds: { everyUpdates: 99_999, everyMs: 99_999_999 },
    }),
    limits: { maxRoomsPerNode: 100, maxDocBytes: 52_428_800, idleTimeoutMs: 120_000 },
  });

  const server = await createRtServer({
    // ★ فاز ۷: احرازِ واقعیِ auth-core (developmentOnly=false) + خواننده‌ی نقشِ حافظه‌ای.
    authority: createRealtimeAuthority({
      secret: SECRET,
      rtTokenTtlSeconds: AUTHORITY_MAX_TTL_SECONDS,
      accessReader: reader,
    }),
    appEnv: "local",
    port: 0,
    onJoin: (session) => rooms.join(session),
  });

  const closeResources = async (): Promise<void> => {
    await pool.end();
  };

  return {
    server,
    // ★ **همان تابعی که `main.ts` روی `SIGTERM` صدا می‌زند.**
    shutdown: () => gracefulShutdown({ server, rooms, closeResources }),
    hardClose: async () => {
      await server.close();
      await rooms.close();
      await closeResources();
    },
  };
}

interface Client {
  socket: WebSocket;
  doc: Y.Doc;
  closeCode(): number;
  seq(): number;
  waitForSeq(atLeast: number, timeoutMs?: number): Promise<void>;
  waitForElement(id: string, timeoutMs?: number): Promise<void>;
}

function connect(port: number, boardId: string, token: string): Promise<Client> {
  const doc = createBoardDoc();
  const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/rt?board=${boardId}&token=${token}`);
  const state = { code: 0, seq: 0 };

  socket.on("close", (code) => (state.code = code));
  socket.on("message", (data: Buffer) => {
    const message = decodeMessage(new Uint8Array(data));
    if (!message) return;
    if (message.type === MSG_TYPES.HB_ROOM_INFO) {
      state.seq = message.seq;
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

  function until(check: () => boolean, what: string, timeoutMs: number): Promise<void> {
    return new Promise((done, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (check()) {
          clearInterval(timer);
          done();
        } else if (Date.now() - started > timeoutMs) {
          clearInterval(timer);
          reject(new Error(what));
        }
      }, 40);
    });
  }

  return new Promise((resolve_, reject) => {
    socket.once("error", reject);
    socket.once("open", () =>
      resolve_({
        socket,
        doc,
        closeCode: () => state.code,
        seq: () => state.seq,
        waitForSeq: (atLeast, timeoutMs = 15_000) =>
          until(() => state.seq >= atLeast, `seq به ${atLeast} نرسید`, timeoutMs),
        waitForElement: (id, timeoutMs = 15_000) =>
          until(() => boardRoots(doc).elements.has(id), `عنصرِ ${id} نرسید`, timeoutMs),
      }),
    );
  });
}

function gesture(client: Client, id: string): void {
  const before = Y.encodeStateVector(client.doc);
  client.doc.transact(() => {
    writeElement(boardRoots(client.doc).elements, {
      id,
      type: "rectangle",
      x: 1,
      y: 1,
      width: 30,
      height: 30,
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
  syncProtocol.writeUpdate(inner, Y.encodeStateAsUpdate(client.doc, before));
  client.socket.send(
    encodeMessage({ type: MSG_TYPES.SYNC, payload: encoding.toUint8Array(inner) }),
  );
}

async function statusOf(port: number, path: string): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`);
  return response.status;
}

const settle = (ms = 400): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const env = loadEnv(databaseEnvSchema.and(redisEnvSchema).and(s3EnvSchema));

  // ★ فاز ۷: بوردِ واقعی — FKهای board_updates لازمشان دارند (board + origin_user).
  const db = new pg.Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
    max: 4,
  });
  const board = await seedBoard(db);
  const boardId = board.boardId;
  const sub = await addMember(db, boardId, "editor");
  // نقش از خواننده‌ی حافظه‌ایِ auth-core؛ توکن با همان رازِ authority امضا می‌شود.
  const reader = createMemoryBoardAccessReader();
  reader.set(sub, boardId, "editor");
  const token = await signRtToken(SECRET, { sub, boardId, role: "editor" }, AUTHORITY_MAX_TTL_SECONDS);

  process.stdout.write(`▶ بورد: ${boardId}\n`);

  const node = await startNode(env, reader);
  const client = await connect(node.server.port, boardId, token);
  await settle();

  // ── ۱) کاوشِ سلامت پیش از خاموشی ────────────────────────────────
  if (
    (await statusOf(node.server.port, "/healthz")) !== 200 ||
    (await statusOf(node.server.port, "/readyz")) !== 200
  ) {
    fail("کاوشِ سلامت پیش از خاموشی سبز نیست. گام قبول نیست.");
  }
  process.stdout.write("✔ /healthz و /readyz سبزند\n");

  // ── ۲) یک ژستِ تاییدشده، و یک ژست **درست قبل از** خاموشی ─────────
  gesture(client, "stk_before");
  await client.waitForSeq(1);
  const savedSeq = client.seq();

  // ★★ اینجا **صبر نمی‌کنیم**: ژست می‌رود و بلافاصله خاموشی شروع می‌شود. اگر
  //    صفِ تخلیه کار نکند، همین update گم می‌شود.
  gesture(client, "stk_at_the_last_moment");
  const shutdownDone = node.shutdown();

  // ── ۳) ★★ کدِ ۱۰۰۱ ──────────────────────────────────────────────
  await shutdownDone;
  if (client.closeCode() !== 1001) {
    fail(`کلاینت کدِ ${client.closeCode()} گرفت، نه ۱۰۰۱ (Going Away). گام قبول نیست.`);
  }
  process.stdout.write("✔ کلاینت با کدِ ۱۰۰۱ بدرقه شد\n");

  // ── ۴) ★★ snapshot در خاموشی ────────────────────────────────────
  const snapshots = await db.query<{ seq_upto: string; element_count: number }>(
    "SELECT seq_upto, element_count FROM board_snapshots WHERE board_id = $1",
    [boardId],
  );
  if (snapshots.rowCount === 0) {
    fail("خاموشی snapshot نگرفت. گام قبول نیست.");
  }
  const snapshot = snapshots.rows[0];
  process.stdout.write(
    `✔ snapshot در خاموشی: seq_upto=${String(snapshot?.seq_upto)}، ${String(snapshot?.element_count)} عنصر\n`,
  );

  // ── ۵) ★★ هیچ updateای گم نشد ───────────────────────────────────
  //
  // ⚠️ **در `board_updates` تنها دنبالش نگرد.** خودِ خاموشی snapshot می‌گیرد و
  //    ردیف‌های فشرده‌شده را **حذف** می‌کند، پس `MAX(seq)` می‌تواند صفر باشد در
  //    حالی که هیچ‌چیز گم نشده. (نسخه‌ی اولِ همین سنجه دقیقاً همین‌جا اشتباه
  //    قرمز شد.) حقیقتِ پایدار «لاگ + snapshot» است — همان نشانه‌ی بلندترین
  //    `seq` که [ADR-037](../ARCHITECTURE_DECISIONS.md#adr-037) تعریف کرد.
  const rows = await db.query<{ max: string }>(
    `SELECT GREATEST(
              COALESCE((SELECT MAX(seq) FROM board_updates WHERE board_id = $1), 0),
              COALESCE((SELECT MAX(seq_upto) FROM board_snapshots WHERE board_id = $1), 0)
            ) AS max`,
    [boardId],
  );
  const maxSeq = Number(rows.rows[0]?.max ?? 0);
  if (maxSeq <= savedSeq) {
    fail(`ژستِ لحظه‌ی آخر گم شد (seq روی ${maxSeq} ماند، تاییدشده ${savedSeq}). گام قبول نیست.`);
  }
  process.stdout.write(`✔ ژستِ لحظه‌ی آخر هم پایدار شد (seq ${savedSeq} → ${maxSeq})\n`);

  // و یک نودِ **تازه** هر دو را از دیتابیس می‌خوانَد.
  const fresh = await startNode(env, reader);
  const second = await connect(fresh.server.port, boardId, token);
  for (const id of ["stk_before", "stk_at_the_last_moment"]) {
    try {
      await second.waitForElement(id);
    } catch {
      fail(`عنصرِ ${id} بعد از خاموشی و بالا آمدنِ دوباره نیست. گام قبول نیست.`);
    }
  }
  process.stdout.write("✔ هر دو ژست — از جمله ژستِ لحظه‌ی آخر — سالم برگشتند\n");

  second.socket.close();
  await fresh.hardClose();
  await cleanupSeed(db, board);
  await db.end();

  process.stdout.write("\n✔ خاموشیِ مودبانه تایید شد.\n");
  process.exit(0);
}

void main().catch((error: unknown) => {
  if (error instanceof AggregateError) {
    for (const inner of error.errors) process.stderr.write(`  ↳ ${String(inner)}\n`);
  }
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
