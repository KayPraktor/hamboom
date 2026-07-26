import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Toolbar } from "./Toolbar";

describe("Toolbar", () => {
  it("★ ۱۱ دکمه رندر می‌کند", () => {
    render(<Toolbar activeTool="select" onSelectTool={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(11);
  });

  it("★ ابزارِ فعال aria-pressed دارد، بقیه نه", () => {
    render(<Toolbar activeTool="pen" onSelectTool={() => {}} />);
    const pen = screen.getByLabelText("قلم");
    expect(pen).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("استیکی")).toHaveAttribute("aria-pressed", "false");
  });

  it("★ کلیک روی دکمه، onSelectTool را با شناسه‌ی درست صدا می‌زند", async () => {
    const onSelect = vi.fn();
    render(<Toolbar activeTool="select" onSelectTool={onSelect} />);
    await userEvent.click(screen.getByLabelText("فریم"));
    expect(onSelect).toHaveBeenCalledWith("frame");
  });

  it("tooltip شاملِ برچسبِ فارسی و میانبر است", () => {
    render(<Toolbar activeTool="select" onSelectTool={() => {}} />);
    expect(screen.getByLabelText("استیکی")).toHaveAttribute("title", "استیکی · N");
  });
});
