/**
 * Stylelint — گیتِ [ADR-016](ARCHITECTURE_DECISIONS.md#adr-016): فقط logical
 * properties، هیچ property فیزیکیِ جهت‌دار.
 *
 * عمداً از هیچ config پایه‌ای (`stylelint-config-standard`) ارث نمی‌برد تا فقط
 * همین یک نگرانی را اعمال کند و با قواعدِ سلیقه‌ایِ بی‌ربط نجنگد. الگوی «یک
 * gate، یک هدف» — مثل قاعده‌های ESLint سفارشیِ پروژه.
 *
 * ⚠️ استثنای بوم: `direction` (نه left/right) مجاز است — بوم داخل خودش LTR است
 * ([canvas-core/CLAUDE.md](packages/canvas-core/CLAUDE.md) خط قرمز ۲). این قاعده
 * هم `direction` را نمی‌گیرد؛ فقط margin/padding/inset/border و text-align جهت‌دار.
 */

/** @type {import("stylelint").Config} */
export default {
  ignoreFiles: ["**/node_modules/**", "**/dist/**"],
  rules: {
    "property-disallowed-list": [
      [
        "margin-left",
        "margin-right",
        "padding-left",
        "padding-right",
        "left",
        "right",
        "/^border-(left|right)($|-)/",
      ],
      {
        message:
          "ADR-016: property فیزیکیِ جهت‌دار ممنوع. از logical استفاده کن: " +
          "margin-inline-start/end، padding-inline، inset-inline-start، border-inline-*.",
      },
    ],
    "declaration-property-value-disallowed-list": [
      {
        "text-align": ["left", "right"],
        float: ["left", "right"],
        clear: ["left", "right"],
      },
      {
        message: "ADR-016: مقدارِ جهت‌دار ممنوع. text-align: start|end؛ بدون float/clear چپ/راست.",
      },
    ],
  },
};
