import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createPgBoardAccessReader } from "@hamboom/board-access-db";
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
  type RoomManager,
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
import type pg from "pg";
import * as syncProtocol from "y-protocols/sync";
import { WebSocket } from "ws";
import * as Y from "yjs";

import {
  addMember,
  cleanupSeed,
  gaugeChildEnv,
  RT_SEED_SECRET,
  seedBoard,
  seedToken,
  type SeededBoard,
} from "./rt-seed.ts";

/**
 * ★★ بنچمارکِ گام ۶٫۳ — **سقف‌ها با عدد، نه با حس**.
 *
 * دو سنجه، هر دو روی مسیرِ **واقعی** (سرورِ محصولی، Postgres و Redisِ زنده،
 * WebSocketِ واقعی، پروتکلِ واقعی):
 *
 * ۱. **بوردِ ۵۰۰۰ عنصری** — زمانِ بارگذاریِ اتاق، حجمِ سند، حافظه‌ی هر اتاق.
 * ۲. **۵۰ کلاینتِ همزمان** — تاخیرِ p50/p95 از ژست تا دیده‌شدن در کلاینتِ دیگر،
 *    هم در حالتِ آرام و هم زیرِ رگبارِ همزمان.
 *
 * ── ⚠️ چرا سرور **در همین فرایند** بالا می‌آید ────────────────────────
 *
 * برای حافظه چاره‌ای نیست: از بیرون فقط RSS دیده می‌شود که پر از لقیِ GC است و
 * بینِ اجراها ده‌ها مگابایت نوسان دارد. اینجا `heapUsed` **قبل و بعدِ** بارگذاریِ
 * همان اتاق مقایسه می‌شود، با `global.gc()` بینشان.
 *
 * ★ و برای اینکه سندِ **کلاینت** عدد را آلوده نکند، ترتیب عمدی است: کلاینت اول
 * کلِ بورد را می‌گیرد، بعد قطع می‌شود تا اتاق تخلیه شود، و **بعد** دوباره وصل
 * می‌شود. در اندازه‌گیریِ دوم سندِ کلاینت از قبل کامل است و هیچ opی به آن اضافه
 * نمی‌شود — پس اختلافِ heap تقریباً فقط سندِ **اتاق** است.
 * ⚠️ «تقریباً» عمدی است: بافرهای گذرا و لقیِ GC صفر نمی‌شوند. عدد را به‌عنوان
 * **مرتبه‌ی بزرگی** بخوان، نه رقمِ دقیق.
 *
 * ── ⚠️ این بنچمارک درباره‌ی رندر هیچ نمی‌گوید ─────────────────────────
 *
 * سمتِ بوم در M1 اندازه‌گیری شده ([`docs/perf-baseline.md`](../docs/perf-baseline.md):
 * ۲۰۰۰ عنصر → ۱۴۴fps، و هزینه O(visible) است نه O(total)). اینجا فقط سرور،
 * پایداری و سیم سنجیده می‌شوند.
 *
 * اجرا:
 *   pnpm db:up && pnpm db:migrate
 *   pnpm rt:bench
 */

// ★ فاز ۷: همان رازِ سنجه‌ها؛ authorityِ درون‌فرایندی و مِینِ جداشده هر دو با این می‌سنجند.
const SEED_SECRET_BYTES = new TextEncoder().encode(RT_SEED_SECRET);
// سقفِ عمرِ توکن — بلند، چون بنچمارکِ بوردِ بزرگ ممکن است چند دقیقه طول بکشد.
const AUTHORITY_MAX_TTL_SECONDS = 3600;

/**
 * بوردِ بزرگ: ۵۰۰۰ عنصر در ۵۰۰ update — یعنی آستانه‌ی فشرده‌سازی هم رد می‌شود.
 *
 * ★ `RT_BENCH_ELEMENTS` برای **کنترلِ مقیاس** است، نه تنظیمِ سلیقه‌ای: عددِ
 * حافظه فقط وقتی قابلِ اعتماد است که با تعدادِ عنصر بالا و پایین برود. اگر
 * بوردِ ۵۰۰ عنصری هم همان ۷۶MB را بدهد، آن عدد چیزِ دیگری را می‌سنجد.
 */
const ELEMENTS = Number(process.env.RT_BENCH_ELEMENTS ?? 5000);
const BATCH = 10;

/** سنجه‌ی دوم. */
const CLIENTS = Number(process.env.RT_BENCH_CLIENTS ?? 50);
const QUIET_ROUNDS = 20;

function fail(message: string): never {
  process.stderr.write(`✖ ${message}\n`);
  process.exit(1);
}

// ── ابزارِ آمار ───────────────────────────────────────────────────────

/**
 * صدک با روشِ **nearest-rank** — بدونِ درون‌یابی.
 *
 * ⚠️ روی نمونه‌ی کوچک، درون‌یابی عددی می‌سازد که **هیچ اندازه‌گیری‌ای آن را
 * ندیده**. برای تاخیر که توزیعش دم‌دار است، عددِ واقعی بهتر از عددِ صاف است.
 */
function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1]!;
}

function summarize(label: string, values: readonly number[]): string {
  const p50 = percentile(values, 50);
  const p95 = percentile(values, 95);
  const max = values.length > 0 ? Math.max(...values) : Number.NaN;
  return `${label}: n=${values.length} p50=${p50}ms p95=${p95}ms max=${max}ms`;
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

/**
 * ★ GC اجباری. بدونِ `--expose-gc` در دسترس نیست و اسکریپت **می‌گوید** که
 * نیست — یک عددِ حافظه‌ی بی‌GC می‌تواند چند برابر واقعیت باشد.
 */
const forceGc = (globalThis as { gc?: () => void }).gc;

async function settleHeap(): Promise<number> {
  if (forceGc) {
    forceGc();
    await new Promise((done) => setTimeout(done, 50));
    forceGc();
  }
  return process.memoryUsage().heapUsed;
}

// ── سرورِ واقعی، در همین فرایند ───────────────────────────────────────

interface Harness {
  server: RtServer;
  rooms: RoomManager;
  pool: pg.Pool;
  close(): Promise<void>;
}

async function startServer(): Promise<Harness> {
  const env = loadEnv(databaseEnvSchema.and(redisEnvSchema).and(s3EnvSchema));
  const nodeId = randomUUID();

  const pool = createPgPool({ connectionString: env.DATABASE_URL, ssl: env.DATABASE_SSL, max: 10 });
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
    // ★ آستانه‌ها **پیش‌فرضِ محصولی** اند، نه دستکاری‌شده: بوردِ ۵۰۰ updateای در
    //   دنیای واقعی هم فشرده می‌شود، و زمانِ بارگذاری باید همان مسیر را بسنجد.
    compactor: createCompactor({
      log,
      store,
      catalog,
      thresholds: { everyUpdates: 500, everyMs: 60_000 },
    }),
    // ⚠️ تنها انحراف از محصول: `idleTimeoutMs` کوتاه است تا اندازه‌گیریِ
    //    «بارگذاریِ سرد» چند دقیقه منتظرِ تخلیه نمانَد.
    limits: { maxRoomsPerNode: 100, maxDocBytes: 52_428_800, idleTimeoutMs: 1_500 },
  });

  const server = await createRtServer({
    // ★ فاز ۷: احرازِ واقعیِ auth-core + خواننده‌ی نقشِ pgِ مشترک — دقیقاً مثلِ main.ts.
    authority: createRealtimeAuthority({
      secret: SEED_SECRET_BYTES,
      rtTokenTtlSeconds: AUTHORITY_MAX_TTL_SECONDS,
      accessReader: createPgBoardAccessReader(pool),
    }),
    appEnv: "local",
    port: 0,
    onJoin: (session) => rooms.join(session),
  });

  return {
    server,
    rooms,
    pool,
    close: async () => {
      await server.close();
      await rooms.close();
      await pool.end();
      publisher.disconnect();
      subscriber.disconnect();
    },
  };
}

/** پورتِ سرورِ **جدا** — برای سنجه‌ی تاخیر، تا CPUِ سرور با کلاینت‌ها قاطی نشود. */
const SPAWNED_PORT = 15393;

/**
 * ★★ سرور در یک **فرایندِ جدا**.
 *
 * ⚠️ دلیلش دقیقاً یک عددِ مشکوک بود: در نسخه‌ی اول، ۵۰ کلاینت و سرور در **یک
 * حلقه‌ی رویداد** بودند و تاخیرِ رگبار p50=۱۲۹ms درآمد. با آن ترکیب معلوم نیست
 * چقدرش کارِ سرور است و چقدرش رقابتِ خودِ کلاینت‌ها. اینجا سرور جدا می‌شود و هر
 * دو عدد گزارش می‌شوند — تفاوتشان **خودش** یافته است.
 */
function spawnServer(): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    ["--env-file-if-exists=.env", "apps/realtime/src/main.ts"],
    {
      // ★ فاز ۷: رازِ سنجه به‌عنوان JWT_SECRET + S3/DB/Redis از .env؛ نقش از pg readerِ main.ts.
      //    سقفِ عمرِ توکن بلند تا توکنِ ۳۶۰۰ثانیه‌ای exp_too_far نخورد. «آماده است» یک
      //    logger.info است — LOG_LEVEL باید info بماند وگرنه اسکریپت بی‌دلیل timeout می‌خورد.
      env: gaugeChildEnv(SPAWNED_PORT, {
        RT_TOKEN_TTL_SECONDS: String(AUTHORITY_MAX_TTL_SECONDS),
      }),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  return new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error("سرورِ جدا در ۲۰ ثانیه بالا نیامد")), 20_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("realtime آماده است")) {
        clearTimeout(timer);
        done(child);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`سرورِ جدا با کد ${String(code)} بسته شد`));
    });
  });
}

// ── کلاینتِ بنچمارک ───────────────────────────────────────────────────

interface BenchClient {
  socket: WebSocket;
  doc: Y.Doc;
  /** بعد از اعمالِ هر پیامِ SYNC صدا زده می‌شود — قلبِ اندازه‌گیریِ تاخیر. */
  onApplied: ((at: number) => void) | null;
  seq(): number;
  until(check: () => boolean, what: string, timeoutMs?: number): Promise<void>;
  send(update: Uint8Array): void;
  close(): void;
}

/**
 * ⚠️ `doc` عمداً پارامتر است، نه ساخته‌ی داخلی.
 *
 * اگر کلاینت با سندِ خالی وصل شود و بعد updateِ **افزایشی** بفرستد، سرور opهای
 * قبلیِ همان کلاینت را ندیده و update را در `pendingStructs` **بایگانی می‌کند
 * بدونِ هیچ خطایی** — `seq` تکان نمی‌خورد و بنچمارک صفر می‌شود. همان شکافِ علّیِ
 * گام ۳٫۱. با سندِ ورودی، `step2`ِ دست‌دادن حالتِ کامل را می‌بَرد.
 */
function connect(
  port: number,
  boardId: string,
  token: string,
  doc: Y.Doc = new Y.Doc(),
): Promise<BenchClient> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/rt?board=${boardId}&token=${token}`);
  let latestSeq = 0;

  const client: BenchClient = {
    socket,
    doc,
    onApplied: null,
    seq: () => latestSeq,
    until: (check, what, timeoutMs = 60_000) =>
      new Promise<void>((done, reject) => {
        const startedAt = Date.now();
        const tick = (): void => {
          if (check()) {
            done();
            return;
          }
          if (Date.now() - startedAt > timeoutMs) {
            reject(new Error(what));
            return;
          }
          setTimeout(tick, 5);
        };
        tick();
      }),
    send: (update) => {
      const encoder = encoding.createEncoder();
      syncProtocol.writeUpdate(encoder, update);
      socket.send(encodeMessage({ type: MSG_TYPES.SYNC, payload: encoding.toUint8Array(encoder) }));
    },
    close: () => socket.close(),
  };

  socket.on("message", (data: Buffer) => {
    const message = decodeMessage(new Uint8Array(data));
    if (message?.type === MSG_TYPES.HB_ROOM_INFO) {
      latestSeq = message.seq;
      return;
    }
    if (message?.type !== MSG_TYPES.SYNC) return;
    const reply = encoding.createEncoder();
    syncProtocol.readSyncMessage(
      decoding.createDecoder(message.payload),
      reply,
      doc,
      "bench",
      () => {},
    );
    if (encoding.length(reply) > 0) {
      socket.send(encodeMessage({ type: MSG_TYPES.SYNC, payload: encoding.toUint8Array(reply) }));
    }
    // ★ **بعد از** اعمال، نه قبلش: ادعای ما «دیده شد» است، نه «رسید».
    client.onApplied?.(Date.now());
  });

  return new Promise((done, reject) => {
    socket.once("error", reject);
    socket.once("open", () => {
      // دست‌دادنِ sync — همان **دو** پیامی که binder می‌فرستد: «چه کم دارم؟» و
      // «این هم هرچه دارم». دومی است که شکافِ علّی را می‌بندد.
      const request = encoding.createEncoder();
      syncProtocol.writeSyncStep1(request, doc);
      socket.send(encodeMessage({ type: MSG_TYPES.SYNC, payload: encoding.toUint8Array(request) }));
      const offer = encoding.createEncoder();
      syncProtocol.writeSyncStep2(offer, doc);
      socket.send(encodeMessage({ type: MSG_TYPES.SYNC, payload: encoding.toUint8Array(offer) }));
      done(client);
    });
  });
}

/**
 * ★ فاز ۷: بوردِ **واقعی** + یک عضوِ editor + توکنِ واقعیِ rt — همان مسیرِ محصولی.
 *
 * یک عضو برای همه‌ی اتصالات کافی است: نقش از readerِ pg می‌آید و FKِ
 * `board_updates_origin_user_fk` فقط یک کاربرِ **واقعی** می‌خواهد. ۵۰ اتصالِ یک
 * کاربر = ۵۰ تبِ باز؛ clientIDهای Yjs جدا می‌مانند، پس سنجه‌ی تاخیر دست‌نخورده است.
 */
async function seedBoardWithToken(
  pool: pg.Pool,
): Promise<{ board: SeededBoard; boardId: string; token: string }> {
  const board = await seedBoard(pool);
  const sub = await addMember(pool, board.boardId, "editor");
  const token = await seedToken(sub, board.boardId, "editor", AUTHORITY_MAX_TTL_SECONDS);
  return { board, boardId: board.boardId, token };
}

/** یک عنصرِ معتبر — همان شکلی که binder روی سیم می‌فرستد. */
function element(id: string, index: number): Record<string, unknown> {
  return {
    id,
    type: "rectangle",
    x: (index % 100) * 120,
    y: Math.floor(index / 100) * 120,
    width: 100,
    height: 100,
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
    seed: index + 1,
    version: 1,
    versionNonce: index + 1,
    updated: 0,
    isDeleted: false,
    boundElements: null,
    link: null,
    customData: {
      hb: { schema: 1, kind: "sticky", createdBy: "u", lastEditedBy: "u", createdAt: 0 },
    },
  };
}

// ── سنجه‌ی ۱: بوردِ ۵۰۰۰ عنصری ────────────────────────────────────────

interface BigBoardResult {
  buildMs: number;
  docBytes: number;
  snapshotBytes: number;
  updateRows: number;
  snapshotRows: number;
  coldLoadMs: number;
  warmLoadMs: number;
  roomHeapBytes: number;
}

async function benchBigBoard(harness: Harness): Promise<BigBoardResult> {
  const { board, boardId, token } = await seedBoardWithToken(harness.pool);
  process.stdout.write(`\n▶ سنجه‌ی ۱ — بوردِ ${ELEMENTS} عنصری (بورد: ${boardId})\n`);

  const local = createBoardDoc();
  const author = await connect(harness.server.port, boardId, token, local);
  // ★ مبدأ را بعد از آرام گرفتنِ دست‌دادن بگیر — پاسخِ step2ِ خودمان هم یک ردیف است.
  await new Promise((done) => setTimeout(done, 400));
  const seq0 = author.seq();

  // ── ساختِ بورد: ۵۰۰ updateِ افزایشی، دقیقاً مثلِ ۵۰۰ ژستِ واقعی ──────
  //
  // ⚠️ **هر ژست منتظرِ ackِ خودش می‌مانَد، و این آرایش نیست** (درسِ گام ۴٫۴):
  //    Yjs `applyUpdate`هایی را که در پاکسازیِ یک تراکنش به هم می‌رسند در **یک**
  //    تراکنش ادغام می‌کند، پس ۵۰۰ پیامِ پشتِ‌هم یک ردیفِ لاگ می‌شوند و بنچمارک
  //    چیزی را که ادعا می‌کند نمی‌سنجد.
  const startedAt = Date.now();
  const batches = ELEMENTS / BATCH;
  for (let batch = 0; batch < batches; batch += 1) {
    const before = Y.encodeStateVector(local);
    local.transact(() => {
      for (let offset = 0; offset < BATCH; offset += 1) {
        const index = batch * BATCH + offset;
        writeElement(boardRoots(local).elements, element(`stk_${index}`, index) as never);
      }
    });
    author.send(Y.encodeStateAsUpdate(local, before));
    await author.until(
      () => author.seq() >= seq0 + batch + 1,
      `seq به ${seq0 + batch + 1} نرسید (رسید: ${author.seq()})`,
      30_000,
    );
  }
  const buildMs = Date.now() - startedAt;
  const docBytes = Y.encodeStateAsUpdate(local).byteLength;
  process.stdout.write(`  · ساخت: ${buildMs}ms · حجمِ سند: ${mb(docBytes)} (${docBytes} بایت)\n`);

  // ── بارگذاریِ **گرم**: اتاق هنوز در حافظه است ────────────────────────
  const warmStart = Date.now();
  const warm = await connect(harness.server.port, boardId, token);
  await warm.until(
    () => boardRoots(warm.doc).elements.size >= ELEMENTS,
    "کلاینتِ گرم کلِ بورد را نگرفت",
    120_000,
  );
  const warmLoadMs = Date.now() - warmStart;
  warm.close();
  process.stdout.write(`  · بارگذاریِ گرم (اتاق در حافظه): ${warmLoadMs}ms\n`);

  // ── تخلیه‌ی اتاق ─────────────────────────────────────────────────────
  author.close();
  await new Promise((done) => setTimeout(done, 2_500));
  if (harness.rooms.has(boardId)) fail("اتاق تخلیه نشد — اندازه‌گیریِ سرد بی‌معنا می‌شود");
  process.stdout.write("  · اتاق از حافظه رفت\n");

  // ── بارگذاریِ **سرد**: اتاق از دیتابیس بالا می‌آید ───────────────────
  //
  // ★ کلاینتِ خالی، چون این عددِ **کاربر** است: از باز کردنِ تب تا دیدنِ کلِ بورد.
  const coldStart = Date.now();
  const reader = await connect(harness.server.port, boardId, token);
  await reader.until(
    () => boardRoots(reader.doc).elements.size >= ELEMENTS,
    "کلاینتِ سرد کلِ بورد را نگرفت",
    120_000,
  );
  const coldLoadMs = Date.now() - coldStart;
  process.stdout.write(`  · بارگذاریِ سرد (از دیتابیس): ${coldLoadMs}ms\n`);
  reader.close();

  // ── حافظه: یک بارگذاریِ **دوم**، این‌بار فقط برای اندازه‌گیری ─────────
  //
  // ⚠️ چرا جدا و نه همان بالا: با کلاینتِ خالی، اختلافِ heap شاملِ سندِ **خودِ
  //    کلاینت** هم می‌شود و عدد تقریباً **دو برابر** گزارش می‌شود (اولین اجرا
  //    ۱۵۳MB داد، که جمعِ دو سند بود). اینجا سندِ کلاینت **قبل از** خطِ پایه
  //    ساخته و پر می‌شود، پس هنگام sync هیچ opی به آن اضافه نمی‌شود و اختلاف
  //    تقریباً فقط سندِ **اتاق** است.
  await new Promise((done) => setTimeout(done, 2_500));
  if (harness.rooms.has(boardId)) fail("اتاق برای اندازه‌گیریِ حافظه تخلیه نشد");

  const primed = new Y.Doc();
  Y.applyUpdate(primed, Y.encodeStateAsUpdate(local));
  const heapBefore = await settleHeap();

  const probe = await connect(harness.server.port, boardId, token, primed);
  await probe.until(
    () => harness.rooms.has(boardId) && probe.seq() > 0,
    "اتاق برای اندازه‌گیریِ حافظه بالا نیامد",
    120_000,
  );
  const heapAfter = await settleHeap();
  const roomHeapBytes = heapAfter - heapBefore;
  process.stdout.write(`  · حافظه‌ی اتاق ≈ ${mb(roomHeapBytes)}\n`);
  probe.close();

  // ── آنچه واقعاً روی دیسک است ─────────────────────────────────────────
  const updateRows = await harness.pool.query<{ count: string; bytes: string | null }>(
    "SELECT count(*)::text AS count, sum(octet_length(payload))::text AS bytes FROM board_updates WHERE board_id = $1",
    [boardId],
  );
  const snapshotRows = await harness.pool.query<{ count: string; bytes: string | null }>(
    "SELECT count(*)::text AS count, sum(byte_size)::text AS bytes FROM board_snapshots WHERE board_id = $1",
    [boardId],
  );
  const result: BigBoardResult = {
    buildMs,
    docBytes,
    snapshotBytes: Number(snapshotRows.rows[0]?.bytes ?? 0),
    updateRows: Number(updateRows.rows[0]?.count ?? 0),
    snapshotRows: Number(snapshotRows.rows[0]?.count ?? 0),
    coldLoadMs,
    warmLoadMs,
    roomHeapBytes,
  };
  process.stdout.write(
    `  · دیتابیس: ${result.updateRows} ردیفِ update (${mb(Number(updateRows.rows[0]?.bytes ?? 0))}) · ` +
      `${result.snapshotRows} snapshot (${mb(result.snapshotBytes)})\n`,
  );
  await cleanupSeed(harness.pool, board);
  return result;
}

// ── سنجه‌ی ۲: ۵۰ کلاینتِ همزمان ───────────────────────────────────────

interface LatencyResult {
  quiet: number[];
  burst: number[];
  clients: number;
}

async function benchLatency(pool: pg.Pool, port: number, label: string): Promise<LatencyResult> {
  const { board, boardId, token } = await seedBoardWithToken(pool);
  process.stdout.write(`\n▶ سنجه‌ی ۲ — ${CLIENTS} کلاینتِ همزمان · ${label} (بورد: ${boardId})\n`);

  // ★ کلاینتِ اول با یک سندِ ساخته‌شده می‌آید تا بورد **وجود** داشته باشد؛ بقیه
  //   با سندِ خالی وصل می‌شوند و همه‌چیز را از سرور می‌گیرند — مثلِ کاربرِ واقعی.
  const clients: BenchClient[] = [];
  for (let index = 0; index < CLIENTS; index += 1) {
    clients.push(
      await connect(port, boardId, token, index === 0 ? createBoardDoc() : new Y.Doc()),
    );
  }
  await new Promise((done) => setTimeout(done, 500));
  process.stdout.write(`  · ${clients.length} اتصالِ باز\n`);

  const writer = clients[0]!;
  const readers = clients.slice(1);

  /**
   * یک ژست، و صبر تا **همه‌ی** خواننده‌ها ببینندش.
   *
   * ★ نوشتن در سندِ **خودِ کلاینت** انجام می‌شود، نه یک سندِ کنار: هر سندِ دیگری
   * شکافِ علّی می‌سازد و update بی‌صدا بایگانی می‌شود.
   */
  async function round(id: string, index: number): Promise<number[]> {
    const seen: number[] = [];
    const pending = new Set(readers);
    for (const reader of readers) {
      reader.onApplied = (at) => {
        if (!pending.has(reader)) return;
        if (!boardRoots(reader.doc).elements.has(id)) return;
        pending.delete(reader);
        seen.push(at);
      };
    }

    const before = Y.encodeStateVector(writer.doc);
    writer.doc.transact(() => {
      writeElement(boardRoots(writer.doc).elements, element(id, index) as never);
    });
    const sentAt = Date.now();
    writer.send(Y.encodeStateAsUpdate(writer.doc, before));

    await writer.until(() => pending.size === 0, `${pending.size} کلاینت ${id} را ندید`, 30_000);
    for (const reader of readers) reader.onApplied = null;
    return seen.map((at) => at - sentAt);
  }

  // ── ۲الف: حالتِ آرام — یک نویسنده، بقیه فقط تماشا ────────────────────
  const quiet: number[] = [];
  for (let index = 0; index < QUIET_ROUNDS; index += 1) {
    quiet.push(...(await round(`stk_quiet_${index}`, index)));
  }
  process.stdout.write(`  · ${summarize("آرام (یک نویسنده)", quiet)}\n`);

  // ── ۲ب: رگبار — **هر ۵۰ کلاینت هم‌زمان** می‌نویسند ───────────────────
  //
  // ⚠️ این عدد با بالایی قابلِ مقایسه نیست و نباید باشد: آنجا تاخیرِ خالص است،
  //    اینجا تاخیر **زیرِ بار**. هر دو لازم‌اند — کاربر هر دو حالت را دارد.
  const burst: number[] = [];
  const burstIds = clients.map((_, index) => `stk_burst_${index}`);
  const sentAt = new Map<string, number>();
  /** هر کلاینت چه شناسه‌هایی را **قبلاً** دیده — تا هر رسیدن یک بار شمرده شود. */
  const seenBy = new Map<BenchClient, Set<string>>();

  for (const [index, client] of clients.entries()) {
    seenBy.set(client, new Set());
    client.onApplied = (at) => {
      const seen = seenBy.get(client)!;
      for (const [other, id] of burstIds.entries()) {
        // ⚠️ شناسه‌ی **خودش** شمرده نمی‌شود: در سندِ خودش از لحظه‌ی نوشتن هست و
        //    تاخیرِ صفرِ ساختگی به توزیع تزریق می‌کرد.
        if (other === index || seen.has(id)) continue;
        if (!boardRoots(client.doc).elements.has(id)) continue;
        seen.add(id);
        const at0 = sentAt.get(id);
        if (at0 !== undefined) burst.push(at - at0);
      }
    };
  }

  // ★ همه در یک تیک می‌نویسند — رگبارِ واقعی، نه ۵۰ ژستِ پشتِ‌سرِ هم.
  for (const [index, client] of clients.entries()) {
    const id = burstIds[index]!;
    const before = Y.encodeStateVector(client.doc);
    client.doc.transact(() => {
      writeElement(boardRoots(client.doc).elements, element(id, index) as never);
    });
    sentAt.set(id, Date.now());
    client.send(Y.encodeStateAsUpdate(client.doc, before));
  }

  await clients[0]!.until(
    () =>
      clients.every((client) => burstIds.every((id) => boardRoots(client.doc).elements.has(id))),
    "رگبار به همه نرسید",
    60_000,
  );
  for (const client of clients) client.onApplied = null;
  process.stdout.write(`  · ${summarize(`رگبار (${CLIENTS} نویسنده‌ی هم‌زمان)`, burst)}\n`);

  for (const client of clients) client.close();
  await cleanupSeed(pool, board);
  return { quiet, burst, clients: CLIENTS };
}

// ── اجرا ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!forceGc) {
    process.stdout.write(
      "⚠️ بدونِ `--expose-gc` اجرا شد — عددِ حافظه قابلِ استناد نیست. `pnpm rt:bench` را بزن.\n",
    );
  }

  const harness = await startServer();
  process.stdout.write(`▶ سرورِ درون‌فرایندی روی پورتِ ${harness.server.port}\n`);

  let child: ChildProcess | null = null;
  try {
    const big = await benchBigBoard(harness);
    const sameProcess = await benchLatency(harness.pool, harness.server.port, "سرور در همین فرایند");

    // ★ همان سنجه، این‌بار با سرورِ **جدا** — تفاوتش می‌گوید چقدر از عدد کارِ
    //   سرور بوده و چقدرش رقابتِ ۵۰ کلاینت بر سرِ یک حلقه‌ی رویداد.
    child = await spawnServer();
    process.stdout.write(`▶ سرورِ جدا روی پورتِ ${SPAWNED_PORT}\n`);
    const separate = await benchLatency(harness.pool, SPAWNED_PORT, "سرورِ جدا");

    const perElement = big.roomHeapBytes / ELEMENTS;
    process.stdout.write("\n────────────────── خلاصه ──────────────────\n");
    process.stdout.write(`بوردِ ${ELEMENTS} عنصری:\n`);
    process.stdout.write(`  حجمِ سند             ${mb(big.docBytes)} (${big.docBytes} بایت)\n`);
    process.stdout.write(
      `  سقفِ RT_MAX_DOC_BYTES  ۵۰MB → ${((big.docBytes / 52_428_800) * 100).toFixed(2)}٪ مصرف\n`,
    );
    process.stdout.write(`  ساخت (${ELEMENTS / BATCH} update)    ${big.buildMs}ms\n`);
    process.stdout.write(`  بارگذاریِ سرد         ${big.coldLoadMs}ms\n`);
    process.stdout.write(`  بارگذاریِ گرم         ${big.warmLoadMs}ms\n`);
    process.stdout.write(
      `  حافظه‌ی اتاق ≈        ${mb(big.roomHeapBytes)} (${(perElement / 1024).toFixed(1)}KB به‌ازای هر عنصر)\n`,
    );
    process.stdout.write(
      `  دیسک                  ${big.updateRows} update + ${big.snapshotRows} snapshot (${mb(big.snapshotBytes)})\n`,
    );
    process.stdout.write(`${CLIENTS} کلاینت — سرور در همین فرایند:\n`);
    process.stdout.write(`  ${summarize("  آرام ", sameProcess.quiet)}\n`);
    process.stdout.write(`  ${summarize("  رگبار", sameProcess.burst)}\n`);
    process.stdout.write(`${CLIENTS} کلاینت — سرورِ جدا:\n`);
    process.stdout.write(`  ${summarize("  آرام ", separate.quiet)}\n`);
    process.stdout.write(`  ${summarize("  رگبار", separate.burst)}\n`);
    process.stdout.write("───────────────────────────────────────────\n");
  } finally {
    child?.kill("SIGKILL");
    await harness.close();
  }
  process.exit(0);
}

void main().catch((error: unknown) => fail(String(error)));
