import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

import { databaseEnvSchema, loadEnv, redisEnvSchema } from "@hamboom/config";
import {
  createCompactor,
  createDevBoardAuthority,
  createFsSnapshotStore,
  createPersistedBoardStore,
  createPgPool,
  createPostgresSnapshotCatalog,
  createPostgresUpdateLog,
  createRedisBoardBus,
  createRedisOwnerLock,
  createRoomManager,
  createRtServer,
  MemoryBoardBus,
  MemoryBoardStore,
  MemoryOwnerLock,
  MemoryUpdateLog,
  signDevToken,
  type RoomManager,
} from "@hamboom/realtime";
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

const SECRET = "hamboom-dev-only-secret-at-least-32-chars";
const DEFAULT_PORT = 15_300;
/** عمرِ توکن — کوتاه، تا مسیرِ «توکنِ تازه برای هر تلاش» واقعاً پیموده شود. */
const TOKEN_TTL_SECONDS = 60;

const SNAPSHOT_DIR = ".hamboom/snapshots-dev";
const LIMITS = { maxRoomsPerNode: 50, maxDocBytes: 52_428_800, idleTimeoutMs: 120_000 };

const args = process.argv.slice(2);
const persistent = args.includes("--pg");
const port = Number(args.find((value) => !value.startsWith("--")) ?? DEFAULT_PORT);
const tokenPort = port + 1;

const authority = createDevBoardAuthority({ secret: SECRET });

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
  const env = loadEnv(databaseEnvSchema.and(redisEnvSchema));
  const nodeId = randomUUID();
  const pool = createPgPool({ connectionString: env.DATABASE_URL, ssl: env.DATABASE_SSL });
  const log = createPostgresUpdateLog({ pool });
  const catalog = createPostgresSnapshotCatalog({ pool });
  const store = createFsSnapshotStore({ directory: SNAPSHOT_DIR });
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
   * ۱. `roles.set` → نقشِ **ماندگار**. بدونش کاربر با اتصالِ مجدد نقشِ داخلِ
   *    توکن را پس می‌گیرد — همان حفره‌ای که گام ۴٫۵ بست.
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
    authority.roles.set(sub, boardId, role as "viewer");
    const pushed = rooms.applyRoleChange(boardId, sub, role as "viewer");
    response.writeHead(200, { "content-type": "text/plain" }).end(String(pushed));
    return;
  }

  if (url.pathname !== "/dev-token") {
    response.writeHead(404).end();
    return;
  }

  response.writeHead(200, { "content-type": "text/plain" }).end(
    signDevToken(
      {
        sub: url.searchParams.get("sub") ?? "usr_dev",
        boardId,
        role: (url.searchParams.get("role") ?? "editor") as "editor",
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
      },
      SECRET,
    ),
  );
});

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
