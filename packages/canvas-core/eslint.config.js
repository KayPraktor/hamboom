import {
  canvasCoreBoundaries,
  captureUpdateDiscipline,
  elementKindDiscipline,
} from "@hamboom/eslint-config/boundaries";
import react from "@hamboom/eslint-config/react";

/** @type {import("eslint").Linter.Config[]} */
export default [
  { ignores: ["dist/**"] },
  ...react,
  // ADR-003 / PLAN بخش ۲ — بوم باید کاملاً آفلاین بماند.
  canvasCoreBoundaries(),
  // ADR-010 — همه‌جا به‌جز لایه‌ی نگاشت که تنها جای مجاز خواندن `type` است.
  {
    ...elementKindDiscipline(),
    files: ["src/**/*.{ts,tsx}", "dev/**/*.{ts,tsx}"],
    ignores: ["src/elements/mapping.ts", "src/elements/mapping.test.ts"],
  },
  // ADR-026 — هر updateScene باید captureUpdate صریح داشته باشد.
  {
    ...captureUpdateDiscipline(),
    files: ["src/**/*.{ts,tsx}", "dev/**/*.{ts,tsx}"],
  },
];
