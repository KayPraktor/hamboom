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
