import base from "@hamboom/eslint-config/base";
import { processEnvDiscipline, storageBoundaries } from "@hamboom/eslint-config/boundaries";

/** @type {import("eslint").Linter.Config[]} */
export default [
  // ⚠️ `probe/` اسکریپتِ شواهدِ گام ۳٫۰ است (خارج از verify، بعد از بستنِ فاز ۳ پاک می‌شود).
  //    `smoke/` رفت‌وبرگشتِ واقعیِ گام ۳٫۱ روی MinIO است (مثلِ db:smoke، بیرونِ verify، env می‌خواند).
  { ignores: ["dist/**", "probe/**", "smoke/**"] },
  ...base,
  // ★ P4/ADR-013: این **تنها** پکیجی است که `@aws-sdk/*` را import می‌کند، پس `storageBoundaries`
  //   عمداً `@aws-sdk` را **نمی‌بندد** — فقط UI و شبکه/دیتابیسِ دیگر را. خودآزمونش با Linter/ESLint
  //   (نه RuleTester، چون قاعده `no-restricted-imports`ِ خودِ ESLint است) در
  //   `packages/eslint-config/test/boundaries.test.js` است — هر سه لایه: الگو، سیم‌کشی، manifest.
  { ...storageBoundaries(), files: ["src/**/*.ts"] },
  // PLAN بخش ۴ — فقط `packages/config` حق خواندنِ `process.env` را دارد.
  { ...processEnvDiscipline(), files: ["src/**/*.ts"] },
];
