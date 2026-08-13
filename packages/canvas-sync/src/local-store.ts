import { IndexeddbPersistence } from "y-indexeddb";
import type * as Y from "yjs";

/**
 * پایداریِ **محلیِ** سند — گام ۵٫۲.
 *
 * ── چرا پورت، و نه `IndexeddbPersistence`ِ خام ──────────────────────────
 *
 * سه دلیل، و هیچ‌کدام سلیقه‌ای نیست:
 *
 * ۱. **IndexedDB فقط در مرورگر هست.** تست‌های واحدِ این پکیج در محیطِ `node`
 *    اجرا می‌شوند (`vitest.config.ts`)، پس بدونِ پورت، هر تستی که آداپتور را با
 *    پایداریِ محلی بسازد یا باید مرورگر بالا بیاورد یا اصلاً نوشته نشود.
 * ۲. **قرارداد اینجا فقط یک چیز است: «کِی سندِ ذخیره‌شده روی `doc` نشست؟»**
 *    هر چیزِ دیگری که `y-indexeddb` دارد (رویدادها، شمارنده‌ها) به آداپتور ربطی
 *    ندارد و نباید به آن گره بخورد.
 * ۳. M3 ممکن است روی همین پورت یک پیاده‌سازیِ دیگر بگذارد (مثلاً OPFS یا
 *    حافظه برای حالتِ مهمان) بدونِ اینکه binder عوض شود — همان الگوی
 *    `SyncTransport` و [ADR-031](../../../ARCHITECTURE_DECISIONS.md#adr-031).
 *
 * ── ⚠️ چیزی که این **نیست** ────────────────────────────────────────────
 *
 * این یک **صفِ پیام** نیست. هیچ updateی اینجا برای «فرستادنِ بعدی» نگه داشته
 * نمی‌شود؛ فقط **خودِ سند** ذخیره می‌شود. آشتی با سرور کارِ دست‌دادنِ
 * `y-protocols/sync` است (step1/step2) که ترابری روی **هر** بار باز شدن
 * می‌زند — [ADR-039](../../../ARCHITECTURE_DECISIONS.md#adr-039).
 *
 * ★ **و این تفاوت، همان چیزی است که «هیچ‌کدام تکراری نیست» را تضمین می‌کند.**
 * اگر به‌جایش updateهای ذخیره‌شده را دوباره می‌فرستادیم، به همان تله‌ی شکافِ
 * علّیِ گام ۳٫۱ برمی‌خوردیم: Yjs updateِ بی‌پیشینه را در `pendingStructs`
 * **بی‌صدا** بایگانی می‌کند و بورد ناقص بالا می‌آید بدونِ هیچ خطایی.
 */

export interface LocalDocStore {
  /**
   * تا وقتی سندِ ذخیره‌شده روی `doc` **ننشسته** resolve نمی‌شود.
   *
   * ★ آداپتور موظف است **قبل از** دست‌دادنِ اولیه و قبل از `replaceDocument`
   * منتظرش بماند. وگرنه بوم یک لحظه بوردِ خالی رندر می‌کند و بعد کارِ ذخیره‌شده
   * رویش می‌ریزد — و بدتر: step2ِ ما بدونِ آن کار می‌رود.
   */
  readonly whenReady: Promise<void>;
  /** پاک‌کردنِ نسخه‌ی محلی — مثلاً هنگام خروجِ کاربر. */
  clear(): Promise<void>;
  /** بستنِ اتصال به انبار. سند دست‌نخورده می‌مانَد. */
  destroy(): Promise<void>;
}

export interface IndexeddbDocStoreOptions {
  doc: Y.Doc;
  /**
   * نامِ پایگاه‌داده. **باید شاملِ شناسه‌ی بورد باشد** — وگرنه دو بورد در یک
   * مرورگر روی هم می‌نویسند.
   */
  name: string;
}

/**
 * پیاده‌سازیِ مرورگری روی `y-indexeddb`.
 *
 * ⚠️ **در Node صدا زده نشود.** `IndexeddbPersistence` هنگام ساخت به
 * `indexedDB`ِ سراسری دست می‌زند؛ آنجا `LocalDocStore`ِ دیگری (یا هیچ) بده.
 */
export function createIndexeddbDocStore({ doc, name }: IndexeddbDocStoreOptions): LocalDocStore {
  const persistence = new IndexeddbPersistence(name, doc);

  return {
    // `whenSynced` خودش یک Promise است و به **خودِ** persistence resolve می‌شود؛
    // اینجا به `void` تبدیل می‌شود تا قرارداد چیزی از y-indexeddb لو ندهد.
    whenReady: persistence.whenSynced.then(() => undefined),
    clear: () => persistence.clearData(),
    destroy: () => persistence.destroy(),
  };
}
