import { describe, expect, it } from "vitest";

import { alignElements, distributeElements } from "./align";
import { createShape } from "./shape";

let counter = 0;
function at(id: string, x: number, y: number, w: number, h: number) {
  const s = createShape({
    shape: "rectangle",
    x,
    y,
    width: w,
    height: h,
    authorId: "u",
    makeId: () => `a${++counter}`,
    random: () => 0.5,
    now: 1_753_000_000_000,
  }).shape;
  return { ...s, id };
}

const ids = new Set(["A", "B", "C"]);
const xOf = (els: { id: string; x: number }[]) => Object.fromEntries(els.map((e) => [e.id, e.x]));
const yOf = (els: { id: string; y: number }[]) => Object.fromEntries(els.map((e) => [e.id, e.y]));

describe("alignElements — مختصاتِ بوم، بدونِ آینه", () => {
  // A(x0,w10) B(x50,w20) C(x100,w10) → minX0, maxX110, cx55
  const row = () => [at("A", 0, 0, 10, 10), at("B", 50, 0, 20, 10), at("C", 100, 0, 10, 10)];

  it("★ چپ: همه به کمینه‌ی x", () => {
    expect(xOf(alignElements(row(), ids, "left"))).toEqual({ A: 0, B: 0, C: 0 });
  });

  it("★ راست: لبه‌ی راستِ همه روی بیشینه (x = maxX − width)", () => {
    expect(xOf(alignElements(row(), ids, "right"))).toEqual({ A: 100, B: 90, C: 100 });
  });

  it("★ وسطِ افقی: مرکزِ همه روی cx=۵۵", () => {
    expect(xOf(alignElements(row(), ids, "hcenter"))).toEqual({ A: 50, B: 45, C: 50 });
  });

  it("★ بالا: همه به کمینه‌ی y", () => {
    const col = [at("A", 0, 0, 10, 10), at("B", 0, 30, 10, 10), at("C", 0, 5, 10, 20)];
    expect(yOf(alignElements(col, ids, "top"))).toEqual({ A: 0, B: 0, C: 0 });
  });

  it("★ «چپ» با RTL آینه نمی‌شود — همان کمینه‌ی x می‌ماند", () => {
    // فارغ از هر جهتِ سند، left = min x. اینجا فقط تاکیدِ صریحِ P6.
    const out = alignElements(row(), ids, "left");
    expect(Math.min(...out.filter((e) => ids.has(e.id)).map((e) => e.x))).toBe(0);
    expect(Math.max(...out.filter((e) => ids.has(e.id)).map((e) => e.x))).toBe(0);
  });

  it("کمتر از ۲ عنصر → همان آرایه", () => {
    const els = row();
    expect(alignElements(els, new Set(["A"]), "left")).toBe(els);
  });

  it("متنِ مقید با ظرفش حرکت می‌کند", () => {
    const a = { ...at("A", 100, 0, 10, 10), boundElements: [{ id: "T", type: "text" as const }] };
    const t = at("T", 100, 2, 8, 6);
    const b = at("B", 0, 0, 10, 10);
    // align left → A از ۱۰۰ به ۰ (dx=-100)؛ T هم باید ۱۰۰→۰ برود
    const out = alignElements([a, t, b], new Set(["A", "B"]), "left");
    expect(out.find((e) => e.id === "T")!.x).toBe(0);
  });

  it("عنصرِ جابه‌جاشده bumpVersion می‌گیرد، ثابت‌مانده نه", () => {
    const els = row();
    const out = alignElements(els, ids, "left");
    const byId = new Map(out.map((e) => [e.id, e]));
    expect(byId.get("A")!.versionNonce).toBe(els[0]!.versionNonce); // A ثابت (x=0)
    expect(byId.get("B")!.versionNonce).not.toBe(els[1]!.versionNonce); // B جابه‌جا شد
  });
});

describe("distributeElements — فاصله‌ی یکنواختِ لبه‌به‌لبه", () => {
  it("★ افقی: میانی جابه‌جا می‌شود تا gapها برابر شوند", () => {
    // A(x0,w10) B(x20,w10) C(x100,w10): span110، totalSize30، gap=40 → A0,B50,C100
    const els = [at("A", 0, 0, 10, 10), at("B", 20, 0, 10, 10), at("C", 100, 0, 10, 10)];
    expect(xOf(distributeElements(els, ids, "horizontal"))).toEqual({ A: 0, B: 50, C: 100 });
  });

  it("قبلاً یکنواخت → همان آرایه (بدون تغییر)", () => {
    const els = [at("A", 0, 0, 10, 10), at("B", 50, 0, 10, 10), at("C", 100, 0, 10, 10)];
    expect(distributeElements(els, ids, "horizontal")).toBe(els);
  });

  it("کمتر از ۳ عنصر → همان آرایه", () => {
    const els = [at("A", 0, 0, 10, 10), at("B", 50, 0, 10, 10)];
    expect(distributeElements(els, new Set(["A", "B"]), "horizontal")).toBe(els);
  });

  it("عمودی: بر اساس y و ارتفاع", () => {
    // A(y0,h10) B(y5,h10) C(y100,h10): span110، total30، gap40 → A0,B50,C100
    const els = [at("A", 0, 0, 10, 10), at("B", 0, 5, 10, 10), at("C", 0, 100, 10, 10)];
    expect(yOf(distributeElements(els, ids, "vertical"))).toEqual({ A: 0, B: 50, C: 100 });
  });
});
