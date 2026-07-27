import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ContextMenu } from "./ContextMenu";

describe("ContextMenu", () => {
  it("★ آیتم‌های کاری با انتخاب فعال‌اند؛ coming-soon غیرفعال", () => {
    render(<ContextMenu x={10} y={10} hasSelection onAction={() => {}} onDismiss={() => {}} />);
    expect(screen.getByRole("menuitem", { name: /حذف/ })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: /تکثیر/ })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: /کپی به‌عنوان تصویر/ })).toBeDisabled();
  });

  it("★ بدونِ انتخاب، آیتم‌های نیازمندِ انتخاب غیرفعال‌اند", () => {
    render(
      <ContextMenu x={0} y={0} hasSelection={false} onAction={() => {}} onDismiss={() => {}} />,
    );
    expect(screen.getByRole("menuitem", { name: /حذف/ })).toBeDisabled();
  });

  it("★ کلیک روی آیتمِ فعال، onAction و onDismiss را صدا می‌زند", async () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    render(<ContextMenu x={0} y={0} hasSelection onAction={onAction} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("menuitem", { name: /حذف/ }));
    expect(onAction).toHaveBeenCalledWith("delete");
    expect(onDismiss).toHaveBeenCalled();
  });

  it("★ Escape منو را می‌بندد", async () => {
    const onDismiss = vi.fn();
    render(<ContextMenu x={0} y={0} hasSelection onAction={() => {}} onDismiss={onDismiss} />);
    await userEvent.keyboard("{Escape}");
    expect(onDismiss).toHaveBeenCalled();
  });

  it("متنِ coming-soon «به‌زودی» را نشان می‌دهد", () => {
    render(<ContextMenu x={0} y={0} hasSelection onAction={() => {}} onDismiss={() => {}} />);
    expect(screen.getByRole("menuitem", { name: /کپی به‌عنوان تصویر/ })).toHaveTextContent(
      "به‌زودی",
    );
  });
});
