/**
 * @vitest-environment jsdom
 *
 * ★ یافته‌ی probe: **ورودیِ اصلیِ `@hamboom/canvas-core` در Nodeِ خالص بارگذاری
 * نمی‌شود.** خودِ Excalidraw هنگامِ *بارگذاریِ ماژول* به `window` دست می‌زند، و
 * `index.ts`ِ canvas-core آن را re-export می‌کند — پس حتی importِ یک تابعِ خالصِ
 * سازنده کلِ موتور را بالا می‌آورد.
 *
 * برای این فایل jsdom کافی است. **برای binderِ فاز ۳ اهمیتِ عملی ندارد** (کدِ
 * مرورگر است)، ولی تاییدِ دوباره‌ی ADR-029 است: `ydoc-schema` و `apps/realtime`
 * حق ندارند canvas-core را ببینند، وگرنه سرور هم به DOM گره می‌خورد.
 */
import {
  createConnector,
  createDraw,
  createFrame,
  createImage,
  createShape,
  createSticky,
  createText,
} from "@hamboom/canvas-core";
import { hbElement, type HbElement } from "@hamboom/shared-types";
import * as Y from "yjs";
import { describe, expect, it } from "vitest";

/**
 * probeِ گام ۱٫۲ — وفاداریِ codec و اندازه‌ی update.
 *
 * ── چرا اینجا و نه در `ydoc-schema` ───────────────────────────────────
 *
 * ادعای این probe این است که **خروجیِ سازنده‌های واقعیِ M1** از Y.Doc سالم
 * برمی‌گردد — نه یک نمونه‌ی دستی که ممکن است فیلدهای دردسرساز را نداشته باشد.
 * برای همین به `canvas-core` نیاز دارد، و طبق [ADR-029](../../../ARCHITECTURE_DECISIONS.md#adr-029)
 * تنها پکیجی که مجاز است هر دو را ببیند همین است.
 *
 * ── codecِ اینجا عمداً حداقلی و موقت است ──────────────────────────────
 *
 * فاز ۱ **شواهد** تولید می‌کند، نه کدِ محصولی. codecِ واقعی در گام ۲٫۱ و
 * **بر اساسِ نتیجه‌ی همین probe** در `ydoc-schema` نوشته می‌شود.
 */

// ── codecِ حداقلیِ probe ─────────────────────────────────────────────

/**
 * نوشتنِ عنصر **property به property** — الگویی که probeِ ادغام
 * (`ydoc-schema/src/merge-probe.test.ts`) تاییدش کرد.
 *
 * `previous` که داده شود، فقط فیلدهای **تغییرکرده** نوشته می‌شوند؛ همان چیزی که
 * ترافیک را از «کلِ عنصر در هر تیکِ درگ» به «دو عدد» می‌رساند.
 */
function writeElement(target: Y.Map<unknown>, element: HbElement, previous?: HbElement): void {
  const before = previous as unknown as Record<string, unknown> | undefined;
  for (const [key, value] of Object.entries(element)) {
    // ⚠️ یافته‌ی probe: `undefined` را نمی‌شود در Y.Map گذاشت. فیلدهای اختیاریِ
    //    تعریف‌نشده باید **رد** شوند، نه اینکه به null تبدیل شوند — وگرنه
    //    `hbElement.parse` روی فیلدی که `.optional()` است ولی `null` گرفته می‌افتد.
    if (value === undefined) continue;
    if (before && JSON.stringify(before[key]) === JSON.stringify(value)) continue;
    target.set(key, value);
  }
}

function readElement(source: Y.Map<unknown>): unknown {
  return Object.fromEntries(source.entries());
}

// ── نمونه‌های واقعی ─────────────────────────────────────────────────

const AUTHOR = "u_probe";
/** بذرِ قطعی تا اجراها تکرارپذیر بمانند. */
const seed = {
  makeId: (() => {
    let n = 0;
    return () => `el_${(n++).toString().padStart(3, "0")}`;
  })(),
  random: () => 0.5,
  now: 1,
};

/** یک نمونه از **هر ۹ نوعِ رندر**، از سازنده‌های واقعی. */
function realElements(): Array<{ label: string; element: HbElement }> {
  const sticky = createSticky({ ...seed, x: 10, y: 20, authorId: AUTHOR, text: "سلام دنیا" });
  const shapeRect = createShape({
    ...seed,
    shape: "rectangle",
    x: 0,
    y: 0,
    authorId: AUTHOR,
    text: "متنِ داخل",
  });
  const shapeEllipse = createShape({ ...seed, shape: "ellipse", x: 0, y: 0, authorId: AUTHOR });
  const shapeDiamond = createShape({ ...seed, shape: "diamond", x: 0, y: 0, authorId: AUTHOR });
  const connector = createConnector({
    ...seed,
    start: { box: { x: 0, y: 0 } },
    end: { box: { x: 200, y: 120 } },
    authorId: AUTHOR,
    label: "برچسبِ فارسی",
  });
  const frame = createFrame({ ...seed, x: 0, y: 0, name: "جلسه‌ی هفتگی", authorId: AUTHOR });
  const image = createImage({
    ...seed,
    fileId: "f_probe",
    x: 0,
    y: 0,
    width: 320,
    height: 200,
    authorId: AUTHOR,
  });
  const draw = createDraw({
    ...seed,
    points: [
      [0, 0],
      [10, 12],
      [25, 30],
    ],
    authorId: AUTHOR,
  });
  const text = createText({ ...seed, x: 5, y: 5, text: "متنِ آزاد", authorId: AUTHOR });

  return [
    { label: "sticky (ظرف)", element: sticky.container },
    { label: "sticky (متنِ مقید)", element: sticky.text },
    { label: "shape/rectangle", element: shapeRect.shape },
    { label: "shape/ellipse", element: shapeEllipse.shape },
    { label: "shape/diamond", element: shapeDiamond.shape },
    { label: "connector (arrow)", element: connector },
    { label: "frame", element: frame },
    { label: "image", element: image },
    { label: "freedraw", element: draw },
    { label: "text (آزاد)", element: text },
  ];
}

describe("وفاداریِ round-trip روی خروجیِ سازنده‌های واقعی", () => {
  const samples = realElements();

  it("هر ۹ نوعِ رندر پوشش داده شده", () => {
    const types = new Set(samples.map((s) => s.element.type));
    expect([...types].sort()).toEqual(
      ["arrow", "diamond", "ellipse", "frame", "freedraw", "image", "rectangle", "text"].sort(),
    );
    // `line` تنها نوعی است که سازنده‌ی اختصاصی ندارد (کانکتور همیشه arrow است).
    // در گام ۲٫۱ باید در codec پوشش داده شود حتی اگر ابزارِ محصولی نسازدش.
  });

  for (const { label, element } of samples) {
    it(`«${label}» بیت‌به‌بیت برمی‌گردد و schema را پاس می‌کند`, () => {
      const doc = new Y.Doc();
      const map = new Y.Map<unknown>();
      doc.getMap("elements").set(element.id, map);
      writeElement(map, element);

      const back = readElement(map);
      // ★ ادعای اصلی: چیزی که برمی‌گردد **قراردادی** است، نه صرفاً شبیه.
      expect(() => hbElement.parse(back)).not.toThrow();
      // و دقیقاً همان است — نه فقط معتبر.
      expect(back).toEqual(JSON.parse(JSON.stringify(element)));
    });
  }

  it("★ `customData.hb` تودرتو دست‌نخورده می‌مانَد", () => {
    const sticky = createSticky({ ...seed, x: 0, y: 0, authorId: AUTHOR, palette: "violet" });
    const doc = new Y.Doc();
    const map = new Y.Map<unknown>();
    doc.getMap("elements").set("s", map);
    writeElement(map, sticky.container);

    const back = hbElement.parse(readElement(map));
    expect(back.customData.hb.kind).toBe("sticky");
    expect(back.customData.hb.sticky?.palette).toBe("violet");
  });

  it("نوشتنِ عنصرِ **بدونِ تغییر** هیچ updateای تولید نمی‌کند (نگهبانِ ترافیک)", () => {
    const { element } = samples[0]!;
    const doc = new Y.Doc();
    const map = new Y.Map<unknown>();
    doc.getMap("elements").set(element.id, map);
    writeElement(map, element);

    const before = Y.encodeStateVector(doc);
    writeElement(map, element, element); // همان عنصر، بدونِ تغییر
    const update = Y.encodeStateAsUpdate(doc, before);

    // آستانه‌ی کوچک: یک updateِ خالیِ Yjs چند بایتِ ثابت سربار دارد.
    expect(update.byteLength).toBeLessThan(30);
  });
});

describe("اندازه‌ی واقعیِ update — ورودیِ docs/ydoc-baseline.md", () => {
  /** بایتِ updateِ افزایشی برای یک عملیات. */
  function measure(operation: (doc: Y.Doc) => void, setup?: (doc: Y.Doc) => void): number {
    const doc = new Y.Doc();
    setup?.(doc);
    const before = Y.encodeStateVector(doc);
    operation(doc);
    return Y.encodeStateAsUpdate(doc, before).byteLength;
  }

  const sizes: Record<string, number> = {};

  it("ساختِ استیکی (ظرف + متنِ مقید)", () => {
    const sticky = createSticky({ ...seed, x: 10, y: 20, authorId: AUTHOR, text: "یادداشت" });
    sizes["ساخت استیکی (۲ عنصر)"] = measure((doc) => {
      for (const el of [sticky.container, sticky.text]) {
        const map = new Y.Map<unknown>();
        doc.getMap("elements").set(el.id, map);
        writeElement(map, el);
      }
    });
    expect(sizes["ساخت استیکی (۲ عنصر)"]).toBeGreaterThan(0);
  });

  it("یک تیکِ درگ (فقط x و y)", () => {
    const shape = createShape({ ...seed, shape: "rectangle", x: 0, y: 0, authorId: AUTHOR });
    sizes["یک تیکِ درگ (x,y)"] = measure(
      (doc) => {
        const map = doc.getMap("elements").get(shape.shape.id) as Y.Map<unknown>;
        writeElement(map, { ...shape.shape, x: 120, y: 80 }, shape.shape);
      },
      (doc) => {
        const map = new Y.Map<unknown>();
        doc.getMap("elements").set(shape.shape.id, map);
        writeElement(map, shape.shape);
      },
    );
    expect(sizes["یک تیکِ درگ (x,y)"]).toBeGreaterThan(0);
  });

  it("تغییرِ رنگ (یک property)", () => {
    const sticky = createSticky({ ...seed, x: 0, y: 0, authorId: AUTHOR });
    sizes["تغییر رنگ (۱ property)"] = measure(
      (doc) => {
        const map = doc.getMap("elements").get(sticky.container.id) as Y.Map<unknown>;
        writeElement(map, { ...sticky.container, backgroundColor: "#D0C6F5" }, sticky.container);
      },
      (doc) => {
        const map = new Y.Map<unknown>();
        doc.getMap("elements").set(sticky.container.id, map);
        writeElement(map, sticky.container);
      },
    );
    expect(sizes["تغییر رنگ (۱ property)"]).toBeGreaterThan(0);
  });

  it("استروکِ قلمِ ساده‌شده (یک commit)", () => {
    const points: Array<[number, number]> = Array.from({ length: 30 }, (_, i) => [i * 3, i * 2]);
    const draw = createDraw({ ...seed, points, authorId: AUTHOR });
    sizes["استروک قلم (۳۰ نقطه)"] = measure((doc) => {
      const map = new Y.Map<unknown>();
      doc.getMap("elements").set(draw.id, map);
      writeElement(map, draw);
    });
    expect(sizes["استروک قلم (۳۰ نقطه)"]).toBeGreaterThan(0);
  });

  it("★ همان تیکِ درگ، ولی با نوشتنِ **کلِ عنصر** — حالتِ بد، برای مقایسه", () => {
    const shape = createShape({ ...seed, shape: "rectangle", x: 0, y: 0, authorId: AUTHOR });
    sizes["یک تیکِ درگ — نوشتنِ کلِ عنصر"] = measure(
      (doc) => {
        const map = doc.getMap("elements").get(shape.shape.id) as Y.Map<unknown>;
        // بدونِ `previous` → همه‌ی propertyها دوباره نوشته می‌شوند.
        writeElement(map, { ...shape.shape, x: 120, y: 80 });
      },
      (doc) => {
        const map = new Y.Map<unknown>();
        doc.getMap("elements").set(shape.shape.id, map);
        writeElement(map, shape.shape);
      },
    );
    expect(sizes["یک تیکِ درگ — نوشتنِ کلِ عنصر"]).toBeGreaterThan(0);
  });

  it("★ گزارشِ اعداد + ادعای نسبی: تیکِ درگ باید **خیلی** کوچک‌تر از ساخت باشد", () => {
    // اگر این نسبت برقرار نباشد، یعنی per-property کار نمی‌کند و هر تیکِ درگ
    // دارد کلِ عنصر را می‌فرستد — همان چیزی که ADR-007 و جدولِ throttle
    // (PLAN ۷٫۴) برای اجتنابش طراحی شده‌اند.
    // eslint-disable-next-line no-console
    console.log("\n  اندازه‌ی update (بایت):", JSON.stringify(sizes, null, 2), "\n");
    expect(sizes["یک تیکِ درگ (x,y)"]).toBeLessThan(sizes["ساخت استیکی (۲ عنصر)"]! / 4);
    // و صرفه‌جوییِ per-property در برابر نوشتنِ کلِ عنصر باید **مرتبه‌ای** باشد،
    // نه چند درصد — وگرنه پیچیدگیِ دیف‌گرفتن ارزشش را ندارد.
    expect(sizes["یک تیکِ درگ (x,y)"]! * 5).toBeLessThan(sizes["یک تیکِ درگ — نوشتنِ کلِ عنصر"]!);
  });
});
