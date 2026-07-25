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
 * انضباط ADR-026 — هر `updateScene` باید `captureUpdate` را **صریح** انتخاب کند.
 *
 * ── چرا یک قاعده لازم شد ──────────────────────────────────────────────
 *
 * سه باگِ جدا از یک خانواده دیده شد که همه‌شان از «انتخابِ خاموشِ captureUpdate»
 * می‌آمدند: تغییرِ رنگ که default می‌گرفت و یک undo کل ژست قبلی را پاک می‌کرد،
 * و ترتیبِ اشتباهِ pending/saved در تصویر. مشترکشان این بود که نویسنده
 * `captureUpdate` را **ننوشت** و موتور بی‌صدا رفتار پیش‌فرض را گرفت.
 *
 * این قاعده صرفاً **حضورِ صریحِ فیلد** را الزام می‌کند؛ مقدارش را قضاوت نمی‌کند
 * (چون درست/غلط بودنِ ترتیب به وضعیتِ تاریخچه در زمان اجرا بستگی دارد و
 * static نیست). ولی همین که نویسنده مجبور شود آگاهانه یکی از
 * `IMMEDIATELY`/`NEVER`/`EVENTUALLY` را بنویسد، کلاسِ «defaultِ خاموش» را حذف می‌کند.
 *
 * راهِ توصیه‌شده: به‌جای `updateScene` خام از `commitGesture`/`commitSystemUpdate`
 * در `engine/scene-commit.ts` استفاده شود که انتخاب را در یک نقطه ثابت می‌کنند.
 *
 * ── چرا قاعده‌ی سفارشی، نه `no-restricted-syntax` ─────────────────────
 *
 * تشخیصِ «شیئی که فیلد captureUpdate **ندارد**» به نفیِ `:has` نیاز دارد که
 * esquery پشتیبانی نمی‌کند. پس یک قاعده‌ی واقعی با `create()`. برای پرهیز از
 * مثبتِ کاذب، اگر آرگومان spread داشته باشد (`{ ...x }`) رد می‌شود — ممکن است
 * captureUpdate از آنجا بیاید.
 *
 * @returns {import("eslint").Linter.Config}
 */
/**
 * قاعده‌ی خامِ «هر updateScene باید captureUpdate صریح داشته باشد».
 *
 * جدا صادر می‌شود تا با `RuleTester` مستقیم آزموده شود — یک گیت که خودش
 * آزموده نشود، گیت نیست.
 *
 * @type {import("eslint").Rule.RuleModule}
 */
export const requireCaptureUpdateRule = {
  meta: {
    type: "problem",
    docs: {
      description: "هر updateScene باید captureUpdate صریح داشته باشد (ADR-026).",
    },
    schema: [],
    messages: {
      missing:
        "ADR-026: این فراخوانی updateScene فیلد captureUpdate ندارد. " +
        "یکی از 'IMMEDIATELY' (ژست کاربر) / 'NEVER' (تغییر سیستمی یا remote) / " +
        "'EVENTUALLY' را صریح بنویس — یا از commitGesture/commitSystemUpdate " +
        "در engine/scene-commit.ts استفاده کن. بدون آن، موتور بی‌صدا رفتار پیش‌فرض " +
        "می‌گیرد و یک undo می‌تواند کل ژست قبلی را پاک کند.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression") return;
        if (callee.property.type !== "Identifier" || callee.property.name !== "updateScene") {
          return;
        }
        const arg = node.arguments[0];
        if (!arg || arg.type !== "ObjectExpression") return;

        let hasCapture = false;
        let hasSpread = false;
        for (const prop of arg.properties) {
          if (prop.type === "SpreadElement") {
            hasSpread = true;
            continue;
          }
          if (prop.type !== "Property" || prop.computed) continue;
          const key = prop.key;
          if (
            (key.type === "Identifier" && key.name === "captureUpdate") ||
            (key.type === "Literal" && key.value === "captureUpdate")
          ) {
            hasCapture = true;
          }
        }

        if (!hasCapture && !hasSpread) {
          context.report({ node, messageId: "missing" });
        }
      },
    };
  },
};

export function captureUpdateDiscipline() {
  return {
    name: "hamboom/capture-update-discipline",
    plugins: { hamboom: { rules: { "require-capture-update": requireCaptureUpdateRule } } },
    rules: { "hamboom/require-capture-update": "error" },
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
