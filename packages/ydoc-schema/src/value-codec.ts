import * as Y from "yjs";

/**
 * نوشتنِ **افتراقیِ** یک آبجکتِ ساده روی `Y.Map` — موتورِ مشترکِ همه‌ی codecها.
 *
 * ── چرا یک جا و نه یک کپی در هر codec ─────────────────────────────────
 *
 * عنصر، `appState`، و پینِ کامنت هر سه یک قاعده دارند: فقط چیزی که واقعاً عوض
 * شده نوشته شود، و هر آبجکتِ ساده بازگشتی `Y.Map` شود
 * ([ADR-033](../../../ARCHITECTURE_DECISIONS.md#adr-033)). سه نسخه‌ی جدا یعنی سه
 * رفتاری که می‌توانند واگرا شوند — دقیقاً چیزی که
 * [ADR-024](../../../ARCHITECTURE_DECISIONS.md#adr-024) منع کرده.
 *
 * ★ **این ماژول از `index.ts` صادر نمی‌شود.** بیرون فقط codecهای نام‌دار را
 * می‌بیند؛ اینجا جزئیاتِ پیاده‌سازی است.
 */

export interface WriteOptions {
  /**
   * ★ کلیدهایی که در سند نیستند حذف شوند؟
   *
   * **`true` برای شیءِ کامل** (عنصر، پینِ کامنت — قراردادشان «همیشه شیء کامل، نه
   * patch» است). **`false` برای patch** (`appState`، که «کاربر گرید را روشن کرد»
   * می‌فرستد نه کلِ وضعیت). عمداً پیش‌فرض ندارد: انتخابِ غلط اینجا یعنی یا
   * داده‌ی پاک‌شده برای همیشه می‌مانَد، یا یک patch کلِ بقیه را پاک می‌کند.
   */
  prune: boolean;
  /**
   * فیلدهایی که به‌جای رشته‌ی ساده `Y.Text` می‌شوند
   * ([ADR-034](../../../ARCHITECTURE_DECISIONS.md#adr-034)).
   */
  textKeys?: ReadonlySet<string>;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * برابریِ ساختاری برای مقادیرِ JSONی.
 *
 * عمداً `JSON.stringify` نیست: دو آبجکتِ یکسان با ترتیبِ کلیدِ متفاوت رشته‌های
 * متفاوتی می‌دهند و codec بی‌دلیل update می‌ساخت — یعنی قیدِ «بدونِ تغییر = صفر
 * update» به یک شانس تبدیل می‌شد.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    if (keysA.length !== Object.keys(b).length) return false;
    return keysA.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]));
  }
  return false;
}

/** مقدارِ داخلِ سند به شکلِ سادهٔ JSON — برای مقایسه. */
export function plainOf(value: unknown): unknown {
  if (value instanceof Y.Text) return value.toString();
  if (value instanceof Y.Map || value instanceof Y.Array) return value.toJSON();
  return value;
}

/**
 * تبدیلِ «رشته‌ی کاملِ نو» به یک ویرایشِ delta روی `Y.Text`.
 *
 * پیشوند و پسوندِ مشترک کنار گذاشته می‌شوند و فقط وسط عوض می‌شود — برای تایپِ
 * انسانی (که در هر پنجره‌ی debounce یک ناحیه‌ی پیوسته است) دقیقاً همان عملیاتی
 * می‌شود که کاربر انجام داده. هزینه‌ی سنجیده‌شده: یک کاراکتر در متنِ ۱۰۰۰
 * کاراکتری = **۲۸ بایت**.
 *
 * ★★ **پایه‌اش عمداً پارامتر نیست.** نسخه‌ی probe یک آرگومانِ `base` داشت تا
 * بتواند حالتِ «پایه‌ی کهنه» را بسازد، و همان آزمون نشان داد با پایه‌ی کهنه بازه‌ی
 * `delete` به ایندکسِ اشتباه می‌افتد و متن **مخدوش** می‌شود، نه فقط ناقص (انتظار
 * «سلام رفیق»، نتیجه «سلام رفیقا»). اینجا پایه همیشه `ytext.toString()`ِ همین
 * لحظه است، پس آن مسیر از راهِ API **قابلِ دسترسی نیست**.
 *
 * ⚠️ این نیمی از ریسک را می‌بندد، نه همه‌اش: اگر **رشته‌ی ورودی** خودش از یک
 * اسنپ‌شاتِ کهنه‌ی بوم آمده باشد، دیف باز هم می‌تواند کاراکترِ همتا را پاک کند.
 * عرضِ آن پنجره در گام ۳٫۳ اندازه‌گیری می‌شود.
 */
export function applyTextDiff(ytext: Y.Text, next: string): void {
  const base = ytext.toString();
  if (base === next) return;

  let start = 0;
  const shortest = Math.min(base.length, next.length);
  while (start < shortest && base[start] === next[start]) start++;

  let endBase = base.length;
  let endNext = next.length;
  while (endBase > start && endNext > start && base[endBase - 1] === next[endNext - 1]) {
    endBase--;
    endNext--;
  }

  if (endBase > start) ytext.delete(start, endBase - start);
  if (endNext > start) ytext.insert(start, next.slice(start, endNext));
}

/**
 * نوشتنِ یک آبجکتِ ساده روی یک `Y.Map`، **فقط تفاوت‌ها**.
 *
 * `undefined` رد می‌شود، نه تبدیل به `null`: `Y.Map` مقدارِ `undefined` نمی‌پذیرد،
 * ولی `null` گذاشتن هم اشتباه است — `.optional()`ِ zod روی `null` می‌افتد.
 * آرایه‌ها عمداً مقدارِ ساده و LWW می‌مانند؛ ادغامِ کاراکتریِ آرایه‌ی نقاط بی‌معنی است.
 */
export function writeInto(
  target: Y.Map<unknown>,
  source: Record<string, unknown>,
  options: WriteOptions,
): void {
  if (options.prune) {
    for (const key of [...target.keys()]) {
      if (source[key] === undefined) target.delete(key);
    }
  }

  for (const [key, next] of Object.entries(source)) {
    if (next === undefined) continue;

    const current = target.get(key);

    if (options.textKeys?.has(key) && typeof next === "string") {
      let ytext = current;
      if (!(ytext instanceof Y.Text)) {
        ytext = new Y.Text();
        target.set(key, ytext);
      }
      applyTextDiff(ytext as Y.Text, next);
      continue;
    }

    if (isPlainObject(next)) {
      if (current instanceof Y.Map) {
        // آبجکتِ تودرتو همیشه کامل است (زیرشاخه‌ی یک شیءِ کامل)، پس prune می‌شود
        // حتی وقتی سطحِ بالا patch باشد — وگرنه کلیدِ پاک‌شده‌ی داخلی می‌مانَد.
        writeInto(current, next, { ...options, prune: true });
      } else {
        const nested = new Y.Map<unknown>();
        target.set(key, nested);
        writeInto(nested, next, { ...options, prune: true });
      }
      continue;
    }

    // مقایسه با مقدارِ **زنده‌ی** سند؛ برابر بود، هیچ updateای نه.
    if (!deepEqual(plainOf(current), next)) target.set(key, next);
  }
}
