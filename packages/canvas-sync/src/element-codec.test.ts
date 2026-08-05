/**
 * @vitest-environment jsdom
 *
 * (دلیلِ jsdom در [`codec-probe.test.ts`](codec-probe.test.ts) مستند است: خودِ
 * Excalidraw هنگامِ لودِ ماژول به `window` دست می‌زند.)
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
import type { CanvasDocument } from "@hamboom/canvas-core/sync";
import { hbElement, type HbElement } from "@hamboom/shared-types";
import { boardRoots, createBoardDoc, readDocument, readElement, writeElement } from "@hamboom/ydoc-schema";
import * as Y from "yjs";
import { describe, expect, it } from "vitest";

/**
 * ★ وفاداریِ codecِ **واقعی** در برابرِ خروجیِ سازنده‌های **واقعیِ** M1 — گام ۲٫۱.
 *
 * ── چرا اینجا و نه در `ydoc-schema` ───────────────────────────────────
 *
 * `ydoc-schema` حق ندارد `canvas-core` را ببیند
 * ([ADR-029](../../../ARCHITECTURE_DECISIONS.md#adr-029)) و نباید هم ببیند، چون
 * سرور همان پکیج را مصرف می‌کند. پس نمونه‌های آن پکیج **دستی**‌اند، و دستی یعنی
 * می‌تواند دقیقاً همان فیلدهای دردسرسازی را نداشته باشد که سازنده‌ی واقعی دارد.
 * این فایل آن شکاف را می‌بندد: تنها پکیجِ مجاز به دیدنِ هر دو.
 *
 * تقسیمِ کار: نمونه‌ی دستیِ `ydoc-schema` تنها جایی است که **`line`** پوشش داده
 * می‌شود (کانکتورِ محصولی همیشه `arrow` است، پس `line` هیچ سازنده‌ای ندارد).
 */

const AUTHOR = "u_codec";
const seed = {
  makeId: (() => {
    let n = 0;
    return () => `el_${(n++).toString().padStart(3, "0")}`;
  })(),
  random: () => 0.5,
  now: 1,
};

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
    fileId: "f_codec",
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

describe("codecِ واقعی روی خروجیِ سازنده‌های واقعی", () => {
  for (const { label, element } of realElements()) {
    it(`«${label}» بیت‌به‌بیت برمی‌گردد و schema را پاس می‌کند`, () => {
      const doc = createBoardDoc();
      writeElement(boardRoots(doc).elements, element);

      const map = boardRoots(doc).elements.get(element.id);
      expect(map).toBeInstanceOf(Y.Map);
      const back = readElement(map as Y.Map<unknown>);

      expect(() => hbElement.parse(back)).not.toThrow();
      expect(back).toEqual(JSON.parse(JSON.stringify(element)));
    });
  }

  it("★ `customData.hb` تودرتو از سازنده‌ی واقعی هم سالم برمی‌گردد", () => {
    const sticky = createSticky({ ...seed, x: 0, y: 0, authorId: AUTHOR, palette: "violet" });
    const doc = createBoardDoc();
    writeElement(boardRoots(doc).elements, sticky.container);

    const back = hbElement.parse(
      readElement(boardRoots(doc).elements.get(sticky.container.id) as Y.Map<unknown>),
    );
    expect(back.customData.hb.kind).toBe("sticky");
    expect(back.customData.hb.sticky?.palette).toBe("violet");
  });

  it("متنِ مقیدِ استیکی `originalText` را به `Y.Text` می‌برد، `text` را نه", () => {
    const sticky = createSticky({ ...seed, x: 0, y: 0, authorId: AUTHOR, text: "یادداشت" });
    const doc = createBoardDoc();
    writeElement(boardRoots(doc).elements, sticky.text);

    const map = boardRoots(doc).elements.get(sticky.text.id) as Y.Map<unknown>;
    expect(map.get("originalText")).toBeInstanceOf(Y.Text);
    expect(typeof map.get("text")).toBe("string");
  });

  it("یک تیکِ درگ روی عنصرِ واقعی هم فقط دو عدد می‌فرستد", () => {
    const shape = createShape({ ...seed, shape: "rectangle", x: 0, y: 0, authorId: AUTHOR });
    const doc = createBoardDoc();
    writeElement(boardRoots(doc).elements, shape.shape);

    const before = Y.encodeStateVector(doc);
    writeElement(boardRoots(doc).elements, { ...shape.shape, x: 120, y: 80 });

    // گام ۱٫۲: ۳۹ بایت در برابرِ ۴۳۸ بایت برای نوشتنِ کلِ عنصر.
    expect(Y.encodeStateAsUpdate(doc, before).byteLength).toBeLessThan(100);
  });
});

/**
 * ★★ نگهبانِ واگرایی — `BoardDocument` در برابرِ `CanvasDocument`.
 *
 * `ydoc-schema` حق ندارد `CanvasDocument` را import کند، پس شکلش را **تکرار**
 * کرده. یک تکرارِ بی‌نگهبان دیر یا زود واگرا می‌شود و آن‌وقت `replaceDocument`
 * فقط در زمانِ اجرا می‌شکند. اینجا تنها جایی است که هر دو دیده می‌شوند.
 */
describe("★ سازگاریِ `readDocument` با قراردادِ M1", () => {
  it("خروجی مستقیماً به `replaceDocument` داده می‌شود", () => {
    const doc = createBoardDoc();
    const sticky = createSticky({ ...seed, x: 10, y: 20, authorId: AUTHOR, text: "سلام" });
    for (const element of [sticky.container, sticky.text]) {
      writeElement(boardRoots(doc).elements, element);
    }

    // ★ ادعای اصلی زمانِ **کامپایل** است: اگر دو شکل واگرا شوند، `pnpm verify`
    //   روی همین خط می‌افتد، نه در مرورگر.
    const document: CanvasDocument = readDocument(doc);

    expect(document.elements).toHaveLength(2);
    for (const element of document.elements) {
      expect(() => hbElement.parse(element)).not.toThrow();
    }
    expect(document.assets).toEqual([]);
    expect(document.appState.viewBackgroundColor).toBe("#ffffff");
  });
});
