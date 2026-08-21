import { describe, expect, it } from "vitest";

import { effectiveBoardRole, type BoardAccessInput } from "./roles.ts";

function input(over: Partial<BoardAccessInput> = {}): BoardAccessInput {
  return {
    isStaff: false,
    isBoardOwner: false,
    accessMode: "team",
    directRole: null,
    teamRole: null,
    hasValidLink: false,
    ...over,
  };
}

describe("effectiveBoardRole", () => {
  it("staff → owner (مستقل از access_mode)", () => {
    expect(effectiveBoardRole(input({ isStaff: true, accessMode: "private" }))).toBe("owner");
  });

  it("مالکِ بورد → owner (مستقل از access_mode)", () => {
    expect(effectiveBoardRole(input({ isBoardOwner: true, accessMode: "private" }))).toBe("owner");
  });

  it("نقشِ مستقیمِ board_members → همان نقش (مستقل از access_mode)", () => {
    expect(effectiveBoardRole(input({ directRole: "commenter", accessMode: "private" }))).toBe(
      "commenter",
    );
  });

  describe("★ مسیرِ تیم — فقط access_mode='team' (OD-1)", () => {
    it.each([
      ["owner", "editor"],
      ["admin", "editor"],
      ["member", "editor"],
      ["guest", "viewer"],
    ] as const)("team %s → board %s", (tr, br) => {
      expect(effectiveBoardRole(input({ accessMode: "team", teamRole: tr }))).toBe(br);
    });

    it("★★ بوردِ private عضویتِ تیم را نادیده می‌گیرد → null", () => {
      expect(effectiveBoardRole(input({ accessMode: "private", teamRole: "member" }))).toBeNull();
    });

    it("★ در حالتِ لینک هم مسیرِ تیم خاموش است → null", () => {
      expect(effectiveBoardRole(input({ accessMode: "link_edit", teamRole: "member" }))).toBeNull();
    });
  });

  describe("★ مسیرِ لینک — فقط link_view/link_edit + توکنِ معتبر", () => {
    it("link_view + توکن → viewer", () => {
      expect(effectiveBoardRole(input({ accessMode: "link_view", hasValidLink: true }))).toBe(
        "viewer",
      );
    });

    it("link_edit + توکن → editor", () => {
      expect(effectiveBoardRole(input({ accessMode: "link_edit", hasValidLink: true }))).toBe(
        "editor",
      );
    });

    it("لینکِ بی‌توکن → null", () => {
      expect(effectiveBoardRole(input({ accessMode: "link_view", hasValidLink: false }))).toBeNull();
    });

    it("★ توکنِ لینک در حالتِ team اثری ندارد → null", () => {
      expect(effectiveBoardRole(input({ accessMode: "team", hasValidLink: true }))).toBeNull();
    });
  });

  it("★ بیشترین برنده: directRole=viewer + team member (editor) → editor", () => {
    expect(effectiveBoardRole(input({ accessMode: "team", directRole: "viewer", teamRole: "member" }))).toBe(
      "editor",
    );
  });

  it("★ بیشترین برنده: staff + هر چیزِ کم‌تر → owner", () => {
    expect(
      effectiveBoardRole(input({ isStaff: true, directRole: "viewer", teamRole: "guest" })),
    ).toBe("owner");
  });

  it("★★ fail-closed: هیچ منبعی → null", () => {
    // بوردِ team ولی کاربر عضوِ تیم نیست، نقشِ مستقیم ندارد، لینک ندارد.
    expect(effectiveBoardRole(input())).toBeNull();
  });
});
