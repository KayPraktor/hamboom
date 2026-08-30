import react from "@hamboom/eslint-config/react";

/** @type {import("eslint").Linter.Config[]} */
export default [{ ignores: ["dist/**"] }, ...react];
