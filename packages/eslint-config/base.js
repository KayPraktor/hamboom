import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * پیکربندی پایه‌ی ESLint برای همه‌ی پکیج‌های هم‌بوم.
 *
 * توجه: عمداً از `recommended` (بدون type-checking) استفاده می‌شود نه
 * `recommendedTypeChecked` — چون type-aware linting به پیکربندی project
 * در هر پکیج نیاز دارد و کندتر است. وقتی کدبیس پایدار شد، در یک ADR
 * جداگانه به type-aware ارتقا داده می‌شود.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export default tseslint.config(
  {
    name: "hamboom/ignores",
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/*.d.ts",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    name: "hamboom/base",
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.es2021 },
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      /* متغیرهای بلااستفاده — پیشوند _ اجازه‌ی عمدی است */
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],

      /* import فقط-تایپ باید صریح باشد (سازگار با verbatimModuleSyntax) */
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],

      /* `any` ممنوع نیست ولی باید عمدی و قابل‌دیدن باشد */
      "@typescript-eslint/no-explicit-any": "warn",

      /* اصل P7 — هیچ PII در لاگ. console در کد محصولی ممنوع؛ از logger استفاده شود. */
      "no-console": ["error", { allow: ["warn", "error"] }],

      /* جلوگیری از باگ‌های رایج */
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-implicit-coercion": "error",
      "prefer-const": ["error", { destructuring: "all" }],
      "no-var": "error",
      "object-shorthand": ["error", "always"],

      /* پول همیشه عدد صحیح ریال است — ADR-015. شناور در محاسبات پولی خطای رایج است. */
      "no-loss-of-precision": "error",
    },
  },

  /* فایل‌های تست و اسکریپت‌ها قواعد سبک‌تری دارند */
  {
    name: "hamboom/tests-and-scripts",
    files: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}", "**/test/**", "scripts/**"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  /* prettier آخر می‌آید تا قواعد قالب‌بندی متعارض را خاموش کند */
  prettier,
);
