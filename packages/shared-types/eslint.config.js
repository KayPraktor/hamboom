import base from "@hamboom/eslint-config/base";
import { packageBoundaries } from "@hamboom/eslint-config/boundaries";

/** @type {import("eslint").Linter.Config[]} */
export default [
  { ignores: ["dist/**"] },
  ...base,
  // ADR-021 — این پکیج پایین‌ترین لایه است و به هیچ پکیج دیگری وابسته نمی‌شود.
  // فقط روی `src/` اعمال می‌شود؛ فایل‌های پیکربندی خودِ پکیج طبیعتاً به
  // `@hamboom/eslint-config` و `@hamboom/tsconfig` نیاز دارند.
  {
    ...packageBoundaries({
      forbid: ["@hamboom/*"],
      reason:
        "shared-types قرارداد مشترک است و باید بدون وابستگی بماند. " +
        "اگر به چیزی نیاز داری، یا اینجا تعریفش کن یا در پکیج مصرف‌کننده.",
    }),
    files: ["src/**/*.ts"],
  },
];
