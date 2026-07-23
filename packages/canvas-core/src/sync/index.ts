/**
 * نقطه‌ی ورود لایه‌ی قرارداد sync — `@hamboom/canvas-core/sync`.
 *
 * ماژول M2 (`realtime-sync`) `CanvasSyncAdapter` را پیاده می‌کند و هیچ‌چیز
 * دیگری از `canvas-core` را نمی‌بیند. جریان داده و قواعد: [README](./README.md).
 */

export type {
  ChangeOrigin,
  ElementChangeSet,
  PointerState,
  Viewport,
  PeerUser,
  PeerState,
  EphemeralPayload,
  ConnectionState,
  SaveState,
  CanvasPermissions,
  CanvasDocument,
  FocusTarget,
  CanvasOutbound,
  CanvasInbound,
  CanvasSyncAdapter,
} from "./contract";

export { EchoLoopError, isEmittableOrigin, assertEmittable } from "./contract";

export { LocalSyncAdapter, LocalSyncHub } from "./local-adapter";
export type { LocalSyncAdapterOptions } from "./local-adapter";

/**
 * نسخه‌ی قرارداد sync.
 *
 * از گام ۲٫۲ برابر `1` است. هر تغییر ناسازگار این عدد را جلو می‌برد و سرور
 * realtime می‌تواند کلاینت قدیمی را با `HB_ERROR{ code: "CLIENT_TOO_OLD" }` رد کند.
 */
export const SYNC_CONTRACT_VERSION = 1;
