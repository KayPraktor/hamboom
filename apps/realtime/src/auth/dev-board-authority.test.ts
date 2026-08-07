import { describe, expect, it } from "vitest";

import { AuthError, type RtTokenClaims } from "./board-authority.ts";
import { createDevBoardAuthority, signDevToken } from "./dev-board-authority.ts";

/**
 * تست‌های `DevBoardAuthority` — گام ۴٫۱.
 *
 * ★ بیشترِ این‌ها **ضدِ ادعا** اند: اعتبارسنجیِ JWTِ دست‌نویس جای اشتباهِ کلاسیک
 * دارد، پس هر سدّی که در کد گذاشته شده اینجا با یک حمله‌ی واقعی آزموده می‌شود،
 * نه با خواندنِ کد.
 */

const SECRET = "a".repeat(32);
const BOARD = "brd_1";
const FUTURE = Math.floor(Date.now() / 1000) + 3600;

function claims(overrides: Partial<RtTokenClaims> = {}): RtTokenClaims {
  return { sub: "usr_9f3c1a", boardId: BOARD, role: "editor", exp: FUTURE, ...overrides };
}

const authority = createDevBoardAuthority({ secret: SECRET });

/** کدِ خطای یک `verify`ِ شکست‌خورده — یا شکست دادنِ تست اگر اصلاً رد نشد. */
async function codeOf(token: string, board = BOARD): Promise<string> {
  try {
    await authority.verify(token, board);
  } catch (error) {
    expect(error).toBeInstanceOf(AuthError);
    return (error as AuthError).code;
  }
  throw new Error("انتظار می‌رفت رد شود، ولی پذیرفته شد");
}

describe("توکنِ معتبر", () => {
  it("claimها را برمی‌گرداند", async () => {
    const token = signDevToken(claims(), SECRET);
    await expect(authority.verify(token, BOARD)).resolves.toEqual(claims());
  });

  it("★ علامتِ «فقط توسعه» را دارد — گیتِ بوت روی همین می‌نشیند", () => {
    expect(authority.developmentOnly).toBe(true);
  });

  it("سازنده با کلیدِ کوتاه بالا نمی‌آید", () => {
    expect(() => createDevBoardAuthority({ secret: "کوتاه" })).toThrow(/۳۲ کاراکتر/);
  });
});

describe("★★ سه وضعیتِ ردشدن — سه کدِ **متفاوت**", () => {
  it("توکنِ غایب → `TOKEN_MISSING`", async () => {
    await expect(codeOf("")).resolves.toBe("TOKEN_MISSING");
  });

  it("توکنِ منقضی → `TOKEN_EXPIRED`", async () => {
    const expired = signDevToken(claims({ exp: Math.floor(Date.now() / 1000) - 1 }), SECRET);
    await expect(codeOf(expired)).resolves.toBe("TOKEN_EXPIRED");
  });

  it("توکنِ دست‌کاری‌شده → `TOKEN_INVALID`", async () => {
    // payload عوض می‌شود (ارتقای نقش) ولی امضا همان می‌مانَد — کلاسیک‌ترین حمله.
    const token = signDevToken(claims({ role: "viewer" }), SECRET);
    const [header, , signature] = token.split(".") as [string, string, string];
    const forged = Buffer.from(JSON.stringify(claims({ role: "owner" }))).toString("base64url");

    await expect(codeOf(`${header}.${forged}.${signature}`)).resolves.toBe("TOKEN_INVALID");
  });
});

describe("★★ حمله‌های شناخته‌شده‌ی JWT", () => {
  it("`alg: none` پذیرفته نمی‌شود", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify(claims({ role: "owner" }))).toString("base64url");

    // هم بدونِ امضا، هم با امضای خالی — هیچ‌کدام نباید رد شود.
    await expect(codeOf(`${header}.${payload}.`)).resolves.toBe("TOKEN_INVALID");
    await expect(codeOf(`${header}.${payload}.AAAA`)).resolves.toBe("TOKEN_INVALID");
  });

  it("★ امضا با کلیدِ دیگر رد می‌شود", async () => {
    const other = signDevToken(claims(), "b".repeat(32));
    await expect(codeOf(other)).resolves.toBe("TOKEN_INVALID");
  });

  it("★ توکنِ بدونِ `exp` رد می‌شود — «بدونِ انقضا» یعنی برای همیشه معتبر", async () => {
    const { exp: _exp, ...withoutExp } = claims();
    const token = signDevToken(withoutExp as RtTokenClaims, SECRET);
    await expect(codeOf(token)).resolves.toBe("TOKEN_INVALID");
  });

  it("نقشِ ناشناخته رد می‌شود، نه اینکه به viewer تنزل کند", async () => {
    // ⚠️ تنزلِ خاموش قاعده‌ی **خواندنِ پیام** است (گام ۲٫۴)، نه احراز هویت:
    // آنجا کلاینتِ قدیمی را نمی‌شکنیم، اینجا یک توکنِ مخدوش را نمی‌پذیریم.
    const token = signDevToken(claims({ role: "superuser" as never }), SECRET);
    await expect(codeOf(token)).resolves.toBe("TOKEN_INVALID");
  });

  it("توکنِ بی‌شکل رد می‌شود و سرور را نمی‌اندازد", async () => {
    for (const junk of ["abc", "a.b", "....", "a.b.c.d", "!!!.???.***"]) {
      await expect(codeOf(junk)).resolves.toBe("TOKEN_INVALID");
    }
  });
});

describe("★ توکنِ معتبرِ بوردِ دیگر", () => {
  it("`FORBIDDEN` می‌گیرد — نه کدی که وجودِ آن بورد را لو بدهد", async () => {
    const token = signDevToken(claims({ boardId: "brd_secret" }), SECRET);
    await expect(codeOf(token, BOARD)).resolves.toBe("FORBIDDEN");
  });
});

describe("ساعتِ تزریق‌پذیر", () => {
  it("انقضا با ساعتِ داده‌شده سنجیده می‌شود، نه با زمانِ واقعی", async () => {
    const exp = 2_000_000_000;
    const token = signDevToken(claims({ exp }), SECRET);

    const before = createDevBoardAuthority({ secret: SECRET, now: () => (exp - 10) * 1000 });
    await expect(before.verify(token, BOARD)).resolves.toMatchObject({ exp });

    const after = createDevBoardAuthority({ secret: SECRET, now: () => (exp + 10) * 1000 });
    await expect(after.verify(token, BOARD)).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });
  });
});
