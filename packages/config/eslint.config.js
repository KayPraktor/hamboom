import base from "@hamboom/eslint-config/base";
import { packageBoundaries } from "@hamboom/eslint-config/boundaries";

/** @type {import("eslint").Linter.Config[]} */
export default [
  { ignores: ["dist/**"] },
  ...base,
  // PLAN بخش ۴ — این پکیج پایین‌ترین لایه است و به هیچ پکیج هم‌بومِ دیگری وابسته
  // نمی‌شود. (خودش تنها جایی است که `process.env` را می‌خواند، پس قاعده‌ی
  // `processEnvDiscipline` عمداً اینجا اعمال **نمی‌شود**.)
  {
    ...packageBoundaries({
      forbid: ["@hamboom/*"],
      reason:
        "config پایین‌ترین لایه است — همه رویش سوارند و خودش به هیچ‌کس وابسته نیست. " +
        "اگر به چیزی نیاز داری، مصرف‌کننده باید تزریقش کند.",
    }),
    files: ["src/**/*.ts"],
  },
];
