import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import {
  TokenError,
  signAccessToken,
  signRtToken,
  verifyAccessToken,
  verifyRtToken,
} from "./tokens.ts";

const secret = new TextEncoder().encode("test-secret-at-least-32-bytes-long-aaaa");
const other = new TextEncoder().encode("OTHER-secret-at-least-32-bytes-long-bbbb");
const TTL = 60;
const NOW_MS = 1_700_000_000_000;
const nowSec = Math.floor(NOW_MS / 1000);
const clock = (): number => NOW_MS;

describe("rt-token — sign/verify", () => {
  it("رفت‌وبرگشت: claimها سالم برمی‌گردند", async () => {
    const t = await signRtToken(secret, { sub: "u1", boardId: "b1", role: "editor" }, TTL, clock);
    expect(await verifyRtToken(secret, t, "b1", TTL, clock)).toEqual({
      sub: "u1",
      boardId: "b1",
      role: "editor",
      exp: nowSec + TTL,
    });
  });

  // ★★ سه حمله‌ی کلاسیکِ JWT — همان‌ها که DevBoardAuthorityِ M2 داشت، این‌بار روی نسخه‌ی محصولی.
  it("★ حمله‌ی alg:none رد می‌شود", async () => {
    const h = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const p = Buffer.from(
      JSON.stringify({ sub: "u1", boardId: "b1", role: "owner", exp: nowSec + TTL }),
    ).toString("base64url");
    await expect(verifyRtToken(secret, `${h}.${p}.`, "b1", TTL, clock)).rejects.toBeInstanceOf(
      TokenError,
    );
  });

  it("★ امضای اشتباه (رازِ دیگر) رد می‌شود", async () => {
    const t = await signRtToken(other, { sub: "u1", boardId: "b1", role: "owner" }, TTL, clock);
    await expect(verifyRtToken(secret, t, "b1", TTL, clock)).rejects.toMatchObject({
      code: "signature",
    });
  });

  it("★ توکنِ منقضی رد می‌شود", async () => {
    const past = (): number => NOW_MS - 120_000; // ۱۲۰ ثانیه پیش امضا شد
    const t = await signRtToken(secret, { sub: "u1", boardId: "b1", role: "editor" }, TTL, past);
    await expect(verifyRtToken(secret, t, "b1", TTL, clock)).rejects.toMatchObject({
      code: "expired",
    });
  });

  it("★★ exp-in-ms رد می‌شود (سقفِ آینده — حفره‌ی probe ۱٫۳)", async () => {
    // یک توکنِ **درست‌امضا** ولی با exp به میلی‌ثانیه (عددِ بزرگ) — jose تنها این را نمی‌گیرد.
    const t = await new SignJWT({ boardId: "b1", role: "editor" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("u1")
      .setExpirationTime(nowSec * 1000)
      .sign(secret);
    await expect(verifyRtToken(secret, t, "b1", TTL, clock)).rejects.toMatchObject({
      code: "exp_too_far",
    });
  });

  it("توکنِ بوردِ دیگر رد می‌شود", async () => {
    const t = await signRtToken(secret, { sub: "u1", boardId: "b1", role: "owner" }, TTL, clock);
    await expect(verifyRtToken(secret, t, "b2", TTL, clock)).rejects.toMatchObject({
      code: "wrong_board",
    });
  });

  it("★ نقشِ ناشناخته → شکلِ نامعتبر، fail-closed", async () => {
    const t = await new SignJWT({ boardId: "b1", role: "superadmin" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("u1")
      .setExpirationTime(nowSec + TTL)
      .sign(secret);
    await expect(verifyRtToken(secret, t, "b1", TTL, clock)).rejects.toMatchObject({ code: "shape" });
  });
});

describe("access-token", () => {
  it("رفت‌وبرگشت", async () => {
    const t = await signAccessToken(secret, "u1", 900, clock);
    expect(await verifyAccessToken(secret, t, clock)).toEqual({ sub: "u1" });
  });

  it("امضای اشتباه رد می‌شود", async () => {
    const t = await signAccessToken(other, "u1", 900, clock);
    await expect(verifyAccessToken(secret, t, clock)).rejects.toBeInstanceOf(TokenError);
  });
});
