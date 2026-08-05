/**
 * `@hamboom/ydoc-schema` — مدلِ سندِ Yjs برای یک بورد.
 *
 * پایین‌ترین لایه‌ی ماژول M2. **هم کلاینت و هم سرور** مصرفش می‌کنند، به همین
 * دلیل نه UI می‌بیند (React/Excalidraw/canvas-core) و نه وابستگیِ سرور
 * (ws/pg/ioredis) — [ADR-029](../../../ARCHITECTURE_DECISIONS.md#adr-029).
 * قاعده‌ی ESLintِ `ydocSchemaBoundaries` این را اعمال می‌کند.
 *
 * migration (گام ۲٫۳) و کدهای پروتکل (گام ۲٫۴) هنوز اضافه نشده‌اند.
 */

export {
  boardRoots,
  createBoardDoc,
  DEFAULT_APP_STATE,
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
