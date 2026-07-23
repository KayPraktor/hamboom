/**
 * قواعد مرز وابستگی بین پکیج‌ها — PLAN.md بخش ۲.
 *
 *   apps/*      →  packages/*   ✅
 *   packages/*  →  packages/*   ✅ (بدون چرخه)
 *   packages/*  →  apps/*       ❌ هرگز
 *   canvas-core →  sdk/storage  ❌ (بوم باید مستقل از شبکه بماند)
 *   ydoc-schema →  canvas-core  ❌ (ydoc-schema لایه‌ی پایین‌تر است)
 *
 * این فایل فقط سازنده‌ی قاعده است؛ هر پکیج خودش تصمیم می‌گیرد کدام را اعمال کند.
 */

/** پکیج‌هایی که هیچ پکیجی داخل `packages/` حق import شان را ندارد. */
const APPS_PATTERN = {
  group: ["@hamboom/api", "@hamboom/web", "@hamboom/realtime", "@hamboom/worker", "@hamboom/admin"],
  message: "پکیج‌های packages/* نباید به apps/* وابسته باشند (PLAN.md بخش ۲).",
};

/**
 * ساخت قاعده‌ی `no-restricted-imports` برای یک پکیج.
 * @param {{ forbid?: string[], reason?: string, includeApps?: boolean }} [options]
 * @returns {import("eslint").Linter.Config}
 */
export function packageBoundaries(options = {}) {
  const { forbid = [], reason = "نقض مرز وابستگی پکیج‌ها.", includeApps = true } = options;

  /** @type {{ group: string[], message: string }[]} */
  const patterns = [];
  if (includeApps) patterns.push(APPS_PATTERN);
  if (forbid.length > 0) patterns.push({ group: forbid, message: reason });

  return {
    name: "hamboom/boundaries",
    rules: {
      "no-restricted-imports": ["error", { patterns }],
    },
  };
}

/**
 * انضباط ADR-010 — هیچ کدی خارج از لایه‌ی نگاشت روی `element.type` شرط نگذارد.
 *
 * `type` چیزی است که موتور رندر می‌فهمد؛ `customData.hb.kind` چیزی است که
 * محصول می‌فهمد. یک استیکی‌نوت و یک شکل هر دو `rectangle` اند، پس هر شرطی روی
 * `type` که بخواهد معنای محصولی را تشخیص دهد، **غلط است** — و بدتر: بی‌صدا
 * غلط است، چون کد کامپایل می‌شود و در حالت‌های ساده هم درست کار می‌کند.
 *
 * ── چرا هر دو سرِ مقایسه شرط دارند ────────────────────────────────────
 *
 * قاعده هم نام نوع‌های واقعی عنصر را می‌خواهد **و هم** اینکه سمت چپ یک
 * دسترسی به `.type` باشد. اگر فقط مقدار سمت راست ملاک بود:
 *
 * - `event.type === "click"` گیر نمی‌کرد (چون "click" در فهرست نیست) ✓
 * - ولی `shape === "rectangle"` گیر می‌کرد — یک پارامتر تابع، نه نوع عنصر ✗
 *
 * دومی در گام ۳٫۳ واقعاً رخ داد. قاعده‌ای که مثبت کاذب می‌دهد، دور زده
 * می‌شود یا خاموش — و آن‌وقت مورد واقعی را هم دیگر نمی‌گیرد.
 *
 * هزینه‌ی پذیرفته‌شده: `const t = el.type; if (t === "rectangle")` فرار می‌کند.
 * قاعده برای گرفتن اشتباه سهوی است، نه دور زدن عمدی.
 *
 * @returns {import("eslint").Linter.Config}
 */
export function elementKindDiscipline() {
  const ELEMENT_TYPES = "rectangle|ellipse|diamond|arrow|line|freedraw|frame|magicframe";

  return {
    name: "hamboom/element-kind-discipline",
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            `BinaryExpression[operator=/^[!=]==$/]` +
            `[left.property.name="type"]` +
            `[right.value=/^(${ELEMENT_TYPES})$/]`,
          message:
            "ADR-010: روی element.type شرط نگذار — استیکی و شکل هر دو rectangle اند. " +
            "از getKind(element) در elements/mapping.ts استفاده کن. " +
            "اگر واقعاً به نوع رندر نیاز داری، کدت جایش در همان mapping.ts است.",
        },
        {
          selector:
            `SwitchStatement[discriminant.property.name="type"] > SwitchCase > ` +
            `Literal[value=/^(${ELEMENT_TYPES})$/]`,
          message:
            "ADR-010: switch روی element.type بیرون از mapping.ts ممنوع است. " +
            "از getKind(element) استفاده کن.",
        },
      ],
    },
  };
}

/**
 * پیش‌تنظیم برای `packages/canvas-core` — ADR-003 / ADR-021.
 * بوم باید کاملاً آفلاین و بدون شبکه قابل اجرا باشد.
 * @returns {import("eslint").Linter.Config}
 */
export function canvasCoreBoundaries() {
  return packageBoundaries({
    forbid: ["@hamboom/sdk", "@hamboom/storage", "@hamboom/auth-core", "yjs", "y-*", "axios", "ky"],
    reason:
      "canvas-core نباید هیچ وابستگی به شبکه، Yjs یا احراز هویت داشته باشد. " +
      "ارتباط با بیرون فقط از طریق CanvasSyncAdapter در sync/contract.ts.",
  });
}
