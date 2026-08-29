import { signRtToken, type BoardAccessReader } from "@hamboom/auth-core";
import { describe, expect, it } from "vitest";

import { createRealtimeAuthority } from "./auth-core-authority.ts";
import { AUTH_ERROR_CODES, AuthError } from "./board-authority.ts";

const SECRET = new TextEncoder().encode("realtime_test_secret_at_least_32_chars!");
const TTL = 60;

/** readerِ دروغینِ حافظه‌ای — main.ts نسخه‌ی pgِ مشترک را تزریق می‌کند. */
const OWNER_READER: BoardAccessReader = {
  read: () =>
    Promise.resolve({
      isStaff: false,
      isBoardOwner: true,
      accessMode: "private",
      directRole: null,
      teamRole: null,
      hasValidLink: false,
    }),
};

const authority = (reader: BoardAccessReader = OWNER_READER) =>
  createRealtimeAuthority({ secret: SECRET, rtTokenTtlSeconds: TTL, accessReader: reader });

describe("createRealtimeAuthority — نگاشتِ TokenError → کدِ پروتکلی", () => {
  it("توکنِ معتبر → claims", async () => {
    const token = await signRtToken(SECRET, { sub: "u1", boardId: "b1", role: "editor" }, TTL);
    await expect(authority().verify(token, "b1")).resolves.toMatchObject({
      sub: "u1",
      boardId: "b1",
      role: "editor",
    });
  });

  it("توکنِ غایب → TOKEN_MISSING (قبل از verify)", async () => {
    await expect(authority().verify("", "b1")).rejects.toMatchObject({
      code: AUTH_ERROR_CODES.missing,
    });
  });

  it("توکنِ بدشکل → TOKEN_INVALID", async () => {
    const p = authority().verify("not.a.jwt", "b1");
    await expect(p).rejects.toBeInstanceOf(AuthError);
    await expect(p).rejects.toMatchObject({ code: AUTH_ERROR_CODES.invalid });
  });

  it("★ توکنِ معتبرِ بوردِ دیگر → FORBIDDEN، نه INVALID (لو ندادنِ وجودِ بورد)", async () => {
    const token = await signRtToken(SECRET, { sub: "u1", boardId: "board-A", role: "editor" }, TTL);
    await expect(authority().verify(token, "board-B")).rejects.toMatchObject({
      code: AUTH_ERROR_CODES.forbidden,
    });
  });

  it("توکنِ منقضی → TOKEN_EXPIRED", async () => {
    // exp را با ساعتِ قدیمی می‌سازیم؛ verify با ساعتِ واقعی منقضی می‌بیند.
    const token = await signRtToken(SECRET, { sub: "u1", boardId: "b1", role: "editor" }, TTL, () => 1_000_000);
    await expect(authority().verify(token, "b1")).rejects.toMatchObject({
      code: AUTH_ERROR_CODES.expired,
    });
  });

  it("★ developmentOnly=false → برخلافِ Dev، production بالا می‌آید", () => {
    expect(authority().developmentOnly).toBe(false);
  });

  it("currentRole از reader می‌آید (owner)، و null وقتی بورد نیست", async () => {
    await expect(authority().currentRole?.("u1", "b1")).resolves.toBe("owner");
    const gone = authority({ read: () => Promise.resolve(null) });
    await expect(gone.currentRole?.("u1", "b1")).resolves.toBeNull();
  });
});
