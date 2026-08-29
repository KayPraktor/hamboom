import { randomUUID } from "node:crypto";

import { createPgBoardAccessReader } from "@hamboom/board-access-db";
import {
  appEnvSchema,
  authEnvSchema,
  databaseEnvSchema,
  loadEnv,
  realtimeEnvSchema,
  redisEnvSchema,
  s3EnvSchema,
} from "@hamboom/config";
import { createS3ObjectStore } from "@hamboom/storage";
import Redis from "ioredis";

import { createRealtimeAuthority } from "./auth/auth-core-authority.ts";
import { createLogger } from "./log.ts";
import { createCompactor } from "./persistence/compactor.ts";
import { createStorageSnapshotStore } from "./persistence/storage-snapshot-store.ts";
import { createPgPool } from "./persistence/pg-pool.ts";
import { createPostgresSnapshotCatalog } from "./persistence/postgres-snapshot-catalog.ts";
import { createPostgresUpdateLog } from "./persistence/postgres-update-log.ts";
import { createRoomManager } from "./room.ts";
import { createRedisBoardBus } from "./pubsub/redis-board-bus.ts";
import { createRedisOwnerLock } from "./pubsub/redis-owner-lock.ts";
import { createRtServer } from "./server.ts";
import { gracefulShutdown } from "./shutdown.ts";
import { createPersistedBoardStore } from "./store/persisted-board-store.ts";

/**
 * نقطه‌ی ورودِ سرور — **تنها جایی که قطعات به هم وصل می‌شوند.**
 *
 * ⚠️ عمداً نازک است و هیچ منطقی ندارد: هر تصمیمی که اینجا بیفتد، در تست دیده
 * نمی‌شود چون تست‌ها قطعات را مستقیم می‌سازند. کارش فقط خواندنِ env، ساختنِ
 * پیاده‌سازی‌ها، و سپردنشان به `createRtServer` است.
 *
 * ★ گیتِ [ADR-031](../../../ARCHITECTURE_DECISIONS.md#adr-031) داخلِ خودِ
 * `createRtServer` است، نه اینجا — تا هر مسیرِ دیگری هم که سرور را بالا بیاورد
 * از آن رد شود.
 */
async function main(): Promise<void> {
  const env = loadEnv(
    appEnvSchema
      .and(realtimeEnvSchema)
      .and(databaseEnvSchema)
      .and(redisEnvSchema)
      .and(authEnvSchema)
      .and(s3EnvSchema),
  );
  const logger = createLogger({ level: env.LOG_LEVEL });

  /**
   * ★ شناسه‌ی این نود — برچسبِ ضدِ حلقه‌ی ADR-006.
   *
   * ⚠️ عمداً از env نمی‌آید: باید در هر **فرایند** یکتا باشد، و یک متغیرِ محیطی
   * که فراموش شود روی دو replica یک مقدار می‌گیرد — یعنی هر دو پیامِ هم را
   * «مالِ خودم» می‌بینند و دور می‌ریزند. آن‌وقت دو نود بی‌صدا از هم جدا می‌شوند.
   */
  const nodeId = randomUUID();

  const pool = createPgPool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL,
    max: env.DATABASE_POOL_MAX,
  });
  const log = createPostgresUpdateLog({ pool, logger });
  const catalog = createPostgresSnapshotCatalog({ pool });
  // ★ snapshotها روی Object Storage (`StorageSnapshotStore`، فاز ۷) — نه دیسکِ محلی. آداپتورِ نازک،
  //   امضای پورت دست‌نخورده، پس `compactor`/`persisted-board-store` عوض نمی‌شوند.
  const objectStore = createS3ObjectStore({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    bucket: env.S3_BUCKET_SNAPSHOTS,
    defaultPresignTtl: env.S3_PRESIGN_TTL_SECONDS,
  });
  const store = createStorageSnapshotStore(objectStore);

  // ── خوشه (ADR-006 فاز ۲) ────────────────────────────────────────
  //
  // ⚠️ **دو اتصالِ Redis لازم است**: اتصالی که `SUBSCRIBE` کرده دیگر دستورِ
  //    معمولی نمی‌پذیرد، و قفلِ صاحب `SET` می‌خواهد.
  const redisOptions = { lazyConnect: false, ...(env.REDIS_TLS ? { tls: {} } : {}) };
  const publisher = new Redis(env.REDIS_URL, redisOptions);
  const subscriber = new Redis(env.REDIS_URL, redisOptions);
  for (const [name, client] of [
    ["publisher", publisher],
    ["subscriber", subscriber],
  ] as const) {
    // ⚠️ بدونِ این، خطای اتصالِ Redis یک `unhandled error event` می‌شود و
    //    **کلِ فرایند** را می‌اندازد — یعنی قطعیِ Redis به قطعیِ سرور ترجمه شود،
    //    در حالی که سرور بدونِ خوشه هم می‌تواند کلاینت‌های خودش را سرو کند.
    client.on("error", (error: unknown) => {
      logger.error("خطای اتصالِ Redis", { client: name, error: String(error) });
    });
  }

  const rooms = createRoomManager({
    store: createPersistedBoardStore({ log, snapshots: { store, catalog } }),
    log,
    bus: createRedisBoardBus({ publisher, subscriber, logger }),
    ownerLock: createRedisOwnerLock({ redis: publisher, nodeId }),
    nodeId,
    compactor: createCompactor({
      log,
      store,
      catalog,
      thresholds: {
        everyUpdates: env.RT_SNAPSHOT_EVERY_UPDATES,
        everyMs: env.RT_SNAPSHOT_EVERY_MS,
      },
      logger,
    }),
    limits: {
      maxRoomsPerNode: env.RT_MAX_ROOMS_PER_NODE,
      maxDocBytes: env.RT_MAX_DOC_BYTES,
      idleTimeoutMs: env.RT_ROOM_IDLE_TIMEOUT_MS,
    },
    logger,
  });

  const server = await createRtServer({
    // ★ authorityِ واقعی (auth-core + readerِ pgِ مشترکِ ADR-046)؛ developmentOnly=false → production بالا می‌آید.
    authority: createRealtimeAuthority({
      secret: new TextEncoder().encode(env.JWT_SECRET),
      rtTokenTtlSeconds: env.RT_TOKEN_TTL_SECONDS,
      accessReader: createPgBoardAccessReader(pool),
    }),
    appEnv: env.APP_ENV,
    port: env.RT_PORT,
    heartbeatMs: env.RT_HEARTBEAT_INTERVAL_MS,
    logger,
    onJoin: (session) => rooms.join(session),
  });

  // ★ ترتیبِ خاموشی عمداً **اینجا نیست** — در [`shutdown.ts`](./shutdown.ts) است
  //   تا آزمودنی باشد. اینجا فقط سیگنال به آن وصل می‌شود.
  let shuttingDown = false;
  const onSignal = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("خاموشی آغاز شد", { signal, nodeId });

    void gracefulShutdown({
      server,
      rooms,
      closeResources: async () => {
        await pool.end();
      },
      logger,
    }).then(() => {
      logger.info("خاموشی تمام شد", { nodeId });
      process.exit(0);
    });
  };
  process.once("SIGTERM", () => onSignal("SIGTERM"));
  process.once("SIGINT", () => onSignal("SIGINT"));

  // ★ نشانه‌ی «آماده‌ام» برای اسکریپت‌ها — `rt-durability` روی همین منتظر می‌مانَد.
  logger.info("realtime آماده است", { port: server.port, nodeId });
}

void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
