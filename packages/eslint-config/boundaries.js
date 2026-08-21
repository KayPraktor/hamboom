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

/**
 * ── نکته‌ی تطبیقِ الگو (probe شده در گام ۰٫۲ M2، نه حدس) ──────────────
 *
 * شهودِ رایج می‌گوید در گلاب، `*` از `/` عبور نمی‌کند. **در
 * `no-restricted-imports` این‌طور نیست.** با probeِ واقعی روی ESLint ۹:
 *
 *   "@aws-sdk/*"    → @aws-sdk/client-s3  **و**  @aws-sdk/client-s3/dist/index.js ✓
 *   "@hamboom/sdk"  → @hamboom/sdk        **و**  @hamboom/sdk/client             ✓
 *   "y-*"           → y-protocols         **و**  y-protocols/awareness           ✓
 *   "y-*"           → ولی `yjs` را **نمی‌گیرد** (باید جدا نوشته شود)
 *
 * یعنی الگوها باید **ساده** بمانند؛ افزودنِ `/**` زائد است. این را اینجا
 * می‌نویسیم تا کسی بعداً «اصلاحش» نکند یا فرض نکند زیرمسیر از گیت رد می‌شود.
 * تستِ `test/boundaries.test.js` همین را pin می‌کند.
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
    plugins: { hamboom: hamboomPlugin },
    rules: { "hamboom/require-capture-update": "error" },
  };
}

/**
 * ★★ قاعده‌ی **باریک‌ترِ** مسیرِ remote — گام ۳٫۲.
 *
 * `require-capture-update` فقط می‌گوید «صریح انتخاب کن». اینجا انتخاب از قبل
 * معلوم است: در مسیرِ اعمالِ تغییرِ **remote** تنها `"NEVER"` درست است
 * ([ADR-026](../../ARCHITECTURE_DECISIONS.md#adr-026)).
 *
 * ── چرا یک قاعده‌ی جدا و نه یک کامنت ──────────────────────────────────
 *
 * `IMMEDIATELY` در این مسیر یک باگِ **بی‌صدا** می‌سازد: کارِ کاربرِ دیگر در undo
 * stackِ محلیِ این کاربر می‌نشیند و `Ctrl+Z` او کارِ آن یکی را برمی‌گرداند —
 * دقیقاً چیزی که [ADR-012](../../ARCHITECTURE_DECISIONS.md#adr-012) منع کرده. نه
 * خطا می‌دهد، نه در تستِ واحد دیده می‌شود؛ فقط دو کاربر یک روز می‌فهمند کارشان
 * پاک می‌شود.
 *
 * جدا صادر می‌شود تا با `RuleTester` مستقیم آزموده شود (قاعده‌ی ۱۰).
 *
 * @type {import("eslint").Rule.RuleModule}
 */
export const remoteWritesNeverRule = {
  meta: {
    type: "problem",
    docs: {
      description: "در مسیرِ تغییرِ remote فقط captureUpdate: 'NEVER' مجاز است (ADR-026).",
    },
    schema: [],
    messages: {
      notNever:
        "ADR-026: در مسیرِ remote فقط captureUpdate: 'NEVER' مجاز است. " +
        "با هر مقدارِ دیگری کارِ کاربرِ دیگر در undo stackِ محلی می‌نشیند و " +
        "Ctrl+Z این کاربر کارِ آن یکی را برمی‌گرداند (ADR-012).",
      gesture:
        "ADR-026: commitGesture یک ورودی undo می‌سازد و در مسیرِ remote جا ندارد. " +
        "از commitSystemUpdate استفاده کن (captureUpdate: 'NEVER').",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        // `commitGesture(...)` یا `x.commitGesture(...)`
        const name =
          callee.type === "Identifier"
            ? callee.name
            : callee.type === "MemberExpression" &&
                callee.property.type === "Identifier" &&
                !callee.computed
              ? callee.property.name
              : null;
        if (name === "commitGesture") context.report({ node, messageId: "gesture" });
      },
      Property(node) {
        if (node.computed) return;
        const key = node.key;
        const isCapture =
          (key.type === "Identifier" && key.name === "captureUpdate") ||
          (key.type === "Literal" && key.value === "captureUpdate");
        if (!isCapture) return;
        // مقدارِ غیرِ literal قابلِ بازرسی نیست — مثبتِ کاذب نمی‌سازیم.
        if (node.value.type !== "Literal") return;
        if (node.value.value !== "NEVER") context.report({ node, messageId: "notNever" });
      },
    };
  },
};

/**
 * پیش‌تنظیمِ مسیرِ remote. **روی `files` باریک اعمال شود**، نه کلِ پکیج — وگرنه
 * مسیرِ محلی (که `IMMEDIATELY` می‌خواهد) هم خطا می‌گیرد.
 */
export function remoteCaptureDiscipline() {
  return {
    name: "hamboom/remote-capture-discipline",
    plugins: { hamboom: hamboomPlugin },
    rules: { "hamboom/remote-writes-never": "error" },
  };
}

/**
 * ★ **یک** پلاگین با همه‌ی قاعده‌های خودمان — و **یک نمونه‌ی مشترک**.
 *
 * ⚠️ تله‌ای که در گام ۳٫۲ خورد: در flat config اگر دو config object که به یک
 * فایل اعمال می‌شوند هرکدام `plugins: { hamboom: {...} }`ِ **جدا** بسازند، ESLint
 * با `Cannot redefine plugin "hamboom"` می‌افتد. پس هر دو factory باید به همین
 * یک شیء ارجاع دهند، نه به دو شیء هم‌شکل.
 */
const hamboomPlugin = {
  rules: {
    "require-capture-update": requireCaptureUpdateRule,
    "remote-writes-never": remoteWritesNeverRule,
  },
};

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

/**
 * انضباط PLAN بخش ۴ — فقط `packages/config` حق خواندنِ `process.env` را دارد.
 *
 * ── چرا این هم یک گیت لازم دارد ───────────────────────────────────────
 *
 * وقتی `process.env.FOO` در ده جا پخش باشد، سه چیز **بی‌صدا** خراب می‌شود:
 * هر مصرف‌کننده پیش‌فرضِ خودش را می‌گذارد (و پیش‌فرض‌ها با هم فرق می‌کنند)؛
 * `undefined` در رشته‌سازی به `"undefined"` تبدیل می‌شود به‌جای اینکه خطا بدهد؛
 * و متغیرِ گم‌شده به‌جای اینکه در **بوت** داد بزند، وسطِ کار خودش را نشان می‌دهد.
 * fail-fastِ متمرکز فقط وقتی معنا دارد که راهِ فرار بسته باشد.
 *
 * `process.env.NODE_ENV` هم استثنا **نمی‌شود**: همان هم باید از config بیاید،
 * وگرنه اولین استثنا در عمل کلِ قاعده را باز می‌کند.
 *
 * @returns {import("eslint").Linter.Config}
 */
export function processEnvDiscipline() {
  return {
    name: "hamboom/process-env-discipline",
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: 'MemberExpression[object.name="process"][property.name="env"]',
          message:
            "PLAN بخش ۴: فقط packages/config حق خواندنِ process.env را دارد. " +
            "یک schema در @hamboom/config تعریف کن و با loadEnv بخوان — تا متغیرِ " +
            "گم‌شده در بوت داد بزند، نه وسطِ کار.",
        },
      ],
    },
  };
}

/* ═══ مرزهای ماژول M2 — ADR-029 / ADR-031 ═══════════════════════════════
 *
 * سه واحدِ M2 سه مرزِ متفاوت دارند و اینجا در **یک منبع** تعریف می‌شوند
 * (ADR-024). هر سه در `test/boundaries.test.js` خودآزمون‌اند — هم فهرستِ
 * الگوها، هم سیم‌کشی‌شان به `eslint.config.js`ِ خودِ پکیج.
 */

/**
 * `packages/ydoc-schema` — پایین‌ترین لایه‌ی M2 ([ADR-029](../../ARCHITECTURE_DECISIONS.md#adr-029)).
 *
 * تنها چیزی که **هم کلاینت و هم سرور** مصرفش می‌کنند. پس نه UI می‌بیند و نه
 * وابستگیِ سرور: اگر canvas-core را ببیند، سرورِ Node برای typecheck کلِ گرافِ
 * تایپِ Excalidraw و React را می‌کِشد؛ اگر `pg`/`ws` را ببیند، دیگر در مرورگر
 * قابلِ استفاده نیست. هر دو جهت باید بسته بماند.
 *
 * @returns {import("eslint").Linter.Config}
 */
export function ydocSchemaBoundaries() {
  return packageBoundaries({
    forbid: [
      "@hamboom/canvas-core",
      "@hamboom/canvas-sync",
      "@hamboom/sdk",
      "@hamboom/storage",
      "@hamboom/auth-core",
      "react",
      "react-dom",
      "@excalidraw/*",
      "@aws-sdk/*",
      "ws",
      "pg",
      "ioredis",
    ],
    reason:
      "ydoc-schema پایین‌ترین لایه است و هم کلاینت و هم سرور مصرفش می‌کنند (ADR-029). " +
      "نه UI (react/excalidraw/canvas-core) و نه وابستگیِ سرور (ws/pg/ioredis/aws-sdk). " +
      "اگر به قراردادِ بوم نیاز داری، جایش packages/canvas-sync است نه اینجا.",
  });
}

/**
 * `packages/canvas-sync` — binder سمتِ کلاینت ([ADR-029](../../ARCHITECTURE_DECISIONS.md#adr-029)).
 *
 * تنها جایی در M2 که مجاز است `canvas-core` را ببیند — و **به‌صورت مقدار**، نه
 * فقط تایپ: باید `assertEmittable` را از همان‌جا صدا بزند نه اینکه نگهبانِ echo
 * را از نو بنویسد (ADR-024). ولی کدِ سرور اینجا راه ندارد.
 *
 * @returns {import("eslint").Linter.Config}
 */
export function canvasSyncBoundaries() {
  return packageBoundaries({
    forbid: [
      "@hamboom/sdk",
      "@hamboom/storage",
      "@hamboom/auth-core",
      "@aws-sdk/*",
      "ws",
      "pg",
      "ioredis",
    ],
    reason:
      "canvas-sync کدِ کلاینت است؛ وابستگیِ سرور (ws/pg/ioredis) و دسترسیِ مستقیم به " +
      "storage/auth/sdk اینجا جا ندارد — از راهِ پورت‌ها می‌آید (ADR-031).",
  });
}

/**
 * `apps/realtime` — سرور ([ADR-029](../../ARCHITECTURE_DECISIONS.md#adr-029) /
 * [ADR-031](../../ARCHITECTURE_DECISIONS.md#adr-031)).
 *
 * ⚠️ **`@hamboom/storage` و `@hamboom/auth-core` عمداً مجازند.** ممنوعیت روی
 * `@aws-sdk/*`ِ **خام** است، نه روی abstraction: خودِ P4 می‌گوید مسیرِ درست
 * `packages/storage` است، و [ADR-012](../../ARCHITECTURE_DECISIONS.md#adr-012)
 * صریحاً می‌خواهد سرورِ realtime و API از **یک** `effectiveBoardRole` مشترک در
 * `auth-core` استفاده کنند. بستنِ آن‌ها یعنی بستنِ همان مسیری که ADR تجویز کرده.
 *
 * @returns {import("eslint").Linter.Config}
 */
export function realtimeBoundaries() {
  return packageBoundaries({
    forbid: [
      "@hamboom/canvas-core",
      "@hamboom/canvas-sync",
      "@hamboom/sdk",
      "react",
      "react-dom",
      "@excalidraw/*",
      "@aws-sdk/*",
    ],
    reason:
      "سرورِ realtime نباید موتورِ رندر یا React را ببیند (ADR-029)، و نباید مستقیم به " +
      "Object Storage وصل شود — فقط از راهِ packages/storage (P4). با API هم از راهِ کدِ " +
      "مشترکِ auth-core حرف می‌زند، نه از راهِ @hamboom/sdk (ADR-012).",
  });
}

/**
 * `packages/storage` — abstractionِ Object Storage، افزوده‌ی M3 گام ۳٫۱
 * ([ADR-013](../../ARCHITECTURE_DECISIONS.md#adr-013)).
 *
 * ⚠️ **`@aws-sdk/*` اینجا عمداً مجاز است** — این **تنها** پکیجی است که حق دیدنِ SDKِ
 * خام را دارد (P4). ممنوعیت روی UI، لایه‌های بالاتر (`sdk`/`auth-core`)، و شبکه/دیتابیسِ
 * دیگر است: storage فقط با S3 حرف می‌زند، نه با ws/pg/ioredis/axios.
 *
 * ★ درست مثلِ نگهبانِ `@hamboom/storage`ِ realtime، تستِ **`allowed`** اینجا نگهبانِ یک
 *   اشتباهِ محتمل است: کسی که P4 را سرسری بخواند ممکن است `@aws-sdk` را همین‌جا هم ببندد —
 *   که یعنی بستنِ همان مسیری که P4 تجویزش کرده. آن import باید **مجاز** بماند.
 *
 * @returns {import("eslint").Linter.Config}
 */
export function storageBoundaries() {
  return packageBoundaries({
    forbid: [
      "@hamboom/canvas-core",
      "@hamboom/canvas-sync",
      "@hamboom/sdk",
      "@hamboom/auth-core",
      "react",
      "react-dom",
      "@excalidraw/*",
      "ws",
      "pg",
      "ioredis",
      "axios",
      "ky",
    ],
    reason:
      "storage فقط abstractionِ Object Storage است (P4): @aws-sdk مجاز است، ولی UI، لایه‌های " +
      "بالاتر (sdk/auth-core)، و شبکه/دیتابیسِ دیگر (ws/pg/ioredis/axios/ky) اینجا جا ندارند.",
  });
}

/**
 * `packages/assets` — لایه‌ی دامنه‌ی دارایی، افزوده‌ی M3 گام ۳٫۳.
 *
 * ★★ **برخلافِ `storageBoundaries`، اینجا `@aws-sdk/*` ممنوع است** (P4). assets به Object Storage
 * فقط از راهِ `@hamboom/storage` می‌رسد، نه SDKِ خام — همان مرزی که storage را **نازک** نگه می‌دارد:
 * منطقِ دامنه (قاعده‌ی mime، کلیدِ team/board، sniff، sha256) اینجاست، دروازه‌ی S3 آنجا. تناظرِ
 * [ADR-029](../../ARCHITECTURE_DECISIONS.md#adr-029): assets↔storage مثلِ canvas-sync↔ydoc-schema.
 * تستِ **`forbidden` روی `@aws-sdk`** نگهبانِ همین است — اگر روزی باز شود، storage دیگر نازک نیست.
 *
 * مجاز: `@hamboom/storage` (مصرفش می‌کند)، `@hamboom/shared-types`، `@hamboom/config`.
 *
 * @returns {import("eslint").Linter.Config}
 */
export function assetsBoundaries() {
  return packageBoundaries({
    forbid: [
      "@hamboom/canvas-core",
      "@hamboom/canvas-sync",
      "@hamboom/sdk",
      "@hamboom/auth-core",
      "@aws-sdk/*",
      "react",
      "react-dom",
      "@excalidraw/*",
      "ws",
      "pg",
      "ioredis",
      "axios",
      "ky",
    ],
    reason:
      "assets لایه‌ی دامنه‌ی دارایی است، نه دروازه‌ی S3: به Object Storage فقط از راهِ " +
      "@hamboom/storage می‌رسد (@aws-sdk ممنوع، P4)، و UI/شبکه/دیتابیسِ دیگر هم اینجا جا ندارند.",
  });
}

/**
 * `packages/auth-core` — منطقِ احراز هویت و نقش، افزوده‌ی M3 فاز ۴.
 *
 * ★ **منطقِ خالص + پورت است، نه یک اپِ کامل.** JWT (`jose`)، `effectiveBoardRole`، و منطقِ
 * refresh/OTP پشتِ پورت‌های store قرار دارند؛ **پیاده‌سازیِ DBِ آن پورت‌ها در `apps/api` (فاز ۵)
 * است، نه اینجا** — همان‌طور که realtime پورتِ `SnapshotStore` را دارد ولی خودش به S3 وصل نمی‌شود.
 * پس `pg`/`ioredis`/`ws` اینجا ممنوع‌اند، و `@aws-sdk` هم (P4). مجاز: `jose`، `@hamboom/shared-types`،
 * `@hamboom/config`، `node:crypto`.
 *
 * @returns {import("eslint").Linter.Config}
 */
export function authCoreBoundaries() {
  return packageBoundaries({
    forbid: [
      "@hamboom/canvas-core",
      "@hamboom/canvas-sync",
      "@hamboom/sdk",
      "@hamboom/storage",
      "@aws-sdk/*",
      "react",
      "react-dom",
      "@excalidraw/*",
      "ws",
      "pg",
      "ioredis",
      "axios",
      "ky",
    ],
    reason:
      "auth-core منطقِ خالص + پورت است: JWT/نقش/OTP اینجا، ولی پیاده‌سازیِ DBِ پورت‌ها در apps/api " +
      "(فاز ۵). پس pg/ioredis/ws و @aws-sdk اینجا جا ندارند؛ مجاز: jose، shared-types، config.",
  });
}

/**
 * `apps/api` — REST APIِ Fastify، افزوده‌ی M3 فاز ۵.
 *
 * ★ **لایه‌ی داده/REST است، نه UI و نه دروازه‌ی S3.** بالاترین مصرف‌کننده‌ی پکیج‌های M3:
 * `@hamboom/storage` (پلاگینِ s3)، `@hamboom/auth-core` (JWT/نقش/refresh/OTP)، `@hamboom/assets`
 * (presign/commit)، `config`، `shared-types` — همه **مجاز**؛ به‌علاوه‌ی `pg`/`ioredis`/`fastify`/`kysely`.
 *
 * ⚠️ **سه چیز عمداً ممنوع:**
 * - `@aws-sdk/*`ِ خام (P4) — به Object Storage فقط از راهِ `@hamboom/storage`. مثلِ realtime.
 * - موتورِ رندر/React (`@hamboom/canvas-core`/`canvas-sync`، `react`، `@excalidraw/*`) — کارِ `apps/web`.
 * - `@hamboom/sdk` — **دورِ باطل**: sdk مصرف‌کننده‌ی api است (کلاینتِ typed)، نه برعکس. با realtime هم
 *   از راهِ کدِ مشترکِ `auth-core` حرف می‌زند ([ADR-012](../../ARCHITECTURE_DECISIONS.md#adr-012))، نه import.
 *
 * ★ تستِ **`allowed`** اینجا هم نگهبانِ یک اشتباهِ محتمل است: کسی که P4 را سرسری بخواند ممکن است
 *   `@hamboom/storage`/`auth-core` را هم ببندد — که یعنی بستنِ همان مسیری که P4 و ADR-012 تجویز کرده‌اند.
 *
 * @returns {import("eslint").Linter.Config}
 */
export function apiBoundaries() {
  return packageBoundaries({
    forbid: [
      "@hamboom/canvas-core",
      "@hamboom/canvas-sync",
      "@hamboom/sdk",
      "@aws-sdk/*",
      "react",
      "react-dom",
      "@excalidraw/*",
    ],
    reason:
      "apps/api لایه‌ی REST/داده است: به Object Storage فقط از راهِ @hamboom/storage می‌رسد (@aws-sdk " +
      "ممنوع، P4)، موتورِ رندر/React نمی‌بیند (کارِ apps/web)، و هرگز @hamboom/sdk را import نمی‌کند " +
      "(sdk کلاینتِ api است — دورِ باطل). مجاز: storage/auth-core/assets/config/shared-types + pg/ioredis/fastify/kysely.",
  });
}
