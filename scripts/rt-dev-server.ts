import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

import { createMemoryBoardAccessReader, signRtToken } from "@hamboom/auth-core";
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
  MemoryBoardBus,
  MemoryBoardStore,
  MemoryOwnerLock,
  MemoryUpdateLog,
  type RoomManager,
} from "@hamboom/realtime";
import { createS3ObjectStore } from "@hamboom/storage";
import type { BoardRole } from "@hamboom/ydoc-schema";
import Redis from "ioredis";

/**
 * سرورِ realtimeِ **بدونِ زیرساخت** — برای دمو و E2E.
 *
 * ── چرا کنارِ `apps/realtime/src/main.ts` وجود دارد ────────────────────
 *
 * `main.ts` نودِ واقعی است: Postgres، Redis، فایل‌سیستم. برای یک تستِ مرورگر
 * که می‌خواهد فقط **رفتارِ آفلاینِ کلاینت** را بسنجد، آوردنِ داکر به مسیرِ E2E
 * سه هزینه دارد و هیچ‌کدام لازم نیست: کندی، وابستگی به محیط، و یک نقطه‌ی
 * شکستِ بی‌ربط.
 *
 * پس اینجا **همه‌ی پیاده‌سازی‌های حافظه‌ای** به هم وصل می‌شوند — همان‌هایی که
 * تست‌های واحدِ گام‌های ۴٫۲ تا ۴٫۷ رویشان نوشته شده‌اند. سرور، پروتکل، اتاق و
 * مجوز **همان کدِ محصولی** اند؛ فقط انبار در حافظه است.
 *
 * ⚠️ **و این یعنی با هر ری‌استارت، بورد خالی بالا می‌آید.** برای تستِ گام ۵٫۲
 * این نه اشکال که **مزیت** است: اگر بعد از ری‌استارت استیکی‌ها روی سرور دیده
 * شوند، تنها منبعِ ممکنشان کلاینتی است که آفلاین ساخته‌شان.
 *
 * ── ★ نقطه‌ی توکن ─────────────────────────────────────────────────────
 *
 * `GET /dev-token?board=<id>&sub=<id>&role=<role>` یک `rtToken` امضاشده
 * می‌دهد. شکلش عمداً همان چیزی است که M3 باید بسازد (PLAN بخش ۵٫۳)، و مزیتش
 * برای همین گام این است که مرورگر **واقعاً برای هر تلاش یک توکنِ تازه**
 * می‌گیرد — همان چیزی که [ADR-039](../ARCHITECTURE_DECISIONS.md#adr-039)
 * الزام کرده.
 *
 * ⚠️ رازِ توسعه اینجا **ثابت و عمومی** است. `DevBoardAuthority` با
 * `APP_ENV=production` اصلاً بالا نمی‌آید (ADR-031) و این اسکریپت هم همان گیت
 * را از سرِ راهش برنمی‌دارد.
 *
 * ── ★★ و یک حالتِ دوم: `--pg` (گام ۶٫۱) ──────────────────────────────
 *
 * معیارِ پذیرشِ G-1ب صریحاً **Postgres + Redisِ بالا** می‌خواهد، پس انبارِ
 * حافظه‌ای آنجا کافی نیست: بدونِ Redis دو نود همدیگر را نمی‌بینند و بدونِ
 * Postgres «بعد از قطعی همان حالت برمی‌گردد» چیزی را ثابت نمی‌کند.
 *
 * با `--pg` دقیقاً همان چیزی سرِ هم می‌شود که `main.ts` می‌سازد. **کدِ سرور در
 * هر دو حالت یکی است** — فقط پورت‌های انبار عوض می‌شوند، که کلِ نکته‌ی
 * [ADR-031](../ARCHITECTURE_DECISIONS.md#adr-031) بود.
 *
 * اجرا:
 *   node scripts/rt-dev-server.ts            # حافظه‌ای، ۱۵۳۰۰ و ۱۵۳۰۱
 *   node scripts/rt-dev-server.ts 16000      # حافظه‌ای، ۱۶۰۰۰ و ۱۶۰۰۱
 *   node scripts/rt-dev-server.ts 16000 --pg # Postgres + Redisِ واقعی
 */

const SECRET = new TextEncoder().encode("hamboom-dev-only-secret-at-least-32-chars");
const DEFAULT_PORT = 15_300;
/** عمرِ توکن — کوتاه، تا مسیرِ «توکنِ تازه برای هر تلاش» واقعاً پیموده شود. */
const TOKEN_TTL_SECONDS = 60;

const LIMITS = { maxRoomsPerNode: 50, maxDocBytes: 52_428_800, idleTimeoutMs: 120_000 };

const args = process.argv.slice(2);
const persistent = args.includes("--pg");
const port = Number(args.find((value) => !value.startsWith("--")) ?? DEFAULT_PORT);
const tokenPort = port + 1;

// ★ فاز ۷: احرازِ واقعیِ auth-core + خواننده‌ی نقشِ حافظه‌ای. خواننده هنگامِ صدورِ
//   توکن پر می‌شود (پایین) تا currentRole با claimِ توکن هم‌نظر باشد؛ /dev-role تغییرش می‌دهد.
const reader = createMemoryBoardAccessReader();
const authority = createRealtimeAuthority({
  secret: SECRET,
  rtTokenTtlSeconds: TOKEN_TTL_SECONDS,
  accessReader: reader,
});

/** انبارِ حافظه‌ای — پیش‌فرض، و همان چیزی که E2Eهای ۵٫۲ و ۵٫۳ رویش نشسته‌اند. */
function memoryRooms(): RoomManager {
  return createRoomManager({
    store: new MemoryBoardStore(),
    log: new MemoryUpdateLog(),
    bus: new MemoryBoardBus(),
    ownerLock: new MemoryOwnerLock("dev-node"),
    nodeId: "dev-node",
    limits: LIMITS,
  });
}

/**
 * ★ نودِ واقعی — همان ترکیبی که `main.ts` می‌سازد.
 *
 * ⚠️ `nodeId` تصادفی است، نه ثابت: دو پروسه‌ی این اسکریپت باید برای قفلِ صاحب
 * **دو نودِ متفاوت** باشند (گام ۴٫۷). با شناسه‌ی یکسان هر دو خودشان را صاحب
 * می‌دیدند و کلِ ادعای خوشه بی‌معنا می‌شد.
 */
function persistentRooms(): RoomManager {
  const env = loadEnv(databaseEnvSchema.and(redisEnvSchema).and(s3EnvSchema));
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

  return createRoomManager({
    store: createPersistedBoardStore({ log, snapshots: { store, catalog } }),
    log,
    bus: createRedisBoardBus({ publisher, subscriber }),
    ownerLock: createRedisOwnerLock({ redis: publisher, nodeId }),
    nodeId,
    // آستانه‌های محصولی — این نود قرار است مثلِ یک نودِ واقعی رفتار کند.
    compactor: createCompactor({
      log,
      store,
      catalog,
      thresholds: { everyUpdates: 500, everyMs: 300_000 },
    }),
    limits: LIMITS,
  });
}

const rooms = persistent ? persistentRooms() : memoryRooms();

const server = await createRtServer({
  authority,
  appEnv: "local",
  port,
  onJoin: (session) => rooms.join(session),
});

const tokens = createServer((request, response) => {
  void handleTokenRequest(request, response).catch((error: unknown) => {
    response.writeHead(500).end(String(error));
  });
});

async function handleTokenRequest(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  // ⚠️ فقط برای توسعه: صفحه‌ی دمو روی پورتِ دیگری سرو می‌شود.
  response.setHeader("access-control-allow-origin", "*");

  const boardId = url.searchParams.get("board");
  if (!boardId) {
    response.writeHead(400).end("board لازم است");
    return;
  }

  /**
   * ★★ تغییرِ نقش **وسطِ کار** — گام ۵٫۳.
   *
   * دو کار می‌کند و هر دو لازم است، چون دو سوالِ متفاوت‌اند:
   *
   * ۱. `reader.set` → نقشِ **ماندگار** در خواننده‌ی auth-core. بدونش کاربر با
   *    اتصالِ مجدد نقشِ داخلِ توکن را پس می‌گیرد — همان حفره‌ای که گام ۴٫۵ بست.
   * ۲. `applyRoleChange` → **هُل دادن** به نشست‌های باز (`HB_PERMISSION`).
   *    بدونش کاربر تا وقتی تب را نبندد چیزی نمی‌فهمد.
   *
   * در M3 این کار endpointِ واقعیِ مدیریتِ دسترسی است؛ اینجا کوچک‌ترین شکلِ
   * ممکنش تا E2E بتواند سناریو را بسازد.
   */
  if (url.pathname === "/dev-role") {
    const sub = url.searchParams.get("sub");
    const role = url.searchParams.get("role");
    if (!sub || !role) {
      response.writeHead(400).end("sub و role لازم‌اند");
      return;
    }
    reader.set(sub, boardId, role as BoardRole);
    const pushed = rooms.applyRoleChange(boardId, sub, role as BoardRole);
    response.writeHead(200, { "content-type": "text/plain" }).end(String(pushed));
    return;
  }

  if (url.pathname !== "/dev-token") {
    response.writeHead(404).end();
    return;
  }

  const sub = url.searchParams.get("sub") ?? "usr_dev";
  const role = (url.searchParams.get("role") ?? "editor") as BoardRole;
  // ★ فاز ۷: نقش را در خواننده بگذار تا currentRole با claimِ توکن هم‌نظر باشد —
  //   auth-core همیشه نظر دارد (نبودِ کلید → null → رد)، برخلافِ undefinedِ dev-impl.
  reader.set(sub, boardId, role);
  const token = await signRtToken(SECRET, { sub, boardId, role }, TOKEN_TTL_SECONDS);
  response.writeHead(200, { "content-type": "text/plain" }).end(token);
}

await new Promise<void>((resolve) => tokens.listen(tokenPort, "127.0.0.1", resolve));

// ★ خطِ آخر ثابت است تا صداکننده (E2E) بتواند «بالا آمد» را تشخیص بدهد.
process.stdout.write(`rt-dev-server ws=${String(server.port)} token=${String(tokenPort)}\n`);

const stop = (): void => {
  void (async () => {
    await server.close();
    await rooms.close();
    tokens.close();
    process.exit(0);
  })();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
