import { describe, expect, it } from "vitest";

import { pasteElements, textToStickies } from "./clipboard";
import { createShape } from "./shape";
import { createSticky } from "./sticky";

let n = 0;
const seed = () => ({
  authorId: "u",
  makeId: () => `c${++n}`,
  random: () => 0.5,
  now: 1_753_000_000_000,
});

function shape(id: string, x = 0, y = 0) {
  const s = createShape({ shape: "rectangle", x, y, width: 10, height: 10, ...seed() }).shape;
  return { ...s, id };
}

describe("pasteElements — روی cloneElements (منبعِ واحد)", () => {
  it("★ عناصرِ کلیپ‌بورد را با id تازه و آفست به صحنه اضافه می‌کند", () => {
    const current = [shape("EXIST")];
    const clip = [shape("A", 100, 200)];
    const { elements, newIds } = pasteElements(current, clip, {
      makeId: () => "x",
      random: () => 0.5,
    });
    expect(elements).toHaveLength(2); // موجود + یک کلون
    expect(newIds).toHaveLength(1);
    const clone = elements.find((e) => e.id === newIds[0])!;
    expect(clone.id).not.toBe("A");
    expect(clone.x).toBe(116); // 100 + آفستِ ۱۶
    expect(clone.y).toBe(216);
  });

  it("کلیپ‌بوردِ خالی → همان آرایه", () => {
    const current = [shape("A")];
    expect(pasteElements(current, []).elements).toBe(current);
  });

  it("پیوندِ متنِ مقید در کلون سالم می‌ماند", () => {
    const pair = createSticky({ x: 0, y: 0, text: "س", ...seed() });
    const clip = pair.elements; // ظرف + متنِ مقید
    const { elements } = pasteElements([], clip, { makeId: () => `n${++n}`, random: () => 0.5 });
    const container = elements.find((e) => e.boundElements?.length)!;
    const boundId = container.boundElements![0]!.id;
    const boundEl = elements.find((e) => e.id === boundId);
    expect(boundEl).toBeDefined(); // متنِ مقید به id تازه اشاره می‌کند و وجود دارد
    expect(boundEl!.id).not.toBe(pair.text.id); // id تازه است
  });
});

describe("textToStickies — پیستِ متن → استیکی (رفتار میرو)", () => {
  it("★ یک خط → یک استیکی (ظرف + متنِ مقید)", () => {
    const { elements, ids } = textToStickies("سلام دنیا", {
      authorId: "u",
      x: 0,
      y: 0,
      makeId: () => `t${++n}`,
      random: () => 0.5,
      now: 0,
    });
    expect(ids).toHaveLength(1);
    expect(elements).toHaveLength(2);
  });

  it("★ چند خط → چند استیکیِ کنارِ هم (RTL → به چپ، گامِ ۲۴۴)", () => {
    const { ids, elements } = textToStickies("اول\nدوم\nسوم", {
      authorId: "u",
      x: 500,
      y: 100,
      makeId: () => `t${++n}`,
      random: () => 0.5,
      now: 0,
    });
    expect(ids).toHaveLength(3);
    const cont = ids.map((id) => elements.find((e) => e.id === id)!);
    expect(cont[0]!.x).toBe(500);
    expect(cont[1]!.x).toBe(500 - 244); // width 220 + gap 24
    expect(cont[2]!.x).toBe(500 - 488);
    expect(cont.every((c) => c.y === 100)).toBe(true); // همان ردیف
  });

  it("متنِ خالی/فقط‌فاصله → هیچ استیکی", () => {
    expect(textToStickies("   \n  \n", { authorId: "u", x: 0, y: 0 }).ids).toHaveLength(0);
  });
});
