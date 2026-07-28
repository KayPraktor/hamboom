import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PeerState } from "../sync/contract";
import { PeerCursors } from "./PeerCursors";

function peer(overrides: Partial<PeerState> = {}): PeerState {
  return {
    clientId: 1,
    user: { id: "u1", displayName: "نیلوفر", color: "#5B8DEF", avatarUrl: null },
    pointer: { x: 100, y: 50, visible: true },
    selectedIds: [],
    viewport: null,
    activeTool: null,
    ...overrides,
  };
}

const identity = (x: number, y: number) => ({ x, y });

describe("PeerCursors", () => {
  it("★ مکان‌نمای همتای مرئی را با نام و رنگش رندر می‌کند", () => {
    const { container, getByText } = render(<PeerCursors peers={[peer()]} project={identity} />);
    expect(getByText("نیلوفر")).toBeInTheDocument();
    const cursor = container.querySelector(".hb-peer-cursor") as HTMLElement;
    expect(cursor.style.transform).toBe("translate(100px, 50px)");
    expect(container.querySelector("path")?.getAttribute("fill")).toBe("#5B8DEF");
  });

  it("★ مکان‌نمای نامرئی یا null رندر نمی‌شود", () => {
    const { container } = render(
      <PeerCursors
        peers={[
          peer({ clientId: 2, pointer: { x: 0, y: 0, visible: false } }),
          peer({ clientId: 3, pointer: null }),
        ]}
        project={identity}
      />,
    );
    expect(container.querySelectorAll(".hb-peer-cursor")).toHaveLength(0);
  });

  it("project برای نگاشتِ صحنه→پیکسل استفاده می‌شود", () => {
    const { container } = render(
      <PeerCursors peers={[peer()]} project={(x, y) => ({ x: x + 10, y: y - 5 })} />,
    );
    const cursor = container.querySelector(".hb-peer-cursor") as HTMLElement;
    expect(cursor.style.transform).toBe("translate(110px, 45px)");
  });
});
