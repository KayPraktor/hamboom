import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ZoomControl } from "./ZoomControl";

describe("ZoomControl", () => {
  it("★ درصد را با ارقامِ فارسی نشان می‌دهد", () => {
    render(<ZoomControl zoom={1.5} onZoomIn={() => {}} onZoomOut={() => {}} onFit={() => {}} />);
    expect(screen.getByText("۱۵۰٪")).toBeInTheDocument();
  });

  it("★ دکمه‌ها callbackِ درست را صدا می‌زنند", async () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onFit = vi.fn();
    render(<ZoomControl zoom={1} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onFit={onFit} />);

    await userEvent.click(screen.getByRole("button", { name: "بزرگ‌نمایی" }));
    expect(onZoomIn).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "کوچک‌نمایی" }));
    expect(onZoomOut).toHaveBeenCalled();
    // کلیک روی درصد = برازش با صفحه
    await userEvent.click(screen.getByText("۱۰۰٪"));
    expect(onFit).toHaveBeenCalled();
  });
});
