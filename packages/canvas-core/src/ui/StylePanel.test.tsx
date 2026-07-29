import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createShape } from "../elements/shape";
import { StylePanel, type StylePanelProps } from "./StylePanel";

let counter = 0;
function shape(id: string, locked = false) {
  const s = createShape({
    shape: "rectangle",
    x: 0,
    y: 0,
    authorId: "u",
    makeId: () => `s${++counter}`,
    random: () => 0.5,
    now: 1_753_000_000_000,
  }).shape;
  return { ...s, id, locked };
}

const noop = () => {};

/** رندر با props پیش‌فرض تا هر تست فقط چیزی که مهمش است را بدهد. */
function renderPanel(
  over: Partial<StylePanelProps> & Pick<StylePanelProps, "elements" | "selectedIds">,
) {
  return render(
    <StylePanel
      onChange={noop}
      onToggleLock={noop}
      onReorder={noop}
      onAlign={noop}
      onDistribute={noop}
      {...over}
    />,
  );
}

describe("StylePanel — قفل/چیدمان/هم‌ترازی (گام ۴٫۳/۵٫۱)", () => {
  it("بدون انتخاب، چیزی رندر نمی‌کند", () => {
    const { container } = renderPanel({ elements: [], selectedIds: new Set() });
    expect(container.firstChild).toBeNull();
  });

  it("★ دکمه‌ی قفل، onToggleLock را صدا می‌زند", async () => {
    const onToggleLock = vi.fn();
    renderPanel({ elements: [shape("A", false)], selectedIds: new Set(["A"]), onToggleLock });
    await userEvent.click(screen.getByRole("button", { name: "قفل" }));
    expect(onToggleLock).toHaveBeenCalled();
  });

  it("★ وقتی همه قفل‌اند، برچسب «باز کردن قفل» می‌شود", () => {
    renderPanel({ elements: [shape("A", true)], selectedIds: new Set(["A"]) });
    expect(screen.getByRole("button", { name: "باز کردن قفل" })).toBeInTheDocument();
  });

  it("★ جلو/عقب فعال‌اند و onReorder را با جهتِ درست صدا می‌زنند (۵٫۱)", async () => {
    const onReorder = vi.fn();
    renderPanel({ elements: [shape("A")], selectedIds: new Set(["A"]), onReorder });
    const forward = screen.getByRole("button", { name: "جلو" });
    const backward = screen.getByRole("button", { name: "عقب" });
    expect(forward).toBeEnabled();
    expect(backward).toBeEnabled();
    await userEvent.click(forward);
    await userEvent.click(backward);
    expect(onReorder).toHaveBeenNthCalledWith(1, "forward");
    expect(onReorder).toHaveBeenNthCalledWith(2, "backward");
  });

  it("هم‌ترازی با انتخابِ تکی نمایش داده نمی‌شود", () => {
    renderPanel({ elements: [shape("A")], selectedIds: new Set(["A"]) });
    expect(screen.queryByRole("button", { name: "هم‌ترازی چپ" })).toBeNull();
  });

  it("★ با ۲+ انتخاب، دکمه‌های هم‌ترازی onAlign را با لبه‌ی درست صدا می‌زنند", async () => {
    const onAlign = vi.fn();
    renderPanel({
      elements: [shape("A"), shape("B")],
      selectedIds: new Set(["A", "B"]),
      onAlign,
    });
    await userEvent.click(screen.getByRole("button", { name: "هم‌ترازی چپ" }));
    await userEvent.click(screen.getByRole("button", { name: "هم‌ترازی وسطِ عمودی" }));
    expect(onAlign).toHaveBeenNthCalledWith(1, "left");
    expect(onAlign).toHaveBeenNthCalledWith(2, "vcenter");
    // توزیع با فقط ۲ عنصر نباید باشد
    expect(screen.queryByRole("button", { name: "توزیعِ افقی" })).toBeNull();
  });

  it("★ با ۳+ انتخاب، توزیع ظاهر می‌شود و onDistribute را صدا می‌زند", async () => {
    const onDistribute = vi.fn();
    renderPanel({
      elements: [shape("A"), shape("B"), shape("C")],
      selectedIds: new Set(["A", "B", "C"]),
      onDistribute,
    });
    await userEvent.click(screen.getByRole("button", { name: "توزیعِ عمودی" }));
    expect(onDistribute).toHaveBeenCalledWith("vertical");
  });
});
