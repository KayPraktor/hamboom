import { describe, expect, it } from "vitest";

import type { HbElement } from "@hamboom/shared-types";

import {
  areAllLocked,
  cycleSelection,
  deleteElements,
  reorderElements,
  toggleLock,
} from "./operations";
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

describe("reorderElements — z-order (منبعِ واحد)", () => {
  const ids = (els: { id: string }[]) => els.map((e) => e.id).join("");

  it("★ front: انتخاب به انتهای آرایه (رو) می‌رود", () => {
    const els = [shape("A"), shape("B"), shape("C")];
    expect(ids(reorderElements(els, new Set(["A"]), "front"))).toBe("BCA");
  });

  it("★ back: انتخاب به ابتدای آرایه (ته) می‌رود", () => {
    const els = [shape("A"), shape("B"), shape("C")];
    expect(ids(reorderElements(els, new Set(["C"]), "back"))).toBe("CAB");
  });

  it("★ forward: یک پله به سمتِ رو", () => {
    const els = [shape("A"), shape("B"), shape("C")];
    expect(ids(reorderElements(els, new Set(["A"]), "forward"))).toBe("BAC");
  });

  it("★ backward: یک پله به سمتِ ته", () => {
    const els = [shape("A"), shape("B"), shape("C")];
    expect(ids(reorderElements(els, new Set(["C"]), "backward"))).toBe("ACB");
  });

  it("★ forwardِ چندتاییِ ناپیوسته — هر کدام یک پله، بدون به‌هم‌ریختنِ ترتیبِ داخلی", () => {
    const els = [shape("A"), shape("B"), shape("C"), shape("D")];
    // A(sel) و C(sel) هر کدام یک پله به جلو از همسایه‌ی نامنتخبشان
    expect(ids(reorderElements(els, new Set(["A", "C"]), "forward"))).toBe("BADC");
  });

  it("★ front ترتیبِ نسبیِ خودِ انتخاب را حفظ می‌کند", () => {
    const els = [shape("A"), shape("B"), shape("C"), shape("D")];
    expect(ids(reorderElements(els, new Set(["A", "C"]), "front"))).toBe("BDAC");
  });

  it("index دست نمی‌خورد — بازتولیدش با موتور است (ADR-007)", () => {
    const els = [shape("A"), shape("B"), shape("C")];
    const before = new Map(els.map((e) => [e.id, e.index]));
    for (const e of reorderElements(els, new Set(["A"]), "front")) {
      expect(e.index).toBe(before.get(e.id));
    }
  });

  it("فقط عناصرِ جابه‌جاشده bumpVersion می‌گیرند", () => {
    const els = [shape("A"), shape("B"), shape("C")];
    const next = reorderElements(els, new Set(["A"]), "front"); // → B C A
    const byId = new Map(next.map((e) => [e.id, e]));
    // A جابه‌جا شد (۰→۲)، B و C هم شیفت خوردند (۱→۰، ۲→۱) → همه version می‌گیرند
    expect(byId.get("A")!.versionNonce).not.toBe(els[0]!.versionNonce);
    expect(byId.get("B")!.versionNonce).not.toBe(els[1]!.versionNonce);
  });

  it("عنصرِ خارجِ انتخاب که موقعیتش عوض نشده، همان شیء می‌ماند", () => {
    // back روی C: [A,B,C] → [C,A,B]. عنصری که سرِ جایش می‌ماند نیست، ولی
    // forward روی C که آخر است → بدون تغییر، همان آرایه.
    const els = [shape("A"), shape("B"), shape("C")];
    expect(reorderElements(els, new Set(["C"]), "forward")).toBe(els);
  });

  it("بدون انتخاب → همان آرایه", () => {
    const els = [shape("A"), shape("B")];
    expect(reorderElements(els, new Set(), "front")).toBe(els);
  });

  it("انتخابِ حذف‌شده نادیده گرفته می‌شود → همان آرایه", () => {
    const c = { ...shape("C"), isDeleted: true };
    const els = [shape("A"), shape("B"), c];
    expect(reorderElements(els, new Set(["C"]), "front")).toBe(els);
  });
});

describe("cycleSelection — پیمایشِ کیبوردی (ترتیبِ خواندنِ RTL)", () => {
  const at = (id: string, x: number, y: number, extra: Record<string, unknown> = {}): HbElement => {
    const s = createShape({ shape: "rectangle", x, y, ...seed() }).shape;
    return { ...s, id, ...extra } as unknown as HbElement;
  };
  // ترتیبِ خواندن: y صعودی، سپس x نزولی → A(x100,y0), B(x0,y0), C(x50,y100)
  const els = () => [at("A", 100, 0), at("B", 0, 0), at("C", 50, 100)];

  it("★ بدون انتخاب، next اولین (به ترتیبِ خواندن) را می‌دهد", () => {
    expect(cycleSelection(els(), new Set(), "next")).toBe("A");
  });

  it("★ next بعدی را می‌دهد و از آخر wrap می‌کند", () => {
    expect(cycleSelection(els(), new Set(["A"]), "next")).toBe("B");
    expect(cycleSelection(els(), new Set(["B"]), "next")).toBe("C");
    expect(cycleSelection(els(), new Set(["C"]), "next")).toBe("A");
  });

  it("★ previous قبلی را می‌دهد و wrap می‌کند", () => {
    expect(cycleSelection(els(), new Set(["A"]), "previous")).toBe("C");
    expect(cycleSelection(els(), new Set(), "previous")).toBe("C");
  });

  it("متنِ مقید، حذف‌شده و قفل رد می‌شوند", () => {
    const withExtras = [
      at("A", 100, 0),
      at("TXT", 90, 0, { containerId: "A" }),
      at("DEL", 50, 0, { isDeleted: true }),
      at("LOCK", 20, 0, { locked: true }),
      at("B", 0, 0),
    ];
    expect(cycleSelection(withExtras, new Set(["A"]), "next")).toBe("B");
    expect(cycleSelection(withExtras, new Set(["B"]), "next")).toBe("A");
  });

  it("خالی → null", () => {
    expect(cycleSelection([], new Set(), "next")).toBeNull();
  });
});
