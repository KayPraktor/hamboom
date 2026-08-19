import { describe, expect, it } from "vitest";

import {
  apiError,
  assignableBoardRoles,
  board,
  boardAccessModes,
  boardMember,
  boardRoles,
  boardSummary,
  rtTokenClaims,
  team,
  teamMember,
  user,
  userPublic,
} from "./index.ts";

const ID = "018f7c4e-9c1a-7c2b-8e3d-1a2b3c4d5e6f";
const DATE = "2026-08-15T09:30:00.000Z";
const PUBLIC = { id: ID, displayName: "رضا", avatarUrl: null, color: "#4c8bf5" };

describe("قراردادِ DTO — معتبر می‌گذرد، نامعتبر رد می‌شود", () => {
  it("user: کاربرِ فقط-موبایل معتبر است (email nullable)", () => {
    const u = {
      id: ID,
      phone: "+989121234567",
      phoneVerified: true,
      email: null,
      emailVerified: false,
      displayName: "رضا",
      avatarUrl: null,
      locale: "fa",
      createdAt: DATE,
      lastSeenAt: null,
    };
    expect(user.parse(u)).toEqual(u);
    // id باید UUID باشد
    expect(user.safeParse({ ...u, id: "not-a-uuid" }).success).toBe(false);
  });

  it("userPublic و teamMember و team", () => {
    expect(userPublic.parse(PUBLIC)).toEqual(PUBLIC);
    const m = { user: PUBLIC, role: "admin", joinedAt: DATE, invitedBy: null };
    expect(teamMember.parse(m)).toEqual(m);
    const t = { id: ID, slug: "acme", name: "آکمه", avatarUrl: null, myRole: "owner", memberCount: 3, createdAt: DATE };
    expect(team.parse(t)).toEqual(t);
    // نقشِ تیمیِ نامعتبر رد می‌شود
    expect(teamMember.safeParse({ ...m, role: "editor" }).success).toBe(false);
  });

  it("board کامل می‌گذرد، boardSummary زیرمجموعه است، boardMember نقشِ کامل می‌گیرد", () => {
    const b = {
      id: ID,
      teamId: ID,
      folderId: null,
      title: "بوردِ نمونه",
      thumbnailUrl: null,
      accessMode: "team",
      linkToken: null,
      myRole: "editor",
      createdBy: PUBLIC,
      elementCount: 3,
      docSizeBytes: 1024,
      lastActivityAt: DATE,
      createdAt: DATE,
      updatedAt: DATE,
      isFavorite: false,
      templateId: null,
    };
    expect(board.parse(b)).toEqual(b);
    // boardSummary فقط کلیدهای خلاصه را نگه می‌دارد
    expect(boardSummary.parse(b)).toEqual({
      id: ID,
      title: "بوردِ نمونه",
      thumbnailUrl: null,
      lastActivityAt: DATE,
      myRole: "editor",
      isFavorite: false,
      folderId: null,
    });
    // خواندنی می‌تواند commenter باشد (بازتابِ داده‌ی ذخیره‌شده)
    expect(boardMember.safeParse({ user: PUBLIC, role: "commenter", addedBy: null, addedAt: DATE }).success).toBe(true);
    // accessModeِ نامعتبر رد می‌شود
    expect(board.safeParse({ ...b, accessMode: "link_comment" }).success).toBe(false);
  });

  it("apiError: قالب و کدِ نامعتبر", () => {
    const e = { error: { code: "BOARD_NOT_FOUND", message: "بورد پیدا نشد.", requestId: "01J" } };
    expect(apiError.parse(e)).toEqual(e);
    expect(apiError.safeParse({ error: { code: "NOPE", message: "x", requestId: "y" } }).success).toBe(false);
  });
});

describe("قیدهای مرزیِ نقش — گام ۲٫۲", () => {
  it("boardRoles ترتیبِ سیمِ M2 را دقیقاً نگه می‌دارد (owner,editor,commenter,viewer)", () => {
    expect(boardRoles).toEqual(["owner", "editor", "commenter", "viewer"]);
  });

  it("assignableBoardRoles شاملِ commenter نیست و زیرمجموعه‌ی boardRoles است (واگرایی ناممکن)", () => {
    expect(assignableBoardRoles).toEqual(["owner", "editor", "viewer"]);
    expect(assignableBoardRoles as readonly string[]).not.toContain("commenter");
    // ناوردا: هر نقشِ قابلِ‌تخصیص حتماً یک boardRole است (تایپش با satisfies قفل است؛ این هم runtime)
    expect(assignableBoardRoles.every((r) => (boardRoles as readonly string[]).includes(r))).toBe(true);
  });

  it("boardAccessModes شاملِ link_comment نیست (تا فاز ۱۰)", () => {
    expect(boardAccessModes as readonly string[]).not.toContain("link_comment");
  });
});

describe("rtTokenClaims — قراردادِ توکنِ WS (ADR-042، گام ۲٫۳)", () => {
  const ok = { sub: "user-1", boardId: "board-1", role: "editor", exp: 1_760_000_060 };

  it("claimِ معتبر round-trip می‌شود (sub/boardId رشته‌اند، نه لزوماً uuid)", () => {
    expect(rtTokenClaims.parse(ok)).toEqual(ok);
  });

  it("نقشِ نامعتبر، sub خالی، و exp غیرعددی رد می‌شوند", () => {
    expect(rtTokenClaims.safeParse({ ...ok, role: "boss" }).success).toBe(false);
    expect(rtTokenClaims.safeParse({ ...ok, sub: "" }).success).toBe(false);
    expect(rtTokenClaims.safeParse({ ...ok, exp: "soon" }).success).toBe(false);
  });
});
