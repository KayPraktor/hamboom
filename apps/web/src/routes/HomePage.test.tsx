import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HomePage } from "./HomePage.tsx";

/**
 * دودِ اسکلت — ثابت می‌کند React 19 + testing-library + jsdom + setup همه سرِ هم‌اند.
 * تست‌های واقعیِ رفتار با آمدنِ احراز/داشبورد (۸٫۲+) اضافه می‌شوند.
 */
describe("HomePage", () => {
  it("عنوانِ هم‌بوم را نشان می‌دهد", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { name: "هم‌بوم" })).toBeInTheDocument();
  });
});
