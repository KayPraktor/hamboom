import { canvasCoreBoundaries } from "@hamboom/eslint-config/boundaries";
import react from "@hamboom/eslint-config/react";

/** @type {import("eslint").Linter.Config[]} */
export default [
  { ignores: ["dist/**"] },
  ...react,
  // ADR-003 / PLAN بخش ۲ — بوم باید کاملاً آفلاین بماند.
  canvasCoreBoundaries(),
];
