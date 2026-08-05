import type { HbElement } from "@hamboom/shared-types";
import * as Y from "yjs";

import { writeInto } from "./value-codec.ts";

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
 * منطقِ نوشتنِ افتراقی در [`value-codec.ts`](value-codec.ts) است و با `appState` و
 * پینِ کامنت **مشترک** است (ADR-024).
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

/**
 * نوشتنِ یک عنصر در ریشه‌ی `elements`.
 *
 * عنصرِ نو ساخته و عنصرِ موجود **به‌روزرسانیِ افتراقی** می‌شود. `element` باید
 * **کامل** باشد نه patch — همان چیزی که قراردادِ `ElementChangeSet` می‌گوید
 * («همیشه شیء کامل»). کلیدی که در آن نباشد از سند حذف می‌شود، وگرنه فیلدی که
 * کاربر پاک کرده (مثلاً `customData.hb.tags`) برای همیشه می‌مانَد.
 *
 * حذف اینجا نیست: حذفِ کاربر یک **حذفِ نرم** است (`isDeleted: true`) که از همین
 * مسیر می‌گذرد، تا undo و CRDT چیزی برای برگرداندن داشته باشند.
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
  writeInto(map, element as unknown as Record<string, unknown>, {
    prune: true,
    textKeys: Y_TEXT_KEYS,
  });
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
 * دارد: مرزِ بارگذاری از دیتابیس در گام ۴٫۲.
 */
export function readElement(map: Y.Map<unknown>): HbElement {
  return map.toJSON() as HbElement;
}
