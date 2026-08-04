import base from "@hamboom/eslint-config/base";
import { processEnvDiscipline, ydocSchemaBoundaries } from "@hamboom/eslint-config/boundaries";

/** @type {import("eslint").Linter.Config[]} */
export default [
  { ignores: ["dist/**"] },
  ...base,
  // ADR-029 — این پکیج هم در مرورگر و هم در سرور اجرا می‌شود، پس نه UI می‌بیند
  // و نه وابستگیِ سرور. فقط روی `src/` اعمال می‌شود؛ فایل‌های پیکربندیِ خودِ
  // پکیج طبیعتاً به `@hamboom/eslint-config` نیاز دارند.
  { ...ydocSchemaBoundaries(), files: ["src/**/*.ts"] },
  // PLAN بخش ۴ — فقط `packages/config` حق خواندنِ `process.env` را دارد.
  { ...processEnvDiscipline(), files: ["src/**/*.ts"] },
];
