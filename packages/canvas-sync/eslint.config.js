import { canvasSyncBoundaries, processEnvDiscipline } from "@hamboom/eslint-config/boundaries";
import react from "@hamboom/eslint-config/react";

/** @type {import("eslint").Linter.Config[]} */
export default [
  { ignores: ["dist/**"] },
  // `dev/` یک اپِ ری‌اکتی است (صفحه‌ی probe و بعداً دموی دو-نمونه‌ایِ G-1)،
  // پس پیش‌تنظیمِ react لازم است. خودِ binder در `src/` ری‌اکت لازم ندارد.
  ...react,
  // ADR-029 — تنها جایی در M2 که مجاز است `canvas-core` را ببیند. ولی کدِ سرور
  // (ws/pg/ioredis) و دسترسیِ مستقیم به storage/auth/sdk اینجا راه ندارد؛
  // آن‌ها از راهِ پورت می‌آیند (ADR-031). فقط روی `src/`.
  { ...canvasSyncBoundaries(), files: ["src/**/*.ts"] },
  // PLAN بخش ۴ — فقط `packages/config` حق خواندنِ `process.env` را دارد.
  { ...processEnvDiscipline(), files: ["src/**/*.ts"] },
];
