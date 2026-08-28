import base from "@hamboom/eslint-config/base";
import { processEnvDiscipline, sdkBoundaries } from "@hamboom/eslint-config/boundaries";

/** @type {import("eslint").Linter.Config[]} */
export default [
  { ignores: ["dist/**", "contract/**"] },
  ...base,
  // ★ sdk کلاینتِ نازک است — لایه‌های سرور/UI/Yjs/HTTP-lib ممنوع؛ فقط shared-types.
  //   خودآزمونِ سه‌لایه در `packages/eslint-config/test/boundaries.test.js`.
  { ...sdkBoundaries(), files: ["src/**/*.ts"] },
  // PLAN بخش ۴ — sdk `process.env` نمی‌خواند؛ baseUrl را param می‌گیرد (config کارِ apps/web است).
  { ...processEnvDiscipline(), files: ["src/**/*.ts"] },
];
