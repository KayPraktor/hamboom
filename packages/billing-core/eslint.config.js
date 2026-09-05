import base from "@hamboom/eslint-config/base";
import { billingCoreBoundaries, processEnvDiscipline } from "@hamboom/eslint-config/boundaries";

/** @type {import("eslint").Linter.Config[]} */
export default [
  { ignores: ["dist/**", "probe/**", "coverage/**"] },
  ...base,
  // ★ billing-core منطقِ خالص + پورت است (قرینه‌ی auth-core): ریاضیِ پول و آداپتورِ درگاه اینجا،
  //   ولی جدول‌ها و تراکنش در apps/api (فاز ۵). pg/ioredis/fastify/@aws-sdk و UI ممنوع.
  //   خودآزمونِ سه‌لایه در `packages/eslint-config/test/boundaries.test.js`.
  { ...billingCoreBoundaries(), files: ["src/**/*.ts"] },
  // PLAN بخش ۴ — فقط `packages/config` حق خواندنِ `process.env` را دارد؛ درگاه پیکربندی را param می‌گیرد.
  { ...processEnvDiscipline(), files: ["src/**/*.ts"] },
];
