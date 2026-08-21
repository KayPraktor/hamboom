import { authCoreBoundaries, processEnvDiscipline } from "@hamboom/eslint-config/boundaries";
import base from "@hamboom/eslint-config/base";

/** @type {import("eslint").Linter.Config[]} */
export default [
  { ignores: ["dist/**", "probe/**"] },
  ...base,
  // ★ auth-core منطقِ خالص + پورت است — pg/ioredis/ws/@aws-sdk ممنوع (DBشان در apps/api، فاز ۵).
  //   خودآزمونِ سه‌لایه در `packages/eslint-config/test/boundaries.test.js`.
  { ...authCoreBoundaries(), files: ["src/**/*.ts"] },
  // PLAN بخش ۴ — فقط `packages/config` حق خواندنِ `process.env` را دارد (auth-core secret را param می‌گیرد).
  { ...processEnvDiscipline(), files: ["src/**/*.ts"] },
];
