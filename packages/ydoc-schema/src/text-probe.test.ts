import * as Y from "yjs";
import { describe, expect, it } from "vitest";

/**
 * ★★ probeِ گام ۱٫۳ — **متنِ همزمان: `Y.Text` یا رشته‌ی ساده؟**
 *
 * ── تعارضی که باید حل شود ─────────────────────────────────────────────
 *
 * `shared-types` متن را `text: z.string()` تعریف کرده، ولی PLAN بخش ۷٫۳ و دلیلِ
 * [ADR-004](../../../ARCHITECTURE_DECISIONS.md#adr-004) صریحاً `Y.Text` می‌خواهند —
 * «حل تعارض روی متن یک استیکی که دو نفر همزمان تایپ می‌کنند».
 *
 * قرارداد (`ElementChangeSet`) **عنصرِ کامل** رد و بدل می‌کند، نه delta. پس اگر
 * `Y.Text` انتخاب شود، binder باید رشته‌ی نو را به delta تبدیل کند — یعنی **دیف**.
 *
 * ⚠️ **مسیرِ ممنوع (قیدِ مالک):** اگر دیف کافی نبود، راهِ‌حل **پهن‌کردنِ قرارداد**
 * نیست (افزودنِ `textDelta` به `ElementChangeSet`) — آن تغییرِ `shared-types` است و
 * بسته. خروجیِ مجاز: ثبتِ محدودیت، یا توقف و پرسش از مالک.
 */

function twoClients() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  return {
    a,
    b,
    sync() {
      const ua = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
      const ub = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
      Y.applyUpdate(b, ua);
      Y.applyUpdate(a, ub);
    },
  };
}

/**
 * تبدیلِ «رشته‌ی کاملِ نو» به یک ویرایشِ delta روی `Y.Text`.
 *
 * پیشوند و پسوندِ مشترک را کنار می‌گذارد و فقط وسط را عوض می‌کند — یعنی برای
 * تایپِ انسانی (که در هر پنجره‌ی debounce یک ناحیه‌ی پیوسته است) دقیقاً همان
 * عملیاتی می‌شود که کاربر انجام داده.
 *
 * ★ `base` **صریح** است تا probe بتواند حالتِ «پایه‌ی کهنه» را هم بسازد. در کدِ
 * واقعی همیشه باید `ytext.toString()`ِ لحظه‌ی تراکنش باشد — تستِ پایین دلیلش را
 * نشان می‌دهد.
 */
function applyTextDiff(ytext: Y.Text, next: string, base = ytext.toString()): void {
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

const seed = (doc: Y.Doc, initial: string) => {
  const ytext = doc.getMap("elements").set("txt_1", new Y.Text()) as Y.Text;
  ytext.insert(0, initial);
  return ytext;
};
const textOf = (doc: Y.Doc) => (doc.getMap("elements").get("txt_1") as Y.Text).toString();

describe("★ رشته‌ی ساده در برابر Y.Text — تایپِ همزمان", () => {
  it("رشته‌ی ساده (LWW): یکی از دو نفر کاراکترهایش را از دست می‌دهد", () => {
    const { a, b, sync } = twoClients();
    a.getMap("elements").set("txt_1", "سلام دنیا");
    sync();

    // A اولِ متن تایپ می‌کند، B آخرش — هیچ‌کدام کارِ دیگری را ندیده.
    a.getMap("elements").set("txt_1", "★سلام دنیا");
    b.getMap("elements").set("txt_1", "سلام دنیا!");
    sync();

    const merged = a.getMap("elements").get("txt_1") as string;
    const bothSurvived = merged.startsWith("★") && merged.endsWith("!");
    expect(bothSurvived, "با رشته‌ی ساده نباید هر دو ویرایش بمانند").toBe(false);
  });

  it("★ `Y.Text` + دیف: هر دو ویرایش می‌مانند و دو سند همگرا می‌شوند", () => {
    const { a, b, sync } = twoClients();
    seed(a, "سلام دنیا");
    sync();

    // هر کلاینت **رشته‌ی کامل** می‌گیرد (شکلِ قرارداد) و خودش دیف می‌کند.
    applyTextDiff(a.getMap("elements").get("txt_1") as Y.Text, "★سلام دنیا");
    applyTextDiff(b.getMap("elements").get("txt_1") as Y.Text, "سلام دنیا!");
    sync();

    expect(textOf(a)).toBe(textOf(b));
    expect(textOf(a)).toBe("★سلام دنیا!");
  });

  it("ویرایشِ همزمان در **وسطِ** متن هم ادغام می‌شود", () => {
    const { a, b, sync } = twoClients();
    seed(a, "یک دو سه چهار");
    sync();

    applyTextDiff(a.getMap("elements").get("txt_1") as Y.Text, "یک دوم سه چهار");
    applyTextDiff(b.getMap("elements").get("txt_1") as Y.Text, "یک دو سه چهارم");
    sync();

    expect(textOf(a)).toBe(textOf(b));
    expect(textOf(a)).toContain("دوم");
    expect(textOf(a)).toContain("چهارم");
  });
});

/**
 * ★★ تله‌ی شماره‌ی ۱ — **پایه‌ی دیف باید زنده باشد.**
 *
 * هم‌کلاسِ باگِ `getAppState`ِ کهنه در M1، ولی این‌بار پیامدش **از دست رفتنِ داده‌ی
 * کاربر** است، نه یک مکان‌نمای جامانده.
 */
describe("★★ پایه‌ی دیف: زنده در برابر کهنه", () => {
  /**
   * ⚠️ **فرضِ اولِ من غلط بود و همین تست ردش کرد.** اول با یک ویرایشِ **افزایشی**
   * آزمودم («سلام» → «سلام عزیز») و انتظار داشتم کاراکترِ همتا پاک شود — نشد،
   * چون آن دیف یک **درجِ خالص** بود و هیچ بازه‌ی حذفی نداشت.
   *
   * خرابی وقتی رخ می‌دهد که ویرایشِ محلی یک **جایگزینی** باشد: آن‌وقت بازه‌ی
   * `delete` که از روی پایه‌ی کهنه حساب شده، روی متنِ زنده به **ایندکسِ اشتباه**
   * می‌افتد. پیامدش از «گم‌شدنِ یک کاراکتر» بدتر است — متن **مخدوش** می‌شود.
   */
  it("پایه‌ی کهنه: بازه‌ی حذف به ایندکسِ اشتباه می‌افتد و متن را مخدوش می‌کند", () => {
    const { a, b, sync } = twoClients();
    seed(a, "سلام دنیا");
    sync();

    // اسنپ‌شاتی که بوم در دست دارد — قبل از رسیدنِ تغییرِ همتا.
    const staleBase = textOf(a);

    // همتا در **وسط** درج می‌کند.
    applyTextDiff(b.getMap("elements").get("txt_1") as Y.Text, "سلام ★دنیا");
    sync();
    expect(textOf(a)).toBe("سلام ★دنیا");

    // کاربرِ محلی «دنیا» را با «رفیق» جایگزین می‌کند — ولی رشته‌اش از پایه‌ی کهنه است.
    applyTextDiff(a.getMap("elements").get("txt_1") as Y.Text, "سلام رفیق", staleBase);
    sync();

    const result = textOf(a);
    expect(result).toBe(textOf(b));
    // ★ نه فقط «★»ِ همتا رفته — یک کاراکترِ اضافه هم جا مانده. متن مخدوش است.
    expect(result).not.toBe("سلام رفیق");
    expect(result).not.toContain("★");
    console.log(`
  پایه‌ی کهنه → متنِ مخدوش: «${result}» (انتظار: «سلام رفیق»)
`);
  });

  it("همان سناریو با پایه‌ی **زنده**: نه خرابی، نه گم‌شدنِ کاراکترِ همتا", () => {
    const { a, b, sync } = twoClients();
    seed(a, "سلام دنیا");
    sync();

    applyTextDiff(b.getMap("elements").get("txt_1") as Y.Text, "سلام ★دنیا");
    sync();

    // پایه از `ytext.toString()`ِ همین لحظه خوانده می‌شود (آرگومانِ base داده نمی‌شود).
    const live = a.getMap("elements").get("txt_1") as Y.Text;
    applyTextDiff(live, live.toString().replace("دنیا", "رفیق"));
    sync();

    expect(textOf(a)).toBe("سلام ★رفیق");
    expect(textOf(a)).toBe(textOf(b));
  });
});

describe("هزینه‌ی دیف", () => {
  it("متنِ ۱۰۰۰ کاراکتری با یک ویرایش → updateِ کوچک، نه بازنویسیِ کل", () => {
    const doc = new Y.Doc();
    const ytext = seed(doc, "ا".repeat(1000));

    const before = Y.encodeStateVector(doc);
    applyTextDiff(ytext, "ا".repeat(500) + "ب" + "ا".repeat(500));
    const bytes = Y.encodeStateAsUpdate(doc, before).byteLength;

    console.log(`\n  دیفِ یک کاراکتر در متنِ ۱۰۰۰ کاراکتری: ${bytes} بایت\n`);
    // اگر دیف کار نکند، کلِ ۱۰۰۰ کاراکتر دوباره نوشته می‌شود.
    expect(bytes).toBeLessThan(100);
  });

  it("تایپِ ۱۰۰ کاراکتر پشتِ سرِ هم (شبیه‌سازیِ debounce) خطی می‌مانَد", () => {
    const doc = new Y.Doc();
    const ytext = seed(doc, "");

    const started = performance.now();
    let text = "";
    for (let i = 0; i < 100; i++) {
      text += "ا";
      applyTextDiff(ytext, text);
    }
    const elapsed = performance.now() - started;

    expect(ytext.toString()).toHaveLength(100);
    // آستانه‌ی سخاوتمندانه — هدف گرفتنِ رگرسیونِ فاجعه‌بار است، نه بنچمارکِ دقیق.
    expect(elapsed).toBeLessThan(500);
  });
});

/**
 * ★★ تله‌ی شماره‌ی ۲ — **`text` در برابر `originalText`.**
 *
 * قراردادِ `shared-types` **هر دو** را دارد و خودش می‌گوید «منبع حقیقت
 * `originalText` است»؛ `text` نسخه‌ی **wrap‌شده** است، یعنی یک مقدارِ مشتق‌شده از
 * `originalText` + عرضِ ظرف.
 *
 * سوالِ codec: کدام‌یک `Y.Text` شود؟ اگر **هر دو** CRDT شوند و مستقل ادغام شوند،
 * می‌توانند به جفتی برسند که با هم نمی‌خوانَد — `text`ی که wrapِ معتبرِ
 * `originalText` نیست. این تست همان را نشان می‌دهد.
 */
describe("★★ text در برابر originalText — کدام منبعِ حقیقت است؟", () => {
  /** wrapِ ساختگی و قطعی: هر ۶ کاراکتر یک شکست. کافی است تا مشتق‌بودن را نشان دهد. */
  const wrap = (s: string) => (s.match(/.{1,6}/g) ?? []).join("\n");

  it("`originalText` به‌صورت Y.Text ادغام می‌شود و هر دو ویرایش می‌مانند", () => {
    const { a, b, sync } = twoClients();
    seed(a, "سلام دنیا");
    sync();

    applyTextDiff(a.getMap("elements").get("txt_1") as Y.Text, "★سلام دنیا");
    applyTextDiff(b.getMap("elements").get("txt_1") as Y.Text, "سلام دنیا!");
    sync();

    expect(textOf(a)).toBe("★سلام دنیا!");
  });

  it("★ `text`ِ هر کلاینت بعد از ادغام **غلط** است — پس باید بازمحاسبه شود، نه ادغام", () => {
    const original = "سلام دنیا";
    // هر کلاینت `text` را از نسخه‌ی **خودش** حساب می‌کند، قبل از دیدنِ دیگری.
    const textFromA = wrap("★" + original);
    const textFromB = wrap(original + "!");

    // بعد از ادغامِ CRDT، منبعِ حقیقت این است:
    const mergedOriginal = "★سلام دنیا!";
    const correctText = wrap(mergedOriginal);

    // ★ هیچ‌کدام از دو `text`ِ emit‌شده با نتیجه‌ی درست نمی‌خوانَد. یعنی LWW یا
    //   ادغامِ مستقلِ `text` هر دو به حالتِ ناسازگار می‌رسند.
    expect(textFromA).not.toBe(correctText);
    expect(textFromB).not.toBe(correctText);

    // تنها راهِ درست: `text` از `originalText`ِ ادغام‌شده **بازمحاسبه** شود.
    expect(wrap(mergedOriginal)).toBe(correctText);
  });
});
