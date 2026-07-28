import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PeerState } from "../sync/contract";
import { PeerAvatars } from "./PeerAvatars";

function peer(clientId: number, displayName: string, color = "#5B8DEF"): PeerState {
  return {
    clientId,
    user: { id: `u${clientId}`, displayName, color, avatarUrl: null },
    pointer: null,
    selectedIds: [],
    viewport: null,
    activeTool: null,
  };
}

describe("PeerAvatars", () => {
  it("★ برای هر همتا یک آواتار با حرفِ اولِ نام", () => {
    render(<PeerAvatars peers={[peer(1, "نیلوفر"), peer(2, "کاوه")]} onFollow={() => {}} />);
    expect(screen.getByRole("button", { name: "دنبال‌کردنِ نیلوفر" })).toHaveTextContent("ن");
    expect(screen.getByRole("button", { name: "دنبال‌کردنِ کاوه" })).toHaveTextContent("ک");
  });

  it("★ کلیک، onFollow را با clientId صدا می‌زند", async () => {
    const onFollow = vi.fn();
    render(<PeerAvatars peers={[peer(7, "سارا")]} onFollow={onFollow} />);
    await userEvent.click(screen.getByRole("button", { name: "دنبال‌کردنِ سارا" }));
    expect(onFollow).toHaveBeenCalledWith(7);
  });

  it("بدون همتا، چیزی رندر نمی‌کند", () => {
    const { container } = render(<PeerAvatars peers={[]} onFollow={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
