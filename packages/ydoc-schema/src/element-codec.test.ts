import { hbElement, hbElementType, type HbTextElement } from "@hamboom/shared-types";
import * as Y from "yjs";
import { describe, expect, it } from "vitest";

import { boardRoots, createBoardDoc } from "./doc.ts";
import { readElement, writeElement } from "./element-codec.ts";
import { ELEMENT_FIXTURES, stickyFixture, textFixture } from "./test-fixtures.ts";

/**
 * تست‌های دائمیِ codec — گام ۲٫۱.
 *
 * چیزهایی که در فاز ۱ به‌صورت **probe** ثابت شدند اینجا به نگهبانِ دائمی تبدیل
 * می‌شوند: ادغامِ per-property (گام ۱٫۲)، `customData`ِ تودرتو (ADR-033)، و
 * `Y.Text` برای `originalText` (ADR-034). فرقشان با probe این است که probe یک
 * **تصمیم** می‌گرفت؛ این‌ها جلوی برگشتنِ تصمیم را می‌گیرند.
 */

/** دو سندِ جدا که مثلِ دو کلاینتِ واقعی update رد و بدل می‌کنند. */
function twoClients() {
  const a = createBoardDoc();
  const b = createBoardDoc();
  return {
    a,
    b,
    elementsOf: (doc: Y.Doc) => boardRoots(doc).elements,
    sync() {
      const updateA = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
      const updateB = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
      Y.applyUpdate(b, updateA);
      Y.applyUpdate(a, updateB);
    },
  };
}

function elementMap(doc: Y.Doc, id: string): Y.Map<unknown> {
  const map = boardRoots(doc).elements.get(id);
  if (!(map instanceof Y.Map)) throw new Error(`عنصر «${id}» در سند نیست`);
  return map;
}

/** خواندن با باریک‌کردنِ union — `originalText` فقط روی عنصرِ متن هست. */
function readTextElement(doc: Y.Doc, id: string): HbTextElement {
  const element = readElement(elementMap(doc, id));
  if (element.type !== "text") throw new Error(`عنصر «${id}» از نوعِ متن نیست`);
  return element;
}

// ─────────────────────────────────────────────────────────────
// اعتبارِ خودِ نمونه‌ها — قبل از هر ادعای دیگری
// ─────────────────────────────────────────────────────────────

describe("نمونه‌های تست خودشان معتبرند", () => {
  // بدونِ این، یک نمونه‌ی واگرا کلِ فایل را به سبزِ دروغین تبدیل می‌کرد: codec
  // «دقیقاً همان چیزی که گرفته» را برمی‌گرداند، حتی اگر آن چیز بی‌اعتبار باشد.
  for (const { label, element } of ELEMENT_FIXTURES) {
    it(`«${label}» با schema می‌خواند`, () => {
      expect(() => hbElement.parse(element)).not.toThrow();
    });
  }

  it("★ هر ۹ نوعِ رندر پوشش داده شده — شاملِ `line`", () => {
    const covered = new Set(ELEMENT_FIXTURES.map((f) => f.element.type));
    expect([...covered].sort()).toEqual([...hbElementType.options].sort());
  });
});

// ─────────────────────────────────────────────────────────────
// وفاداریِ round-trip
// ─────────────────────────────────────────────────────────────

describe("round-trip روی هر ۹ نوعِ عنصر", () => {
  for (const { label, element } of ELEMENT_FIXTURES) {
    it(`«${label}» بیت‌به‌بیت برمی‌گردد و schema را پاس می‌کند`, () => {
      const doc = createBoardDoc();
      writeElement(boardRoots(doc).elements, element);

      const back = readElement(elementMap(doc, element.id));
      expect(() => hbElement.parse(back)).not.toThrow();
      // نه فقط «معتبر» — دقیقاً همان.
      expect(back).toEqual(element);
    });
  }

  it("خواندن از `toJSON()` می‌رود، پس `Y.Map`ِ تودرتو خام بیرون نمی‌زند", () => {
    const doc = createBoardDoc();
    const elements = boardRoots(doc).elements;
    writeElement(elements, stickyFixture());

    const raw = Object.fromEntries(elementMap(doc, "stk_1").entries());
    // مسیرِ غلط: `customData` یک `Y.Map`ِ خام است و parse می‌افتد.
    expect(raw.customData).toBeInstanceOf(Y.Map);
    expect(() => hbElement.parse(raw)).toThrow();
    // مسیرِ درست:
    expect(() => hbElement.parse(readElement(elementMap(doc, "stk_1")))).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────
// چهار قیدِ ورودیِ فاز ۱
// ─────────────────────────────────────────────────────────────

describe("★ قیدِ ۱ — `undefined` رد می‌شود، نه تبدیل به `null`", () => {
  it("فیلدِ اختیاریِ تعریف‌نشده اصلاً کلید نمی‌گیرد", () => {
    const element = stickyFixture();
    delete element.customData.hb.tags;

    const doc = createBoardDoc();
    writeElement(boardRoots(doc).elements, element);

    const customData = elementMap(doc, "stk_1").get("customData") as Y.Map<unknown>;
    const hb = customData.get("hb") as Y.Map<unknown>;
    expect(hb.has("tags")).toBe(false);
    // ★ اگر `null` می‌شد، همین‌جا می‌افتاد: `tags` یک `.optional()`ِ آرایه است.
    expect(() => hbElement.parse(readElement(elementMap(doc, "stk_1")))).not.toThrow();
  });

  it("پاک‌کردنِ یک فیلدِ اختیاری، کلیدِ قبلی را از سند برمی‌دارد", () => {
    const doc = createBoardDoc();
    const elements = boardRoots(doc).elements;
    writeElement(elements, stickyFixture()); // با `tags`

    const without = stickyFixture();
    delete without.customData.hb.tags;
    writeElement(elements, without);

    const hb = (elementMap(doc, "stk_1").get("customData") as Y.Map<unknown>).get(
      "hb",
    ) as Y.Map<unknown>;
    expect(hb.has("tags")).toBe(false);
  });
});

describe("★ قیدِ ۲ — نوشتنِ عنصرِ بدونِ تغییر = صفر update", () => {
  it("هیچ رویدادِ updateای شلیک نمی‌شود", () => {
    const doc = createBoardDoc();
    const elements = boardRoots(doc).elements;
    const element = stickyFixture();
    writeElement(elements, element);

    let updates = 0;
    doc.on("update", () => updates++);
    writeElement(elements, stickyFixture()); // همان مقادیر، شیءِ تازه

    // ادعای دقیق، نه آستانه‌ی بایتی: **هیچ** عملیاتی روی سند انجام نشد.
    expect(updates).toBe(0);
  });

  it("ترتیبِ کلیدهای متفاوت هم updateای نمی‌سازد", () => {
    const doc = createBoardDoc();
    const elements = boardRoots(doc).elements;
    const element = stickyFixture();
    writeElement(elements, element);

    // همان `frameRendering`ِ تودرتو، با ترتیبِ معکوسِ کلیدها. اگر مقایسه با
    // `JSON.stringify` بود، اینجا بی‌دلیل update می‌ساخت.
    const reordered = stickyFixture();
    reordered.customData = {
      hb: {
        sticky: element.customData.hb.sticky,
        tags: element.customData.hb.tags,
        createdAt: element.customData.hb.createdAt,
        lastEditedBy: element.customData.hb.lastEditedBy,
        createdBy: element.customData.hb.createdBy,
        kind: element.customData.hb.kind,
        schema: element.customData.hb.schema,
      },
    };

    let updates = 0;
    doc.on("update", () => updates++);
    writeElement(elements, reordered);
    expect(updates).toBe(0);
  });

  it("یک تیکِ درگ فقط `x` و `y` را می‌فرستد — نه کلِ عنصر", () => {
    const doc = createBoardDoc();
    const elements = boardRoots(doc).elements;
    writeElement(elements, stickyFixture());

    const before = Y.encodeStateVector(doc);
    const moved = stickyFixture();
    moved.x = 640;
    moved.y = 480;
    writeElement(elements, moved);

    // در گام ۱٫۲ سنجیده شد: ۳۹ بایت per-property در برابرِ ۴۳۸ بایت برای کلِ
    // عنصر. آستانه سخاوتمندانه است تا رگرسیونِ **مرتبه‌ای** را بگیرد، نه نوسان.
    expect(Y.encodeStateAsUpdate(doc, before).byteLength).toBeLessThan(100);
  });
});

describe("★ قیدِ ۴ — `customData` بازگشتی `Y.Map`، آرایه‌ها ساده", () => {
  it("هر آبجکتِ ساده `Y.Map` می‌شود و آرایه‌ها دست‌نخورده می‌مانند", () => {
    const doc = createBoardDoc();
    writeElement(boardRoots(doc).elements, stickyFixture());

    const map = elementMap(doc, "stk_1");
    const customData = map.get("customData");
    expect(customData).toBeInstanceOf(Y.Map);
    const hb = (customData as Y.Map<unknown>).get("hb");
    expect(hb).toBeInstanceOf(Y.Map);
    // ★ بازگشتی و بدونِ استثنا — بُرش در عمقِ دلبخواه بعداً کسی باید مرزش را
    //   یادش می‌ماند (ADR-033).
    expect((hb as Y.Map<unknown>).get("sticky")).toBeInstanceOf(Y.Map);
    // آرایه‌ها عمداً LWW: ادغامِ کاراکتریِ آرایه‌ی برچسب یا نقاط بی‌معنی است.
    expect((hb as Y.Map<unknown>).get("tags")).toEqual(["مهم"]);
    expect(Array.isArray((hb as Y.Map<unknown>).get("tags"))).toBe(true);
  });

  it("`roundness` از آبجکت به `null` و برعکس درست جابه‌جا می‌شود", () => {
    const doc = createBoardDoc();
    const elements = boardRoots(doc).elements;
    writeElement(elements, stickyFixture());
    expect(elementMap(doc, "stk_1").get("roundness")).toBeInstanceOf(Y.Map);

    const sharp = stickyFixture();
    sharp.roundness = null;
    writeElement(elements, sharp);
    expect(elementMap(doc, "stk_1").get("roundness")).toBeNull();

    writeElement(elements, stickyFixture());
    expect(readElement(elementMap(doc, "stk_1")).roundness).toEqual({ type: 3, value: 32 });
  });
});

// ─────────────────────────────────────────────────────────────
// ادغامِ همزمان — نگهبانِ دائمیِ ADR-007 و ADR-033
// ─────────────────────────────────────────────────────────────

describe("★ ادغامِ همزمان از راهِ codecِ واقعی", () => {
  it("دو کلاینت، دو propertyِ مختلفِ یک عنصر → هر دو می‌مانند", () => {
    const { a, b, elementsOf, sync } = twoClients();
    writeElement(elementsOf(a), stickyFixture());
    sync();

    const recolored = stickyFixture();
    recolored.backgroundColor = "#D0C6F5";
    writeElement(elementsOf(a), recolored);

    const moved = stickyFixture();
    moved.x = 640;
    moved.y = 480;
    writeElement(elementsOf(b), moved);

    sync();

    for (const [name, doc] of [
      ["A", a],
      ["B", b],
    ] as const) {
      const merged = readElement(elementMap(doc, "stk_1"));
      expect(merged.backgroundColor, `${name}: رنگِ A`).toBe("#D0C6F5");
      expect(merged.x, `${name}: موقعیتِ B`).toBe(640);
      expect(merged.y, `${name}: موقعیتِ B`).toBe(480);
    }
  });

  it("★ `customData`: پالت و برچسبِ همزمان → هر دو می‌مانند (ADR-033)", () => {
    const { a, b, elementsOf, sync } = twoClients();
    writeElement(elementsOf(a), stickyFixture());
    sync();

    const repainted = stickyFixture();
    repainted.customData.hb.sticky = { palette: "violet", autoFit: true };
    writeElement(elementsOf(a), repainted);

    const tagged = stickyFixture();
    tagged.customData.hb.tags = ["مهم", "فوری"];
    writeElement(elementsOf(b), tagged);

    sync();

    for (const [name, doc] of [
      ["A", a],
      ["B", b],
    ] as const) {
      const hb = readElement(elementMap(doc, "stk_1")).customData.hb;
      expect(hb.sticky?.palette, `${name}: پالت`).toBe("violet");
      expect(hb.tags, `${name}: برچسب`).toEqual(["مهم", "فوری"]);
      // `kind` هم باید دست‌نخورده مانده باشد — ADR-010 رویش سوار است.
      expect(hb.kind, `${name}: kind`).toBe("sticky");
    }
  });

  it("حذفِ نرم در یک سو و جابه‌جایی در سوی دیگر واگرا نمی‌شود", () => {
    const { a, b, elementsOf, sync } = twoClients();
    writeElement(elementsOf(a), stickyFixture());
    sync();

    const removed = stickyFixture();
    removed.isDeleted = true;
    writeElement(elementsOf(a), removed);

    const moved = stickyFixture();
    moved.x = 99;
    writeElement(elementsOf(b), moved);

    sync();

    for (const doc of [a, b]) {
      const merged = readElement(elementMap(doc, "stk_1"));
      expect(merged.isDeleted).toBe(true);
      // حرکتِ B گم نشده — اگر بعداً undo شود، عنصر سرِ جای درست برمی‌گردد.
      expect(merged.x).toBe(99);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// متن — ADR-034
// ─────────────────────────────────────────────────────────────

describe("★ متن: `originalText` یک `Y.Text` است و `text` نیست", () => {
  it("شکلِ درون‌سندی همان چیزی است که ADR-034 تجویز کرد", () => {
    const doc = createBoardDoc();
    writeElement(boardRoots(doc).elements, textFixture());

    const map = elementMap(doc, "txt_1");
    expect(map.get("originalText")).toBeInstanceOf(Y.Text);
    // ★ `text` مشتق‌شده است و **هرگز** CRDT نمی‌شود — گام ۱٫۳ نشان داد `text`ِ
    //   emit‌شده‌ی هر دو کلاینت بعد از ادغام غلط است. binder بازمحاسبه‌اش می‌کند.
    expect(typeof map.get("text")).toBe("string");
    // و از مرزِ قرارداد بیرون نمی‌زند:
    expect(readTextElement(doc, "txt_1").originalText).toBe("سلام دنیا");
  });

  it("تایپِ همزمان در دو جای متن → هر دو ویرایش می‌مانند", () => {
    const { a, b, elementsOf, sync } = twoClients();
    writeElement(elementsOf(a), textFixture());
    sync();

    const fromA = textFixture();
    fromA.originalText = "★سلام دنیا";
    writeElement(elementsOf(a), fromA);

    const fromB = textFixture();
    fromB.originalText = "سلام دنیا!";
    writeElement(elementsOf(b), fromB);

    sync();

    expect(readTextElement(a, "txt_1").originalText).toBe("★سلام دنیا!");
    expect(readTextElement(b, "txt_1").originalText).toBe(readTextElement(a, "txt_1").originalText);
  });

  it("★★ پایه‌ی دیف زنده است — درجِ همتا با یک جایگزینیِ محلی مخدوش نمی‌شود", () => {
    const { a, b, elementsOf, sync } = twoClients();
    writeElement(elementsOf(a), textFixture());
    sync();

    // همتا در **وسط** درج می‌کند.
    const peerEdit = textFixture();
    peerEdit.originalText = "سلام ★دنیا";
    writeElement(elementsOf(b), peerEdit);
    sync();

    // کاربرِ محلی «دنیا» را با «رفیق» **جایگزین** می‌کند — روی مقدارِ زنده‌ی سند.
    const live = readTextElement(a, "txt_1");
    const localEdit = textFixture();
    localEdit.originalText = live.originalText.replace("دنیا", "رفیق");
    writeElement(elementsOf(a), localEdit);
    sync();

    // با پایه‌ی کهنه نتیجه «سلام رفیقا» می‌شد (سنجیده‌شده در گام ۱٫۳). چون
    // `applyTextDiff` پایه‌اش را از خودِ `Y.Text` می‌گیرد، آن مسیر بسته است.
    expect(readTextElement(a, "txt_1").originalText).toBe("سلام ★رفیق");
    expect(readTextElement(b, "txt_1").originalText).toBe("سلام ★رفیق");
  });

  it("نوشتنِ همان متن، `Y.Text` را دست‌نخورده می‌گذارد", () => {
    const doc = createBoardDoc();
    const elements = boardRoots(doc).elements;
    writeElement(elements, textFixture());
    const ytext = elementMap(doc, "txt_1").get("originalText");

    let updates = 0;
    doc.on("update", () => updates++);
    writeElement(elements, textFixture());

    expect(updates).toBe(0);
    // همان نمونه، نه یک `Y.Text`ِ تازه — وگرنه تاریخچه‌ی متن هر بار پاک می‌شد.
    expect(elementMap(doc, "txt_1").get("originalText")).toBe(ytext);
  });
});
