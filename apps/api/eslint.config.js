import base, { nodeGlobals } from "@hamboom/eslint-config/base";
import { apiBoundaries, processEnvDiscipline } from "@hamboom/eslint-config/boundaries";

/** @type {import("eslint").Linter.Config[]} */
export default [
  { ignores: ["dist/**", ".data/**", "migrations/**"] },
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
