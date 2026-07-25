import base from "@hamboom/eslint-config/base";
import { packageBoundaries } from "@hamboom/eslint-config/boundaries";

/** @type {import("eslint").Linter.Config[]} */
export default [
  { ignores: ["dist/**"] },
  ...base,
  // i18n یک لایه‌ی پایه است و به هیچ پکیج هم‌بومِ دیگری وابسته نمی‌شود
  // (فقط Intl بومیِ زبان). فقط روی `src/` اعمال می‌شود.
  {
    ...packageBoundaries({
      forbid: ["@hamboom/*"],
      reason:
        "i18n لایه‌ی پایه است و باید بدون وابستگی به پکیج‌های دیگر بماند. " +
        "فقط از Intl بومی استفاده می‌کند، بدون کتابخانه‌ی تاریخ/عدد.",
    }),
    files: ["src/**/*.ts"],
  },
];
