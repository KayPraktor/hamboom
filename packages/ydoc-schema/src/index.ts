/**
 * `@hamboom/ydoc-schema` — مدلِ سندِ Yjs برای یک بورد.
 *
 * پایین‌ترین لایه‌ی ماژول M2. **هم کلاینت و هم سرور** مصرفش می‌کنند، به همین
 * دلیل نه UI می‌بیند (React/Excalidraw/canvas-core) و نه وابستگیِ سرور
 * (ws/pg/ioredis) — [ADR-029](../../../ARCHITECTURE_DECISIONS.md#adr-029).
 * قاعده‌ی ESLintِ `ydocSchemaBoundaries` این را اعمال می‌کند.
 *
 * فاز ۲ کامل است: ساختارِ سند، codecِ هر پنج ریشه، migration، و پروتکل.
 */

export {
  boardRoots,
  createBoardDoc,
  DOC_INIT_ORIGIN,
  DOC_ROOTS,
  getSchemaVersion,
  META_KEYS,
  readDocument,
  SCHEMA_VERSION,
  type BoardDocument,
  type BoardRoots,
  type DocRootName,
} from "./doc.ts";

export { readElement, writeElement } from "./element-codec.ts";

export { readAssets, removeAsset, writeAsset } from "./assets.ts";

export {
  DEFAULT_APP_STATE,
  readAppState,
  SHARED_APP_STATE_KEYS,
  writeAppState,
} from "./app-state.ts";

export {
  readCommentPins,
  removeCommentPin,
  writeCommentPin,
  type CommentPin,
  type CommentPinEntry,
} from "./comment-pins.ts";

export {
  assertNoBinary,
  BinaryInDocumentError,
  findBinaryIn,
  findBinaryValues,
} from "./binary-guard.ts";

export { HB_ERROR_CODES, type HbErrorCode } from "./error-codes.ts";

export {
  BOARD_ROLES,
  decodeMessage,
  encodeMessage,
  isKnownErrorCode,
  MSG_TYPES,
  ProtocolError,
  SAVE_STATUSES,
  type BoardRole,
  type HbMessage,
  type MsgType,
  type SaveStatus,
} from "./protocol.ts";

export {
  checkClientVersion,
  DOC_MIGRATION_ORIGIN,
  DocumentTooNewError,
  EARLIEST_SCHEMA_VERSION,
  migrateDocument,
  MIGRATIONS,
  MigrationPathError,
  type ClientVersionCheck,
  type MigrateOptions,
  type Migration,
  type MigrationResult,
} from "./migrations/index.ts";
