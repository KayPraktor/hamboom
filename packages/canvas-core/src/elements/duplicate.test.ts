import type { HbElement } from "@hamboom/shared-types";
import { describe, expect, it } from "vitest";

import { duplicateElements } from "./duplicate";
import { createShape } from "./shape";
import { createSticky } from "./sticky";

let counter = 0;
function seed() {
  return {
    authorId: "u_1",
    now: 1_753_000_000_000,
    makeId: () => `dup${++counter}`,
    random: () => 0.5,
  };
}

describe("duplicateElements", () => {
  it("★ یک شکل را با id تازه و آفست کپی می‌کند", () => {
    const shape = createShape({ shape: "rectangle", x: 100, y: 50, ...seed() }).shape;
    const { elements, newIds } = duplicateElements([shape], new Set([shape.id]), {
      ...seed(),
      offset: 16,
    });
    expect(elements).toHaveLength(2);
    expect(newIds).toHaveLength(1);
    const clone = elements.find((e) => e.id === newIds[0])!;
    expect(clone.id).not.toBe(shape.id);
    expect([clone.x, clone.y]).toEqual([116, 66]);
    expect(clone.version).toBe(1);
  });

  it("★ استیکی (ظرف + متنِ مقید) کامل کپی و پیوندها دوباره‌نگاشت می‌شوند", () => {
    const {
      container,
      text,
      elements: pair,
    } = createSticky({ x: 0, y: 0, text: "سلام", ...seed() });
    const { elements, newIds } = duplicateElements(pair, new Set([container.id]), seed());

    // ۲ اصل + ۲ کلون
    expect(elements).toHaveLength(4);
    expect(newIds).toHaveLength(2);

    const clones = elements.filter((e) => newIds.includes(e.id));
    const cloneContainer = clones.find((e) => (e as { containerId?: string }).containerId == null)!;
    const cloneText = clones.find((e) => (e as { containerId?: string }).containerId != null)!;

    // پیوندِ ظرف→متن به id های تازه اشاره می‌کند، نه اصل
    const boundId = (cloneContainer as { boundElements?: { id: string }[] }).boundElements?.[0]?.id;
    expect(boundId).toBe(cloneText.id);
    expect((cloneText as { containerId: string }).containerId).toBe(cloneContainer.id);
    // و به id اصل اشاره نمی‌کند
    expect(boundId).not.toBe(text.id);
  });

  it("انتخابِ خالی، همان آرایه را برمی‌گرداند", () => {
    const shape = createShape({ shape: "ellipse", x: 0, y: 0, ...seed() }).shape;
    const input = [shape];
    const { elements, newIds } = duplicateElements(input, new Set(), seed());
    expect(elements).toBe(input);
    expect(newIds).toEqual([]);
  });

  it("عنصرِ حذف‌شده کپی نمی‌شود", () => {
    const shape = {
      ...createShape({ shape: "rectangle", x: 0, y: 0, ...seed() }).shape,
      isDeleted: true,
    } as HbElement;
    const { newIds } = duplicateElements([shape], new Set([shape.id]), seed());
    expect(newIds).toEqual([]);
  });
});
