import base, { nodeGlobals } from "@hamboom/eslint-config/base";
import { apiBoundaries, processEnvDiscipline } from "@hamboom/eslint-config/boundaries";

/** @type {import("eslint").Linter.Config[]} */
export default [
  // ⚠️ `probe/` اسکریپتِ شواهدِ فاز ۱ی M4 است (مثلِ `probe/`ِ storage در گام ۳٫۰): بیرونِ
  //    verify، خروجی‌اش با `console.log` گزارش می‌دهد، و بعد از بستنِ فاز ۱ پاک می‌شود.
  //    اینجا زندگی می‌کند و نه در `scripts/`، چون `fastify` از ریشه‌ی مونوریپو resolve نمی‌شود.
  { ignores: ["dist/**", ".data/**", "migrations/**", "probe/**"] },
  ...base,
  // کدِ سرور است، پس globalهای Node را دارد. از `eslint-config` می‌آید نه از
  // `globals`ِ مستقیم — زیر pnpm خودِ اپ نمی‌تواند resolveش کند.
  { ...nodeGlobals, files: ["src/**/*.ts"] },
  // M3 فاز ۵ — به S3 فقط از راهِ storage (P4)، نه موتورِ رندر/React، نه @hamboom/sdk (دورِ باطل).
  // ⚠️ `@hamboom/storage`/`auth-core`/`assets` عمداً مجازند: api بالاترین مصرف‌کننده‌شان است.
  { ...apiBoundaries(), files: ["src/**/*.ts"] },
  // PLAN بخش ۴ — فقط `packages/config` حق خواندنِ `process.env` را دارد؛ api از loadEnv می‌خواند.
  { ...processEnvDiscipline(), files: ["src/**/*.ts"] },
];
