import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

import base from "./base.js";

/**
 * پیکربندی ESLint برای پکیج‌ها و اپ‌های React (canvas-core, ui, web, admin).
 *
 * @type {import("eslint").Linter.Config[]}
 */
export default tseslint.config(
  ...base,

  {
    name: "hamboom/react",
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },

  /*
   * ADR-016 — RTL: هیچ property فیزیکی جهت‌داری در style های inline.
   * (نسخه‌ی کامل این قاعده برای CSS در گام ۴٫۱ با Stylelint اضافه می‌شود.)
   */
  {
    name: "hamboom/rtl-inline-style",
    files: ["**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXAttribute[name.name='style'] Property[key.name=/^(marginLeft|marginRight|paddingLeft|paddingRight|borderLeft|borderRight|left|right)$/]",
          message:
            "ADR-016: از logical property استفاده کن (marginInlineStart، insetInlineEnd، ...) نه property فیزیکی جهت‌دار.",
        },
      ],
    },
  },
);
