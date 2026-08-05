import type { HbElement } from "@hamboom/shared-types";
import * as Y from "yjs";

/**
 * codecِ عنصر — تبدیلِ `HbElement` به `Y.Map` و برعکس، **property به property**.
 *
 * ── چرا per-property و نه یک آبجکت ────────────────────────────────────
 *
 * [ADR-007](../../../ARCHITECTURE_DECISIONS.md#adr-007) می‌گوید هر عنصر باید خودش
 * یک `Y.Map` باشد تا دو نفر بتوانند همزمان رنگ و موقعیتِ یک استیکی را عوض کنند و
 * **هر دو تغییر بماند**. گام ۱٫۲ هم ادعا و هم ضدش را سنجید: با نوشتنِ آبجکتِ کامل
 * یکی از دو تغییر **خورده می‌شود**، و هزینه‌ی هر تیکِ درگ از ۳۹ بایت به ۴۳۸ بایت
 * می‌رود (~۱۱ برابر). شواهد: [`docs/ydoc-baseline.md`](../../../docs/ydoc-baseline.md).
 *
 * ── چهار قیدِ ورودی که از فاز ۱ آمده‌اند ───────────────────────────────
 *
 * ۱. **`undefined` رد می‌شود، نه تبدیل به `null`.** `Y.Map` مقدارِ `undefined`
 *    نمی‌پذیرد، ولی `null` گذاشتن هم راهِ‌حل نیست: `hbElement.parse` روی فیلدی که
 *    `.optional()` است ولی `null` گرفته می‌افتد.
 * ۲. **نوشتنِ عنصرِ بدونِ تغییر باید صفر update بدهد** — دیف در برابرِ مقدارِ
 *    **زنده‌ی** داخلِ سند، نه یک اسنپ‌شاتِ ورودی.
 * ۳. **`line` سازنده‌ی اختصاصی ندارد** (کانکتور همیشه `arrow` است) ولی codec
 *    پوششش می‌دهد — تنها نوعِ رندری که نمونه‌ی واقعی ندارد.
 * ۴. **`customData` بازگشتی `Y.Map` می‌شود** ([ADR-033](../../../ARCHITECTURE_DECISIONS.md#adr-033))
 *    و **`originalText` استثنای `Y.Text` است** ([ADR-034](../../../ARCHITECTURE_DECISIONS.md#adr-034)).
 *
 * ── ★ تراکنش و origin مالِ صداکننده است ───────────────────────────────
 *
 * این توابع **خودشان `transact` نمی‌کنند**. binder موظف است هر changeset را در
 * یک `doc.transact(fn, origin)` با originِ **نام‌دار** بپیچد — هم برای اینکه یک
 * ژست یک update شود، هم چون انزوای undo به همان origin وابسته است (گام ۱٫۴:
 * پیش‌فرضِ `Y.UndoManager` فقط `null` را ردیابی می‌کند). بدونِ تراکنش، Yjs هر
 * `set` را جداگانه با originِ `null` می‌فرستد — یعنی هم ترافیکِ چندبرابر و هم
 * نشتِ تغییراتِ remote به undo stackِ محلی.
 */

/**
 * فیلدهایی که در سند `Y.Text` می‌شوند، نه رشته‌ی ساده — [ADR-034](../../../ARCHITECTURE_DECISIONS.md#adr-034).
 *
 * ⚠️ `text` عمداً اینجا **نیست**. قراردادِ `shared-types` خودش می‌گوید منبعِ حقیقت
 * `originalText` است و `text` نسخه‌ی wrap‌شده‌ی مشتق از آن. گام ۱٫۳ سنجید که اگر
 * هر دو CRDT شوند، `text`ِ emit‌شده‌ی **هر دو** کلاینت بعد از ادغام غلط است.
 * `text` یک رشته‌ی ساده‌ی LWW می‌مانَد و binder بعد از هر ادغام بازمحاسبه‌اش می‌کند.
 */
const Y_TEXT_KEYS: ReadonlySet<string> = new Set(["originalText"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * برابریِ ساختاری برای مقادیرِ JSONی.
 *
 * عمداً `JSON.stringify` نیست: دو آبجکتِ یکسان با ترتیبِ کلیدِ متفاوت رشته‌های
 * متفاوتی می‌دهند و codec بی‌دلیل update می‌ساخت — یعنی قیدِ «بدونِ تغییر = صفر
 * update» به یک شانس تبدیل می‌شد.
 */
function deepEqual(a: unknown, b: unknown): boolean {
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
function plainOf(value: unknown): unknown {
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
function applyTextDiff(ytext: Y.Text, next: string): void {
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
 * نوشتنِ یک آبجکتِ ساده روی یک `Y.Map`، فقط تفاوت‌ها.
 *
 * `source` باید **کامل** باشد، نه patch — کلیدی که در `source` نیست از سند
 * **حذف** می‌شود. قراردادِ `ElementChangeSet` هم همین است: «همیشه شیء کامل، نه
 * patch». بدونِ این حذف، فیلدی که کاربر پاک کرده (مثلاً `customData.hb.tags`)
 * برای همیشه در سند می‌مانَد.
 */
function writeInto(target: Y.Map<unknown>, source: Record<string, unknown>): void {
  for (const key of [...target.keys()]) {
    if (source[key] === undefined) target.delete(key);
  }

  for (const [key, next] of Object.entries(source)) {
    // ★ قیدِ ۱ — رد شود، نه `null`.
    if (next === undefined) continue;

    const current = target.get(key);

    if (Y_TEXT_KEYS.has(key) && typeof next === "string") {
      let ytext = current;
      if (!(ytext instanceof Y.Text)) {
        ytext = new Y.Text();
        target.set(key, ytext);
      }
      applyTextDiff(ytext as Y.Text, next);
      continue;
    }

    // ★ قیدِ ۴ — هر آبجکتِ ساده بازگشتی `Y.Map` می‌شود (ADR-033). آرایه‌ها
    //   عمداً مقدارِ ساده و LWW می‌مانند: ادغامِ کاراکتریِ آرایه‌ی نقاط بی‌معنی است.
    if (isPlainObject(next)) {
      if (current instanceof Y.Map) {
        writeInto(current, next);
      } else {
        const nested = new Y.Map<unknown>();
        target.set(key, nested);
        writeInto(nested, next);
      }
      continue;
    }

    // ★ قیدِ ۲ — مقایسه با مقدارِ **زنده‌ی** سند؛ برابر بود، هیچ updateای نه.
    if (!deepEqual(plainOf(current), next)) target.set(key, next);
  }
}

/**
 * نوشتنِ یک عنصر در ریشه‌ی `elements`.
 *
 * عنصرِ نو ساخته و عنصرِ موجود **به‌روزرسانیِ افتراقی** می‌شود. حذف اینجا نیست:
 * حذفِ کاربر یک **حذفِ نرم** است (`isDeleted: true`) که از همین مسیر می‌گذرد، تا
 * undo و CRDT چیزی برای برگرداندن داشته باشند.
 */
export function writeElement(elements: Y.Map<Y.Map<unknown>>, element: HbElement): void {
  const existing = elements.get(element.id);
  let map: Y.Map<unknown>;
  if (existing instanceof Y.Map) {
    map = existing;
  } else {
    map = new Y.Map<unknown>();
    elements.set(element.id, map);
  }
  writeInto(map, element as unknown as Record<string, unknown>);
}

/**
 * خواندنِ یک عنصر از سند.
 *
 * ⚠️ **حتماً از `toJSON()`**، نه `Object.fromEntries(entries())`: دومی
 * `Y.Map`های تودرتو و `Y.Text` را **خام** بیرون می‌دهد و `hbElement.parse`
 * می‌افتد. `toJSON()` بازگشتی است و `Y.Text` را هم به رشته تبدیل می‌کند — به همین
 * دلیل است که انتخابِ ADR-034 از مرزِ قرارداد بیرون نمی‌زند.
 *
 * اعتبارسنجی نمی‌کند (مسیرِ داغِ هر تغییرِ remote است). اعتبارسنجی جای خودش را
 * دارد: مرزِ بارگذاری از دیتابیس در فاز ۴.
 */
export function readElement(map: Y.Map<unknown>): HbElement {
  return map.toJSON() as HbElement;
}
