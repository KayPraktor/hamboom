import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createShape } from "../elements/shape";
import type { PeerState } from "../sync/contract";
import { PeerSelections } from "./PeerSelections";

function shapeAt(id: string, x: number, y: number, w: number, h: number) {
  const s = createShape({
    shape: "rectangle",
    x,
    y,
    width: w,
    height: h,
    authorId: "u",
    makeId: () => "m",
    random: () => 0.5,
    now: 0,
  }).shape;
  return { ...s, id };
}

function peer(clientId: number, selectedIds: string[], color = "#D14343"): PeerState {
  return {
    clientId,
    user: { id: `u${clientId}`, displayName: "کاوه", color, avatarUrl: null },
    pointer: null,
    selectedIds,
    viewport: null,
    activeTool: null,
  };
}

const identity = (x: number, y: number) => ({ x, y });

describe("PeerSelections", () => {
  it("★ دورِ عنصرِ انتخاب‌شده‌ی همتا، قابِ رنگیِ او را می‌کشد", () => {
    const el = shapeAt("A", 10, 20, 40, 30);
    const { container } = render(
      <PeerSelections peers={[peer(1, ["A"])]} elements={[el]} project={identity} />,
    );
    const halo = container.querySelector(".hb-peer-halo") as HTMLElement;
    expect(halo.style.transform).toBe("translate(10px, 20px)");
    expect(halo.style.inlineSize).toBe("40px");
    expect(halo.style.blockSize).toBe("30px");
    expect(halo.style.borderColor).toBe("rgb(209, 67, 67)"); // #D14343
  });

  it("★ id ای که در صحنه‌ی محلی نیست، هاله نمی‌سازد", () => {
    const { container } = render(
      <PeerSelections peers={[peer(1, ["ghost"])]} elements={[]} project={identity} />,
    );
    expect(container.querySelectorAll(".hb-peer-halo")).toHaveLength(0);
  });

  it("عنصرِ حذف‌شده هاله ندارد", () => {
    const el = { ...shapeAt("A", 0, 0, 10, 10), isDeleted: true };
    const { container } = render(
      <PeerSelections peers={[peer(1, ["A"])]} elements={[el]} project={identity} />,
    );
    expect(container.querySelectorAll(".hb-peer-halo")).toHaveLength(0);
  });
});
