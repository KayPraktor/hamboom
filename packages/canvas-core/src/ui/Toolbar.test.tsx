import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Toolbar } from "./Toolbar";

describe("Toolbar", () => {
  it("★ ۱۲ دکمه رندر می‌کند", () => {
    render(<Toolbar activeTool="select" onSelectTool={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(12);
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

  it("★ پیش‌فرض افقی است (سازگار با گذشته): پایین-وسط، بدونِ کلاسِ عمودی", () => {
    const { container } = render(<Toolbar activeTool="select" onSelectTool={() => {}} />);
    const bar = container.querySelector(".hb-toolbar");
    expect(bar).toHaveClass("hb-overlay--bottom-center");
    expect(bar).not.toHaveClass("hb-toolbar--vertical");
    expect(bar).toHaveAttribute("aria-orientation", "horizontal");
  });

  it("★ orientation=vertical: لبه‌ی inline-start + ستونی + aria عمودی (گام ۹٫۱)", () => {
    const { container } = render(
      <Toolbar activeTool="select" onSelectTool={() => {}} orientation="vertical" />,
    );
    const bar = container.querySelector(".hb-toolbar");
    expect(bar).toHaveClass("hb-toolbar--vertical");
    expect(bar).toHaveClass("hb-overlay--center-start");
    expect(bar).not.toHaveClass("hb-overlay--bottom-center");
    expect(bar).toHaveAttribute("aria-orientation", "vertical");
  });

  it("★ دکمه‌ی stub (کامنت) «به‌زودی» است و کلیکش بی‌اثر", async () => {
    const onSelect = vi.fn();
    render(<Toolbar activeTool="select" onSelectTool={onSelect} />);
    const comment = screen.getByLabelText("کامنت");
    expect(comment).toHaveAttribute("title", "کامنت · به‌زودی");
    expect(comment).toHaveClass("is-coming-soon");
    expect(comment).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(comment);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
