import { randomUUID } from "node:crypto";
import net from "node:net";

import {
  createMemoryBoardAccessReader,
  type MemoryBoardAccessReader,
  signRtToken,
} from "@hamboom/auth-core";
import {
  backoffCeilingMs,
  createWebSocketTransport,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_SILENCE_TIMEOUT_MS,
  type TransportStatus,
  type WebSocketTransport,
} from "@hamboom/canvas-sync/transport";
import {
  databaseEnvSchema,
  loadEnv,
  realtimeEnvSchema,
  redisEnvSchema,
  s3EnvSchema,
} from "@hamboom/config";
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
import * as Y from "yjs";

import { addMember, cleanupSeed, seedBoard } from "./rt-seed.ts";

/**
 * ★★ معیارِ پذیرشِ گام ۵٫۱ — **اتصالِ مجدد**.
 *
 * «با قطعِ سرور کلاینت `reconnecting` نشان می‌دهد، تلاش‌ها **زمان‌بندیِ backoff**
 * دارند (اندازه‌گیری‌شده، نه ادعاشده)، و با برگشتِ سرور بدونِ رفرش دوباره sync
 * می‌شود.»
 *
 * ── ★ چه چیزی اینجا **واقعی** است ─────────────────────────────────────
 *
 * ترابری **همان کدِ محصولی** است (`createWebSocketTransport` از
 * `@hamboom/canvas-sync/transport`)، سرور واقعی، Postgres و Redis واقعی،
 * سوکت واقعی، و فاصله‌ها با **ساعتِ دیوار** اندازه گرفته می‌شوند نه با
 * زمان‌بندِ ساختگی.
 *
 * ⚠️ **چه چیزی اینجا نیست:** خودِ `YjsSyncAdapter`. آن `@hamboom/canvas-core`
 * را می‌کشد که importهای نسبی‌اش پسوندِ `.ts` ندارند و در Nodeِ خالص بارگذاری
 * نمی‌شود (یافته‌ی گام ۱٫۲، و دامنه‌ی M1 است). پس نگاشتِ وضعیت→`ConnectionState`
 * و معرفیِ دوباره‌ی حضور با تستِ واحد (`src/reconnect.test.ts`) پوشش داده شده و
 * اینجا **ادعا نمی‌شود**. دست‌دادنِ sync دقیقاً همان چیزی است که آداپتور
 * می‌زند و پایین بازنویسی شده.
 *
 * ── ★★ افزوده‌ی M5 گام ۹٫۱ — دو قطعی که هرگز `close` نمی‌دهند ───────────
 *
 * سناریوهای ۱ تا ۴ همه یک چیز مشترک دارند: سرور یا شبکه **قابِ بستن** می‌فرستد و
 * ماشینِ حالتِ ترابری از همان‌جا شروع می‌کند. ریسکِ ثبت‌شده‌ی PLAN §۱۰ («پایداریِ
 * WebSocket روی شبکه‌ی ایران») ولی دقیقاً دو حالتی است که **هیچ قابی نمی‌رسد**:
 *
 * | # | حالت | چه چیزی روی سیم است |
 * |---|---|---|
 * | ۵ | **نشستِ نیم‌باز** — مسیر وسطِ کار می‌میرد (NAT، تعویضِ شبکه، DPI) | TCP «باز»، صفر بایت، نه `close` نه خطا |
 * | ۶ | **دست‌دادنِ معلق** — TCP وصل می‌شود ولی upgrade هرگز جواب نمی‌گیرد | همان، از قبل از `open` |
 *
 * هر دو با یک رله‌ی TCPِ **سیاه‌چاله** ساخته می‌شوند: رله وسطِ کلاینت و سرور
 * می‌نشیند، و در حالتِ تاریک هیچ بایتی رد نمی‌کند ولی **هیچ سوکتی را هم نمی‌بندد**.
 * از دیدِ هر دو طرف اتصال «هست». این همان چیزی است که ADR-006 نیمه‌ی سرورش را
 * ساخت (ping → `terminate`) و اینجا هر دو نیمه **اندازه** گرفته می‌شود.
 *
 * ★★ **پیش از رفع (۱۴۰۵/۰۶/۱۹) اندازه‌گیری شد:** سرور در ۳۹۵۸ms (دو تیک) می‌بست، کلاینت
 * بعد از ۱۵s هنوز `open` / `connecting` بود — هیچ قابِ بستنی نمی‌رسد و backoff هرگز شروع
 * نمی‌شد. رفع: keepaliveِ سطحِ برنامه در اتاق (`HB_ROOM_INFO` در هر تیک) + دو نگهبان در
 * ترابری (`silenceTimeoutMs`، `connectTimeoutMs`). حالا هر دو **assert** می‌شوند، و
 * بعدش بازگشتِ واقعی: رله روشن می‌شود و کلاینت بدونِ رفرش دوباره وصل و همگام می‌شود.
 *
 * ⚠️ heartbeatِ نودِ این دو سناریو ۲ ثانیه است (نه ۲۵) و نگهبان‌های کلاینت با همان
 * نسبتِ تولید (۳× و ۱٫۵×) کوتاه شده‌اند تا سنجه در چند ثانیه تمام شود. ★ خودِ نامساویِ
 * تولید (`silence > 2 × heartbeat`) هم روی **پیش‌فرض‌های واقعیِ** دو پکیج assert می‌شود.
 *
 * اجرا:
 *   pnpm db:up && pnpm db:migrate
 *   pnpm rt:reconnect
 */

const SECRET = new TextEncoder().encode("hamboom-reconnect-secret-at-least-32-ch");
/** توکنِ **کوتاه‌عمر** — نکته‌ی فاز ۳ همین است. */
const TOKEN_TTL_SECONDS = 5;
// سقفِ عمرِ توکن که authority می‌پذیرد (exp_too_far) — بالاتر از عمرِ واقعیِ توکنِ ۵ثانیه‌ای.
const AUTHORITY_MAX_TTL_SECONDS = 120;

function fail(message: string): never {
  process.stderr.write(`✖ ${message}\n`);
  process.exit(1);
}

const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────
// نود
// ─────────────────────────────────────────────────────────────

interface Node {
  server: RtServer;
  /** خاموشیِ **مودبانه** — کلاینت‌ها کدِ ۱۰۰۱ می‌گیرند. */
  shutdown: () => Promise<void>;
  /** مرگِ **ناگهانی** — سوکت‌ها `terminate` می‌شوند، کلاینت‌ها ۱۰۰۶ می‌بینند. */
  kill: () => Promise<void>;
}

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
  port: number,
  reader: MemoryBoardAccessReader,
  heartbeatMs?: number,
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
      thresholds: { everyUpdates: 99_999, everyMs: 99_999_999 },
    }),
    limits: { maxRoomsPerNode: 100, maxDocBytes: 52_428_800, idleTimeoutMs: 120_000 },
    // ★ گام ۹٫۱: keepaliveِ اتاق با همان فاصله‌ی pingِ سرور — همان سیم‌کشیِ main.ts.
    keepaliveMs: heartbeatMs ?? 25_000,
  });

  const server = await createRtServer({
    // ★ فاز ۷: احرازِ واقعیِ auth-core (developmentOnly=false) + خواننده‌ی نقشِ حافظه‌ای.
    authority: createRealtimeAuthority({
      secret: SECRET,
      rtTokenTtlSeconds: AUTHORITY_MAX_TTL_SECONDS,
      accessReader: reader,
    }),
    appEnv: "local",
    port,
    heartbeatMs,
    onJoin: (session) => rooms.join(session),
  });

  const release = async (): Promise<void> => {
    await rooms.close();
    await pool.end();
    publisher.disconnect();
    subscriber.disconnect();
  };

  return {
    server,
    shutdown: async () => {
      await server.shutdown();
      await server.close();
      await release();
    },
    // ⚠️ `close()` سوکت‌ها را `terminate` می‌کند، پس این **مرگِ ناگهانی** است —
    //    همان چیزی که برای آزمودنِ مسیرِ ۱۰۰۶ لازم داریم.
    kill: async () => {
      await server.close();
      await release();
    },
  };
}

// ─────────────────────────────────────────────────────────────
// ★★ رله‌ی سیاه‌چاله (گام ۹٫۱)
// ─────────────────────────────────────────────────────────────

interface Relay {
  port: number;
  /** از این لحظه هیچ بایتی رد نمی‌شود — ولی هیچ سوکتی هم بسته نمی‌شود. */
  darken(): void;
  /** دوباره رد می‌کند — اتصال‌های **تازه** کار می‌کنند؛ قدیمی‌ها همان‌طور مرده می‌مانند. */
  light(): void;
  /** کِی سرور سوکتِ خودش را بست (فقط در حالتِ تاریک ثبت می‌شود). */
  upstreamClosedAt(): number | null;
  close(): Promise<void>;
}

/**
 * ⚠️ در حالتِ تاریک، بسته‌شدنِ یک طرف به طرفِ دیگر **منتقل نمی‌شود** — این عمدی است
 * و کلِ نکته همین است: کلاینتی که پشتِ NATِ مرده نشسته، از مرگِ سرور هیچ خبری
 * نمی‌گیرد. اگر رله بسته‌شدن را منتقل می‌کرد، همان سناریوی ۱۰۰۶ بود که قبلاً سبز است.
 */
async function createRelay(targetPort: number, darkFromStart = false): Promise<Relay> {
  let dark = darkFromStart;
  let upstreamClosedAt: number | null = null;
  const sockets = new Set<net.Socket>();

  const server = net.createServer((down) => {
    const up = net.connect(targetPort, "127.0.0.1");
    sockets.add(down);
    sockets.add(up);
    down.on("data", (chunk: Buffer) => {
      if (!dark) up.write(chunk);
    });
    up.on("data", (chunk: Buffer) => {
      if (!dark) down.write(chunk);
    });
    up.on("close", () => {
      if (dark) {
        upstreamClosedAt ??= Date.now();
        return;
      }
      down.destroy();
    });
    down.on("close", () => {
      if (!dark) up.destroy();
    });
    up.on("error", () => undefined);
    down.on("error", () => undefined);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    port,
    darken: () => {
      dark = true;
    },
    light: () => {
      dark = false;
    },
    upstreamClosedAt: () => upstreamClosedAt,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** اولین رویدادِ وضعیت بعد از لحظه‌ی `since` که «باز» نیست — یعنی ترابری فهمید. */
function firstNonOpenAfter(probe: Probe, since: number): Event | undefined {
  return probe.events.find((event) => event.at >= since && event.status.phase !== "open");
}

// ─────────────────────────────────────────────────────────────
// کلاینت — روی ترابریِ **محصولی**
// ─────────────────────────────────────────────────────────────

interface Event {
  at: number;
  status: TransportStatus;
}

interface Probe {
  doc: Y.Doc;
  transport: WebSocketTransport;
  events: Event[];
  /** رویدادهای loggerِ ترابری — `reason`ِ افتادن از همین‌جا خوانده می‌شود (گام ۹٫۱). */
  logs: { at: number; message: string; fields: Record<string, unknown> }[];
  seq(): number;
  opens(): number;
  /** تعدادِ `HB_ROOM_INFO`های رسیده — keepaliveِ گام ۹٫۱ از همین شمرده می‌شود. */
  roomInfos(): number;
  gesture(id: string): void;
  waitFor(check: () => boolean, what: string, timeoutMs?: number): Promise<void>;
  stop(): void;
}

function probeClient(
  port: number,
  boardId: string,
  token: () => string | Promise<string>,
  watchdogs: { connectTimeoutMs?: number; silenceTimeoutMs?: number } = {},
): Probe {
  const doc = createBoardDoc();
  const events: Event[] = [];
  const logs: Probe["logs"] = [];
  const state = { seq: 0, opens: 0, roomInfos: 0 };
  const REMOTE = "probe:remote";

  const transport = createWebSocketTransport({
    url: `ws://127.0.0.1:${String(port)}/rt?board=${boardId}`,
    token,
    // تازه‌سازیِ وسطِ اتصال کارِ این سنجه نیست؛ تستِ واحد داردش.
    authRefreshMs: 0,
    ...watchdogs,
    logger: (message, fields = {}) => logs.push({ at: Date.now(), message, fields }),
  });

  transport.onStatus((status) => {
    events.push({ at: Date.now(), status });
    if (status.phase !== "open") return;
    state.opens += 1;
    // ★★ **دقیقاً همان کاری که `YjsSyncAdapter.resumeSession` می‌کند** — روی
    //    **هر** بار باز شدن، نه فقط اولی. سرور هیچ حافظه‌ای از نشستِ قبلی ندارد.
    for (const write of [syncProtocol.writeSyncStep1, syncProtocol.writeSyncStep2]) {
      const encoder = encoding.createEncoder();
      write(encoder, doc);
      transport.send(
        encodeMessage({ type: MSG_TYPES.SYNC, payload: encoding.toUint8Array(encoder) }),
      );
    }
  });

  transport.onMessage((bytes) => {
    const message = decodeMessage(bytes);
    if (!message) return;
    if (message.type === MSG_TYPES.HB_ROOM_INFO) {
      state.seq = message.seq;
      state.roomInfos += 1;
      return;
    }
    if (message.type !== MSG_TYPES.SYNC) return;
    const reply = encoding.createEncoder();
    syncProtocol.readSyncMessage(
      decoding.createDecoder(message.payload),
      reply,
      doc,
      REMOTE,
      () => {},
    );
    if (encoding.length(reply) > 0) {
      transport.send(
        encodeMessage({ type: MSG_TYPES.SYNC, payload: encoding.toUint8Array(reply) }),
      );
    }
  });

  doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE) return;
    const encoder = encoding.createEncoder();
    syncProtocol.writeUpdate(encoder, update);
    transport.send(
      encodeMessage({ type: MSG_TYPES.SYNC, payload: encoding.toUint8Array(encoder) }),
    );
  });

  void transport.connect();

  return {
    doc,
    transport,
    events,
    logs,
    seq: () => state.seq,
    opens: () => state.opens,
    roomInfos: () => state.roomInfos,
    gesture(id) {
      doc.transact(() => {
        writeElement(boardRoots(doc).elements, {
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
      }, "probe:local");
    },
    waitFor(check, what, timeoutMs = 20_000) {
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
        }, 25);
      });
    },
    stop: () => transport.disconnect(),
  };
}

const retries = (probe: Probe): Extract<TransportStatus, { phase: "retrying" }>[] =>
  probe.events
    .map((event) => event.status)
    .filter((status) => status.phase === "retrying") as Extract<
    TransportStatus,
    { phase: "retrying" }
  >[];

/** فاصله‌ی **واقعیِ** بینِ تلاش‌های پیاپی، از ساعتِ دیوار. */
function measuredGaps(probe: Probe): number[] {
  const attempts = probe.events.filter((event) => event.status.phase === "connecting");
  return attempts.slice(1).map((event, index) => event.at - (attempts[index]?.at ?? event.at));
}

// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const env = loadEnv(databaseEnvSchema.and(redisEnvSchema).and(s3EnvSchema));

  // ★ فاز ۷: بوردِ واقعی — FKِ board_updates_board_fk (افزوده‌ی migrationِ فاز ۵٫۱) لازمش دارد.
  const db = new pg.Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
    max: 4,
  });
  const board = await seedBoard(db);
  const boardId = board.boardId;
  // کاربرِ واقعی — FKِ board_updates_origin_user_fk سابِ نویسنده را در users می‌خواهد.
  const sub = await addMember(db, boardId, "editor");
  // نقشِ کاربر از خواننده‌ی حافظه‌ایِ auth-core می‌آید (نه توکن) — همان مسیرِ verifyRtToken.
  const reader = createMemoryBoardAccessReader();
  reader.set(sub, boardId, "editor");
  let minted = 0;
  // ⚠️ توکنِ **۵ثانیه‌ای** و **تازه در هر اتصال** — ادعای بند ۳: فاصله‌ی آفلاین از ۵s
  //    بیشتر است، پس توکنِ کَش‌شده منقضی می‌شود و signRtToken باید دوباره صادر کند.
  const freshToken = async (): Promise<string> => {
    minted += 1;
    return signRtToken(SECRET, { sub, boardId, role: "editor" }, TOKEN_TTL_SECONDS);
  };

  process.stdout.write(`▶ بورد: ${boardId}\n`);

  // ── ۰) نود، و کلاینتِ واقعی ──────────────────────────────────────
  const first = await startNode(env, 0, reader);
  const port = first.server.port;
  process.stdout.write(`▶ پورت: ${String(port)}\n`);

  const client = probeClient(port, boardId, freshToken);
  await client.waitFor(() => client.opens() === 1, "کلاینت اصلاً وصل نشد");
  client.gesture("stk_online");
  await client.waitFor(() => client.seq() >= 1, "ژستِ اول تایید نشد");
  process.stdout.write("✔ اتصالِ اول و یک ژستِ تاییدشده\n");

  // ── ۱) ★★ خاموشیِ مودبانه: کدِ ۱۰۰۱ → **بدونِ صبر** ─────────────
  await first.shutdown();
  await client.waitFor(() => retries(client).length > 0, "بعد از ۱۰۰۱ هیچ تلاشی زمان‌بندی نشد");
  const afterGoingAway = retries(client)[0];
  if (afterGoingAway?.nextRetryMs !== 0) {
    fail(
      `بعد از کدِ ۱۰۰۱ فاصله ${String(afterGoingAway?.nextRetryMs)}ms بود، نه صفر. ` +
        "خاموشیِ مودبانه باید فوری برگردد. گام قبول نیست.",
    );
  }
  process.stdout.write("✔ کدِ ۱۰۰۱ → تلاشِ فوری (nextRetryMs=0)\n");

  // ── ۲) ★★ سرور پایین است: فاصله‌ها را **اندازه بگیر** ────────────
  //
  // سه کلاینتِ دیگر هم همین‌جا وصل می‌شوند تا ادعای jitter روی سیمِ واقعی
  // آزمودنی باشد: اگر jitter نبود، هر سه دقیقاً یک عدد می‌گرفتند.
  const herd = [1, 2, 3].map(() => probeClient(port, boardId, freshToken));
  await settle(6_000);

  const gaps = measuredGaps(client).filter((gap) => gap > 0);
  if (gaps.length < 3) {
    fail(`فقط ${String(gaps.length)} فاصله‌ی قابلِ اندازه‌گیری ثبت شد. گام قبول نیست.`);
  }
  process.stdout.write(`▶ فاصله‌های اندازه‌گیری‌شده (ms): ${gaps.join(" · ")}\n`);

  // رشد: آخرین فاصله باید از اولی بزرگ‌تر باشد.
  const firstGap = gaps[0] ?? 0;
  const lastGap = gaps.at(-1) ?? 0;
  if (lastGap <= firstGap) {
    fail(`فاصله‌ها رشد نکردند (${String(firstGap)} → ${String(lastGap)}). گام قبول نیست.`);
  }

  // و هیچ‌کدام نباید از سقفِ همان تلاش رد شود (با حاشیه‌ی زمان‌بندیِ سیستم‌عامل).
  for (const [index, gap] of gaps.entries()) {
    const ceiling = backoffCeilingMs(index + 2) + 750;
    if (gap > ceiling) {
      fail(`فاصله‌ی ${String(gap)}ms از سقفِ ${String(ceiling)}ms رد شد. گام قبول نیست.`);
    }
  }
  process.stdout.write("✔ فاصله‌ها نمایی رشد کردند و از سقف رد نشدند\n");

  // ⚠️ **مقایسه باید هم‌تلاش‌شماره باشد.** نسخه‌ی اول همه‌ی فاصله‌ها را در یک
  //    مجموعه می‌ریخت و «متمایز بودن» را می‌سنجید — که بدونِ jitter هم برقرار
  //    است، چون خودِ backoff رشد می‌کند. ادعای واقعی این است: **سه کلاینت در
  //    یک تلاشِ یکسان، سه فاصله‌ی متفاوت**.
  const byAttempt = new Map<number, Set<number>>();
  for (const peer of herd) {
    for (const retry of retries(peer)) {
      if (retry.nextRetryMs <= 0) continue;
      const bucket = byAttempt.get(retry.attempt) ?? new Set<number>();
      bucket.add(retry.nextRetryMs);
      byAttempt.set(retry.attempt, bucket);
    }
  }
  const spread = [...byAttempt.entries()].filter(([, values]) => values.size > 1);
  if (spread.length === 0) {
    fail(
      `هیچ تلاشی بینِ ${String(herd.length)} کلاینت فاصله‌ی متفاوت نداشت — یعنی jitter روی ` +
        "سیم اثر ندارد و همه با هم برمی‌گردند. گام قبول نیست.",
    );
  }
  const [sampleAttempt, sampleValues] = spread[0] ?? [0, new Set<number>()];
  process.stdout.write(
    `✔ jitter روی سیم: در تلاشِ ${String(sampleAttempt)}، ${String(herd.length)} کلاینت ` +
      `فاصله‌های ${[...sampleValues].join("/")}ms گرفتند\n`,
  );

  // ── ۳) ★★ کارِ آفلاین، و بازگشت **بدونِ رفرش** ───────────────────
  //
  // ⚠️ توکن ۵ثانیه‌ای است و بیش از آن گذشته — پس اگر ترابری توکن را کَش کرده
  //    بود، این اتصال با `TOKEN_EXPIRED` رد می‌شد. **همان ادعا.**
  client.gesture("stk_offline");
  const mintedBefore = minted;

  const second = await startNode(env, port, reader);
  await client.waitFor(() => client.opens() === 2, "کلاینت بعد از برگشتِ سرور وصل نشد", 40_000);
  process.stdout.write(
    `✔ بدونِ رفرش دوباره وصل شد (${String(minted - mintedBefore)} توکنِ تازه در این فاصله)\n`,
  );

  // ژستِ آفلاین باید حالا **پایدار** شده باشد.
  await client.waitFor(() => client.seq() >= 2, "ژستِ آفلاین تایید نشد");
  const rows = await db.query<{ max: string }>(
    `SELECT GREATEST(
              COALESCE((SELECT MAX(seq) FROM board_updates WHERE board_id = $1), 0),
              COALESCE((SELECT MAX(seq_upto) FROM board_snapshots WHERE board_id = $1), 0)
            ) AS max`,
    [boardId],
  );
  const maxSeq = Number(rows.rows[0]?.max ?? 0);
  if (maxSeq < 2) {
    fail(`ژستِ آفلاین پایدار نشد (بلندترین seq = ${String(maxSeq)}). گام قبول نیست.`);
  }
  process.stdout.write(`✔ ژستِ آفلاین بعد از بازگشت پایدار شد (seq → ${String(maxSeq)})\n`);

  // و دوطرفه بودنِ دست‌دادنِ مجدد: کارِ یک کلاینتِ **تازه** باید به ما برسد.
  const newcomer = probeClient(port, boardId, freshToken);
  await newcomer.waitFor(() => newcomer.opens() === 1, "کلاینتِ تازه وصل نشد");
  await newcomer.waitFor(
    () => boardRoots(newcomer.doc).elements.has("stk_offline"),
    "کارِ آفلاینِ ما به کلاینتِ تازه نرسید",
  );
  newcomer.gesture("stk_from_newcomer");
  await client.waitFor(
    () => boardRoots(client.doc).elements.has("stk_from_newcomer"),
    "بعد از اتصالِ مجدد، کارِ همتا به ما نمی‌رسد",
  );
  process.stdout.write("✔ دست‌دادنِ مجدد دوطرفه است — هر دو سند همگرا شدند\n");

  // ── ۴) ★★ ردِ سرور (۱۰۰۸) → **تلاشِ دوباره نکن** ─────────────────
  const rejected = probeClient(port, boardId, () => "این.یک.توکن.نیست");
  await rejected.waitFor(
    () => rejected.events.some((event) => event.status.phase === "stopped"),
    "کلاینتِ ردشده هرگز متوقف نشد",
  );
  const attemptsAtStop = rejected.events.filter(
    (event) => event.status.phase === "connecting",
  ).length;
  await settle(2_500);
  const attemptsLater = rejected.events.filter(
    (event) => event.status.phase === "connecting",
  ).length;
  if (attemptsLater !== attemptsAtStop) {
    fail(
      `کلاینتِ ردشده بعد از ۱۰۰۸ باز هم تلاش کرد (${String(attemptsAtStop)} → ` +
        `${String(attemptsLater)}). این همان حلقه‌ی بی‌پایان است. گام قبول نیست.`,
    );
  }
  const stopped = rejected.events.map((event) => event.status).find((s) => s.phase === "stopped");
  process.stdout.write(
    `✔ ردِ ۱۰۰۸ متوقف شد و دیگر تلاش نکرد (کد: ${stopped?.phase === "stopped" ? stopped.code : "?"})\n`,
  );

  // ── ۵) ★★ نشستِ نیم‌باز: هر دو نیمه‌ی ADR-006 را **اندازه بگیر** ────
  //
  // heartbeat ۲ ثانیه ⇒ سرور باید حداکثر در ۲ تیک (۴s) بفهمد. کلاینت قابِ بستن
  // نمی‌گیرد، پس هرچه می‌فهمد باید از **خودش** باشد: نگهبانِ سکوت، ۳× keepalive.
  const HALF_OPEN_HEARTBEAT_MS = 2_000;
  const SILENCE_MS = 3 * HALF_OPEN_HEARTBEAT_MS;
  const CONNECT_TIMEOUT_MS = 3_000;

  // ★ نامساویِ تولید روی پیش‌فرض‌های **واقعیِ** دو پکیج — نه روی عددهای همین سنجه.
  const productionHeartbeatMs = realtimeEnvSchema.parse({}).RT_HEARTBEAT_INTERVAL_MS;
  if (DEFAULT_SILENCE_TIMEOUT_MS <= 2 * productionHeartbeatMs) {
    fail(
      `silenceTimeoutMs=${String(DEFAULT_SILENCE_TIMEOUT_MS)} از دو برابرِ heartbeat=${String(productionHeartbeatMs)} بیشتر نیست ` +
        "⇒ یک keepaliveِ گم‌شده اتصالِ سالم را می‌اندازد. گام قبول نیست.",
    );
  }
  if (SILENCE_MS <= 2 * HALF_OPEN_HEARTBEAT_MS) fail("نسبتِ خودِ سنجه غلط است.");
  process.stdout.write(
    `✔ جفت‌شدگی: silence ${String(DEFAULT_SILENCE_TIMEOUT_MS)}ms > 2 × heartbeat ${String(productionHeartbeatMs)}ms · connect ${String(DEFAULT_CONNECT_TIMEOUT_MS)}ms\n`,
  );

  const third = await startNode(env, 0, reader, HALF_OPEN_HEARTBEAT_MS);
  const relay = await createRelay(third.server.port);

  const behindNat = probeClient(relay.port, boardId, freshToken, {
    silenceTimeoutMs: SILENCE_MS,
    connectTimeoutMs: CONNECT_TIMEOUT_MS,
  });
  await behindNat.waitFor(() => behindNat.opens() === 1, "کلاینتِ پشتِ رله وصل نشد");
  behindNat.gesture("stk_before_dark");
  await behindNat.waitFor(() => behindNat.seq() >= 1, "ژست از پشتِ رله تایید نشد");

  // ★ پیش از تاریکی، keepaliveِ اتاق باید در اتاقِ **ساکت** هم برسد — وگرنه نگهبانِ
  //   سکوت اتصالِ سالم را می‌انداخت. یک بازه‌ی کامل صبر و شمارش.
  const infosBefore = behindNat.roomInfos();
  await settle(HALF_OPEN_HEARTBEAT_MS + 500);
  if (behindNat.roomInfos() <= infosBefore) {
    fail("در اتاقِ ساکت هیچ HB_ROOM_INFOای نرسید — keepaliveِ اتاق کار نمی‌کند. گام قبول نیست.");
  }
  process.stdout.write(
    `✔ keepaliveِ اتاق در سکوت: ${String(behindNat.roomInfos() - infosBefore)} HB_ROOM_INFO در ${String(HALF_OPEN_HEARTBEAT_MS + 500)}ms\n`,
  );

  const darkAt = Date.now();
  relay.darken();
  await behindNat
    .waitFor(() => relay.upstreamClosedAt() !== null, "سرور سوکتِ نیم‌باز را نبست", 12_000)
    .catch(() => undefined);
  const serverClosedAt = relay.upstreamClosedAt();
  if (serverClosedAt === null) {
    fail(
      `سرور در ${String(12_000)}ms سوکتِ نیم‌باز را نبست (heartbeat=${String(HALF_OPEN_HEARTBEAT_MS)}). ` +
        "نیمه‌ی سرورِ ADR-006 کار نمی‌کند. گام قبول نیست.",
    );
  }
  const serverDetectMs = serverClosedAt - darkAt;
  const serverCeilingMs = 2 * HALF_OPEN_HEARTBEAT_MS + 1_500;
  if (serverDetectMs > serverCeilingMs) {
    fail(
      `سرور ${String(serverDetectMs)}ms بعد فهمید — بیش از دو تیکِ heartbeat (${String(serverCeilingMs)}ms). گام قبول نیست.`,
    );
  }
  process.stdout.write(
    `✔ نشستِ نیم‌باز: سرور در ${String(serverDetectMs)}ms فهمید (heartbeat ${String(HALF_OPEN_HEARTBEAT_MS)}ms، سقف ${String(serverCeilingMs)}ms)\n`,
  );

  // ★★ نیمه‌ی کلاینت — قبلاً «تا بی‌نهایت باز» بود. حالا باید در ≤ silence + یک keepalive
  //    (آخرین پیام تا یک بازه پیش از تاریکی رسیده) بفهمد، و **به دلیلِ سکوت**.
  const clientCeilingMs = SILENCE_MS + HALF_OPEN_HEARTBEAT_MS + 1_500;
  await behindNat
    .waitFor(() => firstNonOpenAfter(behindNat, darkAt) !== undefined, "", clientCeilingMs)
    .catch(() => undefined);
  const clientNoticed = firstNonOpenAfter(behindNat, darkAt);
  if (!clientNoticed) {
    fail(
      `نشستِ نیم‌باز: کلاینت در ${String(clientCeilingMs)}ms هنوز «باز» است — نگهبانِ سکوت کار نمی‌کند. گام قبول نیست.`,
    );
  }
  const silenceLog = behindNat.logs.find((l) => l.at >= darkAt && l.fields.reason === "silence");
  if (!silenceLog) {
    fail("کلاینت افتاد ولی نه به دلیلِ سکوت — چیزِ دیگری آن را انداخته. گام قبول نیست.");
  }
  process.stdout.write(
    `✔ نشستِ نیم‌باز: کلاینت در ${String(clientNoticed.at - darkAt)}ms فهمید (${clientNoticed.status.phase}، reason=silence، سقف ${String(clientCeilingMs)}ms)\n`,
  );

  // ★★ و بازگشت: رله روشن می‌شود، تلاشِ بعدیِ backoff وصل می‌شود، و کارِ همتا می‌رسد.
  relay.light();
  await behindNat.waitFor(
    () => behindNat.opens() === 2,
    "بعد از نشستِ نیم‌باز دوباره وصل نشد",
    20_000,
  );
  newcomer.gesture("stk_after_dark");
  await behindNat.waitFor(
    () => boardRoots(behindNat.doc).elements.has("stk_after_dark"),
    "بعد از بازگشت از نیم‌باز، کارِ همتا نمی‌رسد",
  );
  process.stdout.write("✔ نشستِ نیم‌باز: بدونِ رفرش دوباره وصل شد و همگام است\n");

  // ── ۶) ★★ دست‌دادنِ معلق: TCP وصل، upgrade بی‌جواب ───────────────
  const stalled = await createRelay(third.server.port, true);
  const stuck = probeClient(stalled.port, boardId, freshToken, {
    connectTimeoutMs: CONNECT_TIMEOUT_MS,
    silenceTimeoutMs: SILENCE_MS,
  });
  const stuckAt = Date.now();
  const stuckCeilingMs = CONNECT_TIMEOUT_MS + 1_500;
  const gaveUp = () =>
    stuck.events.find((event) => event.at >= stuckAt && event.status.phase !== "connecting");
  await stuck.waitFor(() => gaveUp() !== undefined, "", stuckCeilingMs).catch(() => undefined);
  const gave = gaveUp();
  if (!gave) {
    fail(
      `دست‌دادنِ معلق: کلاینت بعد از ${String(stuckCeilingMs)}ms هنوز «connecting» است — مهلتِ اتصال کار نمی‌کند. گام قبول نیست.`,
    );
  }
  if (gave.status.phase !== "retrying") {
    fail(`دست‌دادنِ معلق: کلاینت به «${gave.status.phase}» رفت، نه «retrying». گام قبول نیست.`);
  }
  const timeoutLog = stuck.logs.find(
    (l) => l.at >= stuckAt && l.fields.reason === "connect-timeout",
  );
  if (!timeoutLog) fail("کلاینت دست کشید ولی نه به دلیلِ مهلتِ اتصال. گام قبول نیست.");
  process.stdout.write(
    `✔ دست‌دادنِ معلق: کلاینت در ${String(gave.at - stuckAt)}ms دست کشید (retrying، reason=connect-timeout، سقف ${String(stuckCeilingMs)}ms)\n`,
  );
  // و وقتی مسیر باز شد، همان backoff وصلش می‌کند — بدونِ رفرش.
  stalled.light();
  await stuck.waitFor(() => stuck.opens() === 1, "بعد از بازشدنِ مسیر، دست‌دادن وصل نشد", 20_000);
  process.stdout.write("✔ دست‌دادنِ معلق: بعد از بازشدنِ مسیر وصل شد\n");

  // ── پاکسازی ─────────────────────────────────────────────────────
  for (const probe of [client, newcomer, rejected, behindNat, stuck, ...herd]) probe.stop();
  await relay.close();
  await stalled.close();
  await third.kill();
  await second.kill();
  await cleanupSeed(db, board);
  await db.end();

  process.stdout.write("\n✔ اتصالِ مجدد با backoff و jitter تایید شد.\n");
  process.exit(0);
}

void main().catch((error: unknown) => {
  if (error instanceof AggregateError) {
    for (const inner of error.errors) process.stderr.write(`  ↳ ${String(inner)}\n`);
  }
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
