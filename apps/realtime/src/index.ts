/**
 * `@hamboom/realtime` — سرورِ همگام‌سازیِ بلادرنگ.
 *
 * سرورِ WebSocket با پروتکلِ y-protocols + پیام‌های سفارشیِ هم‌بوم
 * ([PLAN بخش ۵٫۳](../../../PLAN.md)). چرخه‌ی عمرِ اتاق، پایداری، awareness،
 * و اعمالِ مجوز.
 *
 * ── چه چیزی اینجا **نیست** ─────────────────────────────────────────────
 *
 * موتورِ رندر و React (این سرور هرگز بوم را نمی‌بیند —
 * [ADR-029](../../../ARCHITECTURE_DECISIONS.md#adr-029)) و SDKِ خامِ Object Storage
 * (فقط از راهِ `packages/storage` — P4). قاعده‌ی `realtimeBoundaries` هر دو را
 * خطا می‌کند.
 *
 * محتوای واقعی در فاز ۴ ساخته می‌شود (گام‌های ۴٫۱ تا ۴٫۸).
 */

import { SCHEMA_VERSION } from "@hamboom/ydoc-schema";

/**
 * نسخه‌ی سندی که این سرور سرو می‌کند.
 *
 * migration هنگام **بارگذاریِ اتاق در سرور** اجرا می‌شود، نه در کلاینت، تا همه‌ی
 * کلاینت‌ها یک نسخه ببینند ([PLAN بخش ۷٫۵](../../../PLAN.md)).
 */
export const SERVED_SCHEMA_VERSION = SCHEMA_VERSION;

export { createRtServer, type RtServer, type RtServerOptions, type RtSession } from "./server.ts";

export {
  assertAuthorityUsable,
  AuthError,
  AUTH_ERROR_CODES,
  createDevBoardAuthority,
  signDevToken,
  type BoardAuthority,
  type RtTokenClaims,
} from "./auth/index.ts";

export { createLogger, maskSubject, redactSecrets, type Logger, type LogLevel } from "./log.ts";

export { RtProtocolError } from "./protocol-error.ts";

export {
  createRoomManager,
  QUARANTINE_ORIGIN,
  type Room,
  type RoomLimits,
  type RoomLoadReport,
  type RoomManager,
  type RoomManagerOptions,
} from "./room.ts";

export { MemoryBoardStore, type BoardSnapshot, type BoardStore } from "./store/board-store.ts";

export { createPersistedBoardStore } from "./store/persisted-board-store.ts";

export { MemoryUpdateLog, type AppendedUpdate, type UpdateLog } from "./persistence/update-log.ts";

export {
  createPostgresUpdateLog,
  type PostgresUpdateLogOptions,
} from "./persistence/postgres-update-log.ts";

export { createPgPool, type PgPoolOptions } from "./persistence/pg-pool.ts";

export {
  MemorySnapshotStore,
  snapshotKey,
  type SnapshotStore,
} from "./persistence/snapshot-store.ts";

export {
  createFsSnapshotStore,
  DEFAULT_SNAPSHOT_DIR,
  type FsSnapshotStoreOptions,
} from "./persistence/fs-snapshot-store.ts";

export {
  MemorySnapshotCatalog,
  type SnapshotCatalog,
  type SnapshotRecord,
} from "./persistence/snapshot-catalog.ts";

export {
  createPostgresSnapshotCatalog,
  type PostgresSnapshotCatalogOptions,
} from "./persistence/postgres-snapshot-catalog.ts";

export {
  createCompactor,
  type CompactionResult,
  type CompactionThresholds,
  type Compactor,
  type CompactorOptions,
} from "./persistence/compactor.ts";
