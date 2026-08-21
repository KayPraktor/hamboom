import { assetsBoundaries, processEnvDiscipline } from "@hamboom/eslint-config/boundaries";
import base from "@hamboom/eslint-config/base";

/** @type {import("eslint").Linter.Config[]} */
export default [
  // ⚠️ `smoke/` رفت‌وبرگشتِ واقعیِ گام ۳٫۳ روی MinIO است (مثلِ storage:smoke، بیرونِ verify، env می‌خواند).
  { ignores: ["dist/**", "smoke/**"] },
  ...base,
  // ★ P4: assets **`@aws-sdk` را نمی‌بیند** — به S3 فقط از راهِ @hamboom/storage می‌رسد. خودآزمونش
  //   با Linter/ESLint در `packages/eslint-config/test/boundaries.test.js` است (هر سه لایه).
  { ...assetsBoundaries(), files: ["src/**/*.ts"] },
  // PLAN بخش ۴ — فقط `packages/config` حق خواندنِ `process.env` را دارد (assets از config می‌گیرد).
  { ...processEnvDiscipline(), files: ["src/**/*.ts"] },
];
