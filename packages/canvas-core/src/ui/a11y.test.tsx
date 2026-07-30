import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createShape } from "../elements/shape";
import type { PeerState } from "../sync/contract";
import { ContextMenu } from "./ContextMenu";
import { PeerAvatars } from "./PeerAvatars";
import { StylePanel } from "./StylePanel";
import { Toolbar } from "./Toolbar";
import { ZoomControl } from "./ZoomControl";

/**
 * دسترس‌پذیری — گام ۵٫۴: **هر دکمه‌ی رابط باید نامِ در دسترس داشته باشد** (فارسی).
 * نام از `aria-label` یا متنِ دیدنیِ دکمه می‌آید؛ دکمه‌های آیکونی که هیچ‌کدام را
 * ندارند اینجا قرمز می‌شوند. این تست هم ممیزی است هم نگهبانِ رگرسیون.
 */

const noop = () => {};

function accessibleName(btn: HTMLButtonElement): string {
  return (btn.getAttribute("aria-label") ?? btn.textContent ?? "").trim();
}

function unnamedButtons(container: HTMLElement): string[] {
  const buttons = [...container.querySelectorAll("button")] as HTMLButtonElement[];
  expect(buttons.length).toBeGreaterThan(0);
  return buttons.filter((b) => accessibleName(b) === "").map((b) => b.className || "(بی‌کلاس)");
}

let n = 0;
function shape(id: string) {
  const s = createShape({
    shape: "rectangle",
    x: 0,
    y: 0,
    authorId: "u",
    makeId: () => `a${++n}`,
    random: () => 0.5,
    now: 0,
  }).shape;
  return { ...s, id };
}

function peer(): PeerState {
  return {
    clientId: 1,
    user: { id: "u1", displayName: "کاوه", color: "#5B8DEF", avatarUrl: null },
    pointer: null,
    selectedIds: [],
    viewport: null,
    activeTool: null,
  };
}

describe("a11y — نامِ در دسترسِ همه‌ی دکمه‌ها (گام ۵٫۴)", () => {
  it("Toolbar", () => {
    const { container } = render(<Toolbar activeTool="select" onSelectTool={noop} />);
    expect(unnamedButtons(container)).toEqual([]);
  });

  it("StylePanel (۳ انتخاب — شاملِ هم‌ترازی/توزیع)", () => {
    const { container } = render(
      <StylePanel
        elements={[shape("A"), shape("B"), shape("C")]}
        selectedIds={new Set(["A", "B", "C"])}
        onChange={noop}
        onToggleLock={noop}
        onReorder={noop}
        onAlign={noop}
        onDistribute={noop}
      />,
    );
    expect(unnamedButtons(container)).toEqual([]);
  });

  it("ZoomControl", () => {
    const { container } = render(
      <ZoomControl zoom={1} onZoomIn={noop} onZoomOut={noop} onFit={noop} />,
    );
    expect(unnamedButtons(container)).toEqual([]);
  });

  it("ContextMenu", () => {
    const { container } = render(
      <ContextMenu x={0} y={0} hasSelection onAction={noop} onDismiss={noop} />,
    );
    expect(unnamedButtons(container)).toEqual([]);
  });

  it("PeerAvatars", () => {
    const { container } = render(<PeerAvatars peers={[peer()]} onFollow={noop} />);
    expect(unnamedButtons(container)).toEqual([]);
  });
});
