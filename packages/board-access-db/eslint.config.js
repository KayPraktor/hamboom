import base from "@hamboom/eslint-config/base";
import { boardAccessDbBoundaries, processEnvDiscipline } from "@hamboom/eslint-config/boundaries";

/** @type {import("eslint").Linter.Config[]} */
export default [
  { ignores: ["dist/**"] },
  ...base,
  // ★ آداپتورِ pgِ نازک — pg مجاز، ولی UI/canvas/sdk/storage/شبکه‌ی دیگر ممنوع. خودآزمونِ سه‌لایه.
  { ...boardAccessDbBoundaries(), files: ["src/**/*.ts"] },
  // این پکیج `process.env` نمی‌خواند؛ `Queryable` را param می‌گیرد.
  { ...processEnvDiscipline(), files: ["src/**/*.ts"] },
];
