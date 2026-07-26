import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusBar } from "./StatusBar";

describe("StatusBar", () => {
  it("★ اتصالِ برقرار با تعدادِ همتا (عددِ فارسی)", () => {
    render(
      <StatusBar
        connection={{ status: "connected", peers: 2 }}
        save={{ status: "saved", at: 0 }}
      />,
    );
    expect(screen.getByText("متصل — ۲ نفر آنلاین")).toBeInTheDocument();
    expect(screen.getByText("ذخیره شد")).toBeInTheDocument();
  });

  it("★ آفلاین با تغییرهای معلق", () => {
    render(
      <StatusBar
        connection={{ status: "offline", pendingChanges: 3 }}
        save={{ status: "unsaved", pendingChanges: 3 }}
      />,
    );
    expect(screen.getByText("آفلاین — ۳ تغییرِ معلق")).toBeInTheDocument();
    expect(screen.getByText("ذخیره‌نشده")).toBeInTheDocument();
  });

  it("در حال ذخیره", () => {
    render(<StatusBar connection={{ status: "connecting" }} save={{ status: "saving" }} />);
    expect(screen.getByText("در حال اتصال…")).toBeInTheDocument();
    expect(screen.getByText("در حال ذخیره…")).toBeInTheDocument();
  });

  it("خطای اتصال، پیامِ سرور را نشان می‌دهد", () => {
    render(
      <StatusBar
        connection={{ status: "error", code: "E1", message: "قطع شد" }}
        save={{ status: "saved", at: 0 }}
      />,
    );
    expect(screen.getByText("قطع شد")).toBeInTheDocument();
  });

  it("★ هیچ متنِ انگلیسی‌ای در خروجی نیست (به‌جز اعداد)", () => {
    const { container } = render(
      <StatusBar
        connection={{ status: "connected", peers: 5 }}
        save={{ status: "saved", at: 0 }}
      />,
    );
    // حروفِ لاتین نباید باشند (ارقام فارسی‌اند)
    expect(container.textContent ?? "").not.toMatch(/[A-Za-z]/);
  });
});
