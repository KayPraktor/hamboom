import base from "@hamboom/eslint-config/base";

/**
 * پیکربندی ESLint ریشه — فقط برای اسکریپت‌ها و فایل‌های پیکربندی خودِ ریشه.
 * هر پکیج/اپ `eslint.config.js` خودش را دارد.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export default [
  {
    ignores: ["apps/**", "packages/**", "infra/**", "docs/**", "vendor/**", "patches/**"],
  },
  ...base,
];
