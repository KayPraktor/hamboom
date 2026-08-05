import * as Y from "yjs";
import { describe, expect, it } from "vitest";

/**
 * ★★ probeِ گام ۱٫۴ — **انزوای undo با `Y.UndoManager` + `trackedOrigins`.**
 *
 * ── چه چیزی باید ثابت شود ─────────────────────────────────────────────
 *
 * [ADR-012](../../../ARCHITECTURE_DECISIONS.md#adr-012) می‌گوید `Ctrl+Z` یک کاربر
 * **نباید** کارِ کاربرِ دیگر را برگرداند. [ADR-026](../../../ARCHITECTURE_DECISIONS.md#adr-026)
 * مکانیزمِ سمتِ **موتور** را داد (`captureUpdate: "NEVER"` روی `applyRemoteChanges`).
 * این probe مکانیزمِ سمتِ **سند** را می‌سنجد.
 *
 * ★ **این دو، دو سدِ مستقل‌اند — نه یک چیز با دو نام.** بندِ آخرِ این فایل با
 * آزمایش نشان می‌دهد که هرکدام یک **مسیرِ متفاوت** را می‌بندد، پس نبودِ هرکدام یک
 * نشتِ جدا می‌سازد. این جمله در گام ۳٫۴ باید به تستِ ترکیبیِ واقعی تبدیل شود.
 *
 * این فایل عمداً **فقط Yjs خالص** است — بدونِ بوم و بدونِ binder. آنچه اینجا
 * سنجیده می‌شود خاصیتِ `UndoManager` است، نه کدِ ما.
 */

/** originهایی که «کارِ کاربرِ محلی» شمرده می‌شوند. */
const LOCAL_ORIGIN = "local-user";
const REMOTE_ORIGIN = "remote";

function setup() {
  const doc = new Y.Doc();
  const elements = doc.getMap<Y.Map<unknown>>("elements");

  // ★ فقط تراکنش‌هایی با این origin در تاریخچه‌ی undo می‌نشینند.
  const undo = new Y.UndoManager(elements, { trackedOrigins: new Set([LOCAL_ORIGIN]) });

  /** یک عنصر با مقدارِ اولیه — به‌عنوان «حالتِ از قبل موجود». */
  const seed = (id: string, value: Record<string, unknown>) => {
    doc.transact(() => {
      const map = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(value)) map.set(k, v);
      elements.set(id, map);
    }, "system");
    // بعد از seed، تاریخچه پاک می‌شود تا «حالتِ اولیه» جزوِ undo نباشد.
    undo.clear();
  };

  const edit = (id: string, key: string, value: unknown, origin: string) => {
    doc.transact(() => (elements.get(id) as Y.Map<unknown>).set(key, value), origin);
  };

  const read = (id: string, key: string) => (elements.get(id) as Y.Map<unknown>).get(key);

  return { doc, elements, undo, seed, edit, read };
}

describe("★ trackedOrigins — فقط کارِ خودت برمی‌گردد", () => {
  it("undo تغییرِ محلی را برمی‌گرداند", () => {
    const { seed, edit, read, undo } = setup();
    seed("stk_1", { x: 0 });

    edit("stk_1", "x", 100, LOCAL_ORIGIN);
    expect(read("stk_1", "x")).toBe(100);

    undo.undo();
    expect(read("stk_1", "x")).toBe(0);
  });

  it("★★ undo به تغییرِ remote **دست نمی‌زند** — حتی اگر تنها تغییرِ موجود باشد", () => {
    const { seed, edit, read, undo } = setup();
    seed("stk_1", { x: 0 });

    edit("stk_1", "x", 999, REMOTE_ORIGIN);
    expect(read("stk_1", "x")).toBe(999);

    undo.undo();
    // هیچ اتفاقی نیفتاد: تاریخچه‌ی محلی خالی است.
    expect(read("stk_1", "x")).toBe(999);
    expect(undo.undoStack).toHaveLength(0);
  });

  it("★★ مرزِ سخت: تغییرِ remote **روی همان عنصر** هم محافظت می‌شود", () => {
    const { seed, edit, read, undo } = setup();
    seed("stk_1", { x: 0, backgroundColor: "#FFF9B1" });

    // کاربرِ محلی جابه‌جا می‌کند …
    edit("stk_1", "x", 100, LOCAL_ORIGIN);
    // … و همتا در همان لحظه رنگِ **همان عنصر** را عوض می‌کند.
    edit("stk_1", "backgroundColor", "#D0C6F5", REMOTE_ORIGIN);

    undo.undo();

    // فقط حرکتِ محلی برگشت. رنگِ همتا دست‌نخورده — این همان چیزی است که ADR-012
    // می‌خواست و بدونش `Ctrl+Z` تبدیل می‌شود به «کارِ بغل‌دستی‌ات را خراب کن».
    expect(read("stk_1", "x")).toBe(0);
    expect(read("stk_1", "backgroundColor")).toBe("#D0C6F5");
  });

  it("redo هم فقط کارِ محلی را بازمی‌گرداند", () => {
    const { seed, edit, read, undo } = setup();
    seed("stk_1", { x: 0 });

    edit("stk_1", "x", 100, LOCAL_ORIGIN);
    undo.undo();
    expect(read("stk_1", "x")).toBe(0);

    undo.redo();
    expect(read("stk_1", "x")).toBe(100);
  });
});

describe("مرزهای دشوار", () => {
  /**
   * ⚠️ **فرضِ من غلط بود و همین تست ردش کرد.** انتظار داشتم کلید بماند («حذفِ نرم
   * است، نه پاک‌کردنِ کلید»). ولی حذفِ نرم قاعده‌ی ماست برای **حذفِ کاربر**؛ undoِ
   * یک **ساخت** خودِ ورودیِ `Y.Map` را از سند برمی‌دارد.
   *
   * چیزی که واقعاً اهمیت دارد **همگرایی** است، نه اینکه کلید بماند — و آن برقرار است.
   */
  it("undoِ ساخت، کلید را برمی‌دارد؛ ولی دو سند همگرا می‌مانند", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const sync = () => {
      Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
      Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
    };
    const ea = a.getMap<Y.Map<unknown>>("elements");
    const eb = b.getMap<Y.Map<unknown>>("elements");
    const undo = new Y.UndoManager(ea, { trackedOrigins: new Set([LOCAL_ORIGIN]) });

    a.transact(() => {
      const map = new Y.Map<unknown>();
      map.set("x", 10);
      map.set("isDeleted", false);
      ea.set("stk_1", map);
    }, LOCAL_ORIGIN);
    sync();

    // همتا حذفِ نرم می‌کند …
    b.transact(() => (eb.get("stk_1") as Y.Map<unknown>).set("isDeleted", true), REMOTE_ORIGIN);
    sync();

    // … و کاربرِ محلی ساختِ خودش را undo می‌کند.
    undo.undo();
    sync();

    expect(ea.has("stk_1")).toBe(false);
    // ★ ادعای واقعی: هیچ واگرایی‌ای نمی‌ماند و هیچ استثنایی پرتاب نمی‌شود.
    expect(JSON.stringify(ea.toJSON())).toBe(JSON.stringify(eb.toJSON()));
  });

  it("چند تغییر در **یک** تراکنش = **یک** ورودی undo (همتای ADR-026 در لایه‌ی سند)", () => {
    const { doc, elements, undo, read, seed } = setup();
    seed("stk_1", { x: 0, y: 0 });
    seed("stk_2", { x: 0, y: 0 });

    // یک ژست: حرکتِ دو عنصر با هم.
    doc.transact(() => {
      (elements.get("stk_1") as Y.Map<unknown>).set("x", 50);
      (elements.get("stk_2") as Y.Map<unknown>).set("x", 70);
    }, LOCAL_ORIGIN);

    expect(undo.undoStack).toHaveLength(1);
    undo.undo();

    // هر دو با هم برگشتند — نه یکی‌یکی.
    expect(read("stk_1", "x")).toBe(0);
    expect(read("stk_2", "x")).toBe(0);
  });
});

/**
 * ★★ **چرا `trackedOrigins` و `captureUpdate: "NEVER"` دو سدِ مستقل‌اند.**
 *
 * وسوسه‌ی طبیعی این است که فکر کنیم یکی کافی است. این بند نشان می‌دهد هرکدام یک
 * **مسیرِ متفاوت** را می‌بندد:
 *
 * - `trackedOrigins` تاریخچه‌ی **`Y.UndoManager`** را محافظت می‌کند — یعنی
 *   `undo`ای که binder صدا می‌زند.
 * - `captureUpdate: "NEVER"` تاریخچه‌ی **خودِ موتورِ رندر** را محافظت می‌کند — یعنی
 *   `Ctrl+Z`ای که کاربر روی بوم می‌زند و موتور خودش پردازشش می‌کند.
 *
 * این دو تاریخچه‌ی **جدا** اند. تستِ پایین همان چیزی را که در Yjs قابلِ نشان دادن
 * است می‌سنجد؛ نیمه‌ی موتور فقط در مرورگر آزمودنی است و در **گام ۳٫۲/۳٫۴** به
 * تستِ واقعی تبدیل می‌شود.
 */
describe("★★ دو سدِ مستقل — نه یک چیز با دو نام", () => {
  it("trackedOrigins فقط تاریخچه‌ی UndoManager را می‌بندد، نه اعمالِ تغییر را", () => {
    const { seed, edit, read, undo } = setup();
    seed("stk_1", { x: 0 });

    edit("stk_1", "x", 500, REMOTE_ORIGIN);

    // ★ تغییرِ remote **اعمال شد** — `trackedOrigins` جلوی اعمال را نمی‌گیرد،
    //   فقط نمی‌گذارد در undo stack بنشیند. اگر کسی فکر کند این «تغییرِ remote را
    //   فیلتر می‌کند»، سراغِ سدِ دوم نمی‌رود.
    expect(read("stk_1", "x")).toBe(500);
    expect(undo.undoStack).toHaveLength(0);
  });

  /**
   * ★★ **یافته‌ی وارونه — مهم‌ترین چیزِ این فایل.**
   *
   * فرضِ من این بود که `new Y.UndoManager(scope)`ِ بدونِ گزینه «همه‌چیز را ردیابی
   * می‌کند». **دقیقاً برعکس است:** پیش‌فرضِ `trackedOrigins` فقط `null` است.
   *
   * سنجیده شد: `null` ✔ · `undefined` ✔ · `"local-user"` ✘ · `"remote"` ✘
   *
   * **چرا این یک تله‌ی واقعی برای گام ۳٫۳/۳٫۴ است:** binder موظف است تغییرات را با
   * `origin`ِ **نام‌دار** بنویسد (برای گروه‌بندیِ ژست و تشخیصِ محلی/remote — PLAN ۷٫۴).
   * پس اگر کسی `trackedOrigins` را جا بیندازد، undo **بی‌صدا هیچ کاری نمی‌کند** —
   * نه خطا، نه هشدار. کاربر `Ctrl+Z` می‌زند و هیچ اتفاقی نمی‌افتد.
   */
  it("★★ پیش‌فرضِ UndoManager فقط `null` را ردیابی می‌کند — originِ نام‌دار نه", () => {
    const doc = new Y.Doc();
    const elements = doc.getMap<Y.Map<unknown>>("elements");
    const undo = new Y.UndoManager(elements); // بدونِ trackedOrigins

    doc.transact(() => {
      const map = new Y.Map<unknown>();
      map.set("x", 0);
      elements.set("stk_1", map);
    }, "system");
    undo.clear();

    // originِ نام‌دار — همان چیزی که binder می‌نویسد.
    doc.transact(() => (elements.get("stk_1") as Y.Map<unknown>).set("x", 999), LOCAL_ORIGIN);
    expect(undo.undoStack, "originِ نام‌دار با پیش‌فرض ردیابی نمی‌شود").toHaveLength(0);

    undo.undo();
    // undo هیچ کاری نکرد — بی‌صدا.
    expect((elements.get("stk_1") as Y.Map<unknown>).get("x")).toBe(999);

    // و برای مقایسه: origin برابرِ `null` **ردیابی می‌شود**.
    doc.transact(() => (elements.get("stk_1") as Y.Map<unknown>).set("x", 1), null);
    expect(undo.undoStack).toHaveLength(1);
  });
});
