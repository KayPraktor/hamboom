import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createShape } from "../elements/shape";
import { StylePanel } from "./StylePanel";

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

describe("StylePanel — قفل/چیدمان (گام ۴٫۳)", () => {
  it("بدون انتخاب، چیزی رندر نمی‌کند", () => {
    const { container } = render(
      <StylePanel
        elements={[]}
        selectedIds={new Set()}
        onChange={() => {}}
        onToggleLock={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("★ دکمه‌ی قفل، onToggleLock را صدا می‌زند", async () => {
    const onToggleLock = vi.fn();
    render(
      <StylePanel
        elements={[shape("A", false)]}
        selectedIds={new Set(["A"])}
        onChange={() => {}}
        onToggleLock={onToggleLock}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "قفل" }));
    expect(onToggleLock).toHaveBeenCalled();
  });

  it("★ وقتی همه قفل‌اند، برچسب «باز کردن قفل» می‌شود", () => {
    render(
      <StylePanel
        elements={[shape("A", true)]}
        selectedIds={new Set(["A"])}
        onChange={() => {}}
        onToggleLock={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "باز کردن قفل" })).toBeInTheDocument();
  });

  it("★ لایه (جلو/عقب) coming-soon و غیرفعال است (۵٫۱)", () => {
    render(
      <StylePanel
        elements={[shape("A")]}
        selectedIds={new Set(["A"])}
        onChange={() => {}}
        onToggleLock={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "جلو" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "عقب" })).toBeDisabled();
  });
});
