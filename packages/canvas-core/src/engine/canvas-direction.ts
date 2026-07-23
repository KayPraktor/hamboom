import { detectBaseDirection, type TextDirection } from "../text/bidi";

/**
 * اصلاح جهت پایه‌ی متن روی canvas — پیاده‌سازی [ADR-023](../../../../ARCHITECTURE_DECISIONS.md#adr-023).
 *
 * ── مسئله ─────────────────────────────────────────────────────────────
 *
 * موتور رندر هر خط را با یک `fillText(line, x, y)` می‌کشد و الگوریتم bidi
 * مرورگر را به کار می‌گیرد — ولی `ctx.direction` را **هرگز ست نمی‌کند**.
 * مقدار پیش‌فرض `"inherit"` است که از CSS عنصر canvas می‌آید، و آنجا `ltr`
 * است. نتیجه: متن فارسی با جهت پایه‌ی LTR چیده می‌شود و ترتیب اجزای مخلوط
 * (کلمه‌ی لاتین، نشانه‌گذاری) به هم می‌ریزد.
 *
 * ── چرا wrapper به‌جای patch ────────────────────────────────────────────
 *
 * تنها کاری که یک patch می‌کرد این بود: قبل از `fillText` مقدار
 * `ctx.direction` را از روی متن ست کند. ولی `fillText(text, …)` خودش متن را
 * به ما می‌دهد — پس همان کار را می‌شود با wrap کردن متد روی prototype انجام
 * داد، **بدون هیچ patch ای**.
 *
 * مزیت‌ها نسبت به patch:
 * - پروژه روی پله‌ی A از [ADR-003](../../../../ARCHITECTURE_DECISIONS.md#adr-003) می‌ماند
 * - با ارتقای نسخه‌ی پکیج نمی‌شکند (به کد minify شده گره نمی‌خورد)
 * - منطق در کد خودمان است و مستقیماً تست می‌شود
 * - build های dev و prod موتور یکسان رفتار می‌کنند
 *
 * ── دامنه‌ی اثر ─────────────────────────────────────────────────────────
 *
 * این wrapper **همه‌ی** رسم متن روی canvas در صفحه را پوشش می‌دهد، نه فقط
 * عناصر بوم. این عمدی و درست است: جهت پایه از روی محتوای خودِ رشته تعیین
 * می‌شود، پس برای برچسب نام همکار یا هر متن دیگری هم جواب درستی می‌دهد.
 */

/** حداکثر تعداد رشته‌ی کش‌شده. متن‌های بوم تکراری‌اند، پس نرخ اصابت بالاست. */
const CACHE_LIMIT = 2000;

const directionCache = new Map<string, TextDirection>();

/**
 * شمارنده‌ی فراخوانی — **ابزار تایید، نه آمار.**
 *
 * تنها راه اثبات اینکه این wrapper واقعاً در مسیر رندر موتور قرار می‌گیرد،
 * این است که ببینیم هنگام رسم متن روی بوم صدا زده می‌شود. اگر این عدد در حین
 * کار با بوم صفر بماند، یعنی موتور از مسیر دیگری متن می‌کشد (مثلاً worker یا
 * یک reference که قبل از نصب گرفته شده) و باید به راه‌حل patch برگردیم.
 */
let invocationCount = 0;

/** تعداد دفعاتی که wrapper در مسیر رسم متن قرار گرفته. */
export function getCanvasTextDirectionInvocations(): number {
  return invocationCount;
}

/** صفر کردن شمارنده — برای اندازه‌گیری یک بازه‌ی مشخص. */
export function resetCanvasTextDirectionInvocations(): void {
  invocationCount = 0;
}

function cachedDirection(text: string): TextDirection {
  const hit = directionCache.get(text);
  if (hit !== undefined) return hit;

  const direction = detectBaseDirection(text);
  if (directionCache.size >= CACHE_LIMIT) directionCache.clear();
  directionCache.set(text, direction);
  return direction;
}

type TextMethod = "fillText" | "strokeText";

interface Patchable {
  prototype: {
    fillText?: unknown;
    strokeText?: unknown;
  };
}

let uninstallers: (() => void)[] = [];

function wrap(target: Patchable | undefined, method: TextMethod): (() => void) | null {
  const proto = target?.prototype as Record<string, unknown> | undefined;
  if (!proto) return null;

  const original = proto[method];
  if (typeof original !== "function") return null;

  const originalFn = original as (this: unknown, text: string, ...rest: unknown[]) => unknown;

  proto[method] = function (this: { direction?: string }, text: string, ...rest: unknown[]) {
    // فقط رشته‌های غیرخالی؛ بقیه دست‌نخورده رد می‌شوند.
    if (typeof text === "string" && text.length > 0) {
      invocationCount++;
      this.direction = cachedDirection(text);
    }
    return originalFn.call(this, text, ...rest);
  };

  return () => {
    proto[method] = originalFn;
  };
}

/**
 * wrapper را نصب می‌کند. چندبار صدا زدن بی‌ضرر است (idempotent).
 *
 * @returns تابع حذف wrapper — برای تست و پاک‌سازی.
 */
export function installCanvasTextDirection(): () => void {
  if (uninstallers.length > 0) return uninstallCanvasTextDirection;

  const targets: (Patchable | undefined)[] = [
    globalThis.CanvasRenderingContext2D as unknown as Patchable | undefined,
    // موتور ممکن است عناصر را در OffscreenCanvas کش کند؛ آن prototype جداست.
    (globalThis as { OffscreenCanvasRenderingContext2D?: unknown })
      .OffscreenCanvasRenderingContext2D as Patchable | undefined,
  ];

  for (const target of targets) {
    for (const method of ["fillText", "strokeText"] as const) {
      const undo = wrap(target, method);
      if (undo) uninstallers.push(undo);
    }
  }

  return uninstallCanvasTextDirection;
}

/** wrapper را برمی‌دارد و کش را پاک می‌کند. */
export function uninstallCanvasTextDirection(): void {
  for (const undo of uninstallers) undo();
  uninstallers = [];
  directionCache.clear();
}

/** آیا wrapper نصب است؟ برای تست. */
export function isCanvasTextDirectionInstalled(): boolean {
  return uninstallers.length > 0;
}
