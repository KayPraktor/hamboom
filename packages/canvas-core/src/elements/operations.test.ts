import { describe, expect, it } from "vitest";

import { areAllLocked, deleteElements, toggleLock } from "./operations";
import { createShape } from "./shape";

let counter = 0;
function seed() {
  return {
    authorId: "u_1",
    now: 1_753_000_000_000,
    makeId: () => `op${++counter}`,
    random: () => 0.5,
  };
}

function shape(id: string, locked = false) {
  const s = createShape({ shape: "rectangle", x: 0, y: 0, ...seed() }).shape;
  return { ...s, id, locked };
}

describe("deleteElements", () => {
  it("★ فقط انتخاب‌شده‌ها حذفِ نرم می‌شوند", () => {
    const a = shape("A");
    const b = shape("B");
    const next = deleteElements([a, b], new Set(["A"]));
    expect(next.find((e) => e.id === "A")?.isDeleted).toBe(true);
    expect(next.find((e) => e.id === "B")?.isDeleted).toBe(false);
  });

  it("versionNonce بالا می‌رود (ثبتِ undo)", () => {
    const a = shape("A");
    const next = deleteElements([a], new Set(["A"]));
    expect(next[0]!.versionNonce).not.toBe(a.versionNonce);
  });

  it("بدون تغییر، همان آرایه", () => {
    const input = [shape("A")];
    expect(deleteElements(input, new Set())).toBe(input);
  });
});

describe("toggleLock — منبعِ واحد", () => {
  it("★ اگر همه باز باشند، همه قفل می‌شوند", () => {
    const els = [shape("A", false), shape("B", false)];
    const next = toggleLock(els, new Set(["A", "B"]));
    expect(next.every((e) => e.locked)).toBe(true);
  });

  it("★ اگر همه قفل باشند، همه باز می‌شوند", () => {
    const els = [shape("A", true), shape("B", true)];
    const next = toggleLock(els, new Set(["A", "B"]));
    expect(next.every((e) => e.locked)).toBe(false);
  });

  it("★ ترکیبِ باز و قفل → همه قفل (هر بازی، همه قفل)", () => {
    const els = [shape("A", true), shape("B", false)];
    const next = toggleLock(els, new Set(["A", "B"]));
    expect(next.every((e) => e.locked)).toBe(true);
  });

  it("عنصرِ بیرونِ انتخاب دست‌نخورده می‌ماند", () => {
    const els = [shape("A", false), shape("OUT", false)];
    const next = toggleLock(els, new Set(["A"]));
    expect(next.find((e) => e.id === "OUT")?.locked).toBe(false);
  });
});

describe("areAllLocked", () => {
  it("★ همه قفل → true؛ یکی باز → false", () => {
    expect(areAllLocked([shape("A", true), shape("B", true)], new Set(["A", "B"]))).toBe(true);
    expect(areAllLocked([shape("A", true), shape("B", false)], new Set(["A", "B"]))).toBe(false);
  });

  it("بدون انتخاب → false", () => {
    expect(areAllLocked([shape("A", true)], new Set())).toBe(false);
  });
});
