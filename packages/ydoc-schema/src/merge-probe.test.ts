import * as Y from "yjs";
import { describe, expect, it } from "vitest";

/**
 * ★★ probeِ گام ۱٫۲ — **ادعای مرکزیِ [ADR-007](../../../ARCHITECTURE_DECISIONS.md#adr-007)**.
 *
 * ADR-007 می‌گوید هر عنصر باید خودش یک `Y.Map` باشد، نه یک آبجکتِ ساده، «تا دو نفر
 * بتوانند همزمان رنگ و موقعیتِ یک استیکی را عوض کنند و **هر دو تغییر بماند**».
 *
 * ── چرا این حیاتی‌ترین آزمایشِ فاز ۱ است ──────────────────────────────
 *
 * کلِ معماریِ sync روی همین سوار است. اگر این ادعا برقرار نباشد، `Y.Map`ِ تودرتو
 * فقط سربارِ حافظه است بدونِ فایده، و مدلِ سند باید **قبل از فاز ۲** بازبینی شود.
 * پس اینجا هم ادعا را می‌آزماییم و هم **ضدش** را: ثابت می‌کنیم نوشتنِ آبجکتِ کامل
 * واقعاً داده از دست می‌دهد. بدونِ نشان‌دادنِ حالتِ بد، «حالتِ خوب» معنا ندارد.
 *
 * این فایل عمداً **فقط Yjs خالص** است — بدونِ codec و بدونِ canvas-core. چیزی که
 * می‌سنجیم خاصیتِ خودِ CRDT است، نه کدِ ما؛ هر لایه‌ای وسط، نتیجه را مبهم می‌کند.
 */

/** دو سندِ جدا که مثلِ دو کلاینتِ واقعی update رد و بدل می‌کنند. */
function twoClients() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  return {
    a,
    b,
    /** همگام‌سازیِ دوطرفه — همان کاری که سرور در فاز ۴ می‌کند. */
    sync() {
      const updateA = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
      const updateB = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
      Y.applyUpdate(b, updateA);
      Y.applyUpdate(a, updateB);
    },
  };
}

describe("★ ادعای مرکزی ADR-007 — ادغامِ per-property", () => {
  it("دو کلاینت همزمان دو property مختلفِ یک عنصر را عوض می‌کنند و هر دو می‌مانند", () => {
    const { a, b, sync } = twoClients();

    // حالتِ اولیه‌ی مشترک: یک عنصر با رنگ و موقعیت.
    const seed = a.getMap("elements");
    const element = new Y.Map<unknown>();
    element.set("id", "stk_1");
    element.set("backgroundColor", "#FFF9B1");
    element.set("x", 100);
    element.set("y", 200);
    seed.set("stk_1", element);
    sync();

    // ── همزمان، بدونِ اینکه همدیگر را دیده باشند ──────────────────────
    // کاربر A رنگ را عوض می‌کند …
    (a.getMap("elements").get("stk_1") as Y.Map<unknown>).set("backgroundColor", "#D0C6F5");
    // … و کاربر B در همان لحظه عنصر را جابه‌جا می‌کند.
    const bElement = b.getMap("elements").get("stk_1") as Y.Map<unknown>;
    bElement.set("x", 640);
    bElement.set("y", 480);

    sync();

    // ★ هر دو تغییر باید زنده باشند — و هر دو سند باید **یکسان** باشند.
    for (const [name, doc] of [
      ["A", a],
      ["B", b],
    ] as const) {
      const merged = doc.getMap("elements").get("stk_1") as Y.Map<unknown>;
      expect(merged.get("backgroundColor"), `${name}: رنگِ کاربر A باید مانده باشد`).toBe(
        "#D0C6F5",
      );
      expect(merged.get("x"), `${name}: موقعیتِ کاربر B باید مانده باشد`).toBe(640);
      expect(merged.get("y"), `${name}: موقعیتِ کاربر B باید مانده باشد`).toBe(480);
    }
  });

  it("★ ضدِ ادعا: نوشتنِ آبجکتِ کامل واقعاً یکی از دو تغییر را می‌خورد", () => {
    const { a, b, sync } = twoClients();

    // همان سناریو، ولی عنصر یک **مقدارِ ساده** است نه Y.Map تودرتو.
    a.getMap("elements").set("stk_1", { id: "stk_1", backgroundColor: "#FFF9B1", x: 100, y: 200 });
    sync();

    const fromA = a.getMap("elements").get("stk_1") as Record<string, unknown>;
    a.getMap("elements").set("stk_1", { ...fromA, backgroundColor: "#D0C6F5" });

    const fromB = b.getMap("elements").get("stk_1") as Record<string, unknown>;
    b.getMap("elements").set("stk_1", { ...fromB, x: 640, y: 480 });

    sync();

    // یکی از دو تغییر **از بین رفته** — این همان کلاسِ باگی است که ADR-007 حذفش کرد.
    const merged = a.getMap("elements").get("stk_1") as Record<string, unknown>;
    const bothSurvived = merged.backgroundColor === "#D0C6F5" && merged.x === 640;
    expect(bothSurvived, "با نوشتنِ آبجکتِ کامل نباید هر دو تغییر بمانند").toBe(false);
  });

  it("تعارض روی **همان** property: LWW قطعی است و هر دو سند یک نتیجه می‌گیرند", () => {
    const { a, b, sync } = twoClients();

    const element = new Y.Map<unknown>();
    element.set("x", 0);
    a.getMap("elements").set("stk_1", element);
    sync();

    (a.getMap("elements").get("stk_1") as Y.Map<unknown>).set("x", 111);
    (b.getMap("elements").get("stk_1") as Y.Map<unknown>).set("x", 222);
    sync();

    const xa = (a.getMap("elements").get("stk_1") as Y.Map<unknown>).get("x");
    const xb = (b.getMap("elements").get("stk_1") as Y.Map<unknown>).get("x");

    // مهم این نیست کدام برنده شود؛ مهم این است که **همگرا** شوند. اگر دو سند دو
    // مقدار داشته باشند، دو کاربر تا ابد دو چیزِ متفاوت می‌بینند.
    expect(xa).toBe(xb);
    expect([111, 222]).toContain(xa);
  });

  it("propertyهای آرایه‌ای (points/groupIds) عمداً LWW اند — و همگرا می‌مانند", () => {
    const { a, b, sync } = twoClients();

    const element = new Y.Map<unknown>();
    element.set("points", [
      [0, 0],
      [10, 10],
    ]);
    a.getMap("elements").set("arrow_1", element);
    sync();

    (a.getMap("elements").get("arrow_1") as Y.Map<unknown>).set("points", [
      [0, 0],
      [50, 50],
    ]);
    (b.getMap("elements").get("arrow_1") as Y.Map<unknown>).set("points", [
      [0, 0],
      [90, 10],
    ]);
    sync();

    const pa = (a.getMap("elements").get("arrow_1") as Y.Map<unknown>).get("points");
    const pb = (b.getMap("elements").get("arrow_1") as Y.Map<unknown>).get("points");
    // ADR-007 این را «هزینه‌ی پذیرفته‌شده» می‌داند: ادغامِ کاراکتریِ آرایه‌ی نقاط
    // بی‌معنی است. فقط نباید واگرا شوند.
    expect(pa).toEqual(pb);
  });

  it("حذفِ نرم در یک سو و ویرایش در سوی دیگر واگرایی نمی‌سازد", () => {
    const { a, b, sync } = twoClients();

    const element = new Y.Map<unknown>();
    element.set("isDeleted", false);
    element.set("x", 10);
    a.getMap("elements").set("stk_1", element);
    sync();

    // A حذف می‌کند (حذفِ **نرم** — کلید نمی‌رود، چون undo و CRDT به عنصر نیاز دارند)
    (a.getMap("elements").get("stk_1") as Y.Map<unknown>).set("isDeleted", true);
    // B همزمان جابه‌جایش می‌کند
    (b.getMap("elements").get("stk_1") as Y.Map<unknown>).set("x", 99);
    sync();

    const ea = a.getMap("elements").get("stk_1") as Y.Map<unknown>;
    const eb = b.getMap("elements").get("stk_1") as Y.Map<unknown>;
    expect(ea.get("isDeleted")).toBe(true);
    expect(eb.get("isDeleted")).toBe(true);
    // حرکتِ B هم گم نشده — یعنی اگر بعداً undo شود، عنصر سرِ جای درست برمی‌گردد.
    expect(ea.get("x")).toBe(99);
    expect(eb.get("x")).toBe(99);
  });
});
