import base from "@hamboom/eslint-config/base";
import { processEnvDiscipline } from "@hamboom/eslint-config/boundaries";

/** @type {import("eslint").Linter.Config[]} */
export default [
  // ⚠️ `probe/` اسکریپتِ شواهدِ گام ۳٫۰ است (خارج از verify، بعد از گرفتنِ عدد پاک می‌شود).
  { ignores: ["dist/**", "probe/**"] },
  ...base,
  // ★ P4/ADR-013: این **تنها** پکیجی است که `@aws-sdk/*` را import می‌کند، پس اینجا قاعده‌ی
  //   منعِ `@aws-sdk` نداریم. `storageBoundaries` (منعِ UI و شبکه‌ی دیگر) در گام ۳٫۱ با
  //   RuleTester خودآزمون اضافه می‌شود.
  // PLAN بخش ۴ — فقط `packages/config` حق خواندنِ `process.env` را دارد.
  { ...processEnvDiscipline(), files: ["src/**/*.ts"] },
];
