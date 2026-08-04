import base from "@hamboom/eslint-config/base";
import { canvasSyncBoundaries } from "@hamboom/eslint-config/boundaries";

/** @type {import("eslint").Linter.Config[]} */
export default [
  { ignores: ["dist/**"] },
  ...base,
  // ADR-029 — تنها جایی در M2 که مجاز است `canvas-core` را ببیند. ولی کدِ سرور
  // (ws/pg/ioredis) و دسترسیِ مستقیم به storage/auth/sdk اینجا راه ندارد؛
  // آن‌ها از راهِ پورت می‌آیند (ADR-031). فقط روی `src/`.
  { ...canvasSyncBoundaries(), files: ["src/**/*.ts"] },
];
