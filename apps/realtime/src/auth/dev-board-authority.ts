import { createHmac, timingSafeEqual } from "node:crypto";

import {
  AUTH_ERROR_CODES,
  AuthError,
  isBoardRole,
  type BoardAuthority,
  type RtTokenClaims,
} from "./board-authority.ts";

/**
 * پیاده‌سازیِ **توسعه‌ای** پورتِ احراز هویت — JWTِ HS256 با `RT_DEV_JWT_SECRET`.
 *
 * ★★ **این هرگز نباید در production زنده شود** — گیتش `assertAuthorityUsable`
 * است و علامتش `developmentOnly` ([ADR-031](../../../../ARCHITECTURE_DECISIONS.md#adr-031)).
 *
 * ── چرا JWT را دستی می‌سنجیم و کتابخانه نمی‌آوریم ─────────────────────
 *
 * وسوسه‌اش `jose` بود. سه دلیل که نه:
 *
 * ۱. این کد **قرار است حذف شود**. وقتی M3 `auth-core` را ساخت، این فایل می‌رود.
 *    وابستگیِ runtime برای چیزی که عمرش تا M3 است، بدهیِ بی‌دلیل است (P1 هم هر
 *    پکیجِ تازه را از گیتِ لایسنس رد می‌کند).
 * ۲. `node:crypto` دقیقاً همین را دارد: HMAC-SHA256 و مقایسه‌ی زمان‌ثابت.
 * ۳. سطحِ حمله‌اش **صفر** است در production، چون آنجا اصلاً بالا نمی‌آید.
 *
 * ⚠️ **هزینه‌ی پذیرفته‌شده:** اعتبارسنجیِ JWT دست‌نویس جای اشتباهِ کلاسیک دارد. سه
 * تای مهم اینجا صریح بسته شده‌اند و هر سه تست دارند:
 *
 * - **سردرگمیِ `alg`:** فقط `HS256` پذیرفته می‌شود. `alg: "none"` و هر چیز دیگر
 *   رد می‌شود — بدونِ این، یک توکنِ بدونِ امضا معتبر شمرده می‌شد.
 * - **مقایسه‌ی زمان‌ثابت:** `timingSafeEqual` نه `===`.
 * - **`exp` اجباری است.** توکنِ بدونِ انقضا **رد** می‌شود، نه اینکه «برای همیشه
 *   معتبر» فرض شود.
 */

const ALGORITHM = "HS256";

/** بخشِ base64url → بافر. برمی‌گرداند `null` اگر خوانا نباشد. */
function decodeSegment(segment: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) return null;
  try {
    return Buffer.from(segment, "base64url");
  } catch {
    return null;
  }
}

function sign(input: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(input).digest();
}

export interface DevBoardAuthorityOptions {
  secret: string;
  /** ساعت — تزریق‌پذیر تا تستِ انقضا به زمانِ واقعی گره نخورد. */
  now?: () => number;
}

/**
 * ساختِ توکنِ توسعه‌ای.
 *
 * ⚠️ عمداً کنارِ خودِ verifier است و صادر می‌شود: در **توسعه** هر دو سرِ قرارداد
 * مالِ ماست، و تستی که توکنش را با یک نسخه‌ی دومِ signer بسازد، عملاً signer را
 * می‌آزماید نه verifier را. در production این تابع اصلاً وجود ندارد چون کلِ فایل
 * حذف می‌شود.
 */
export function signDevToken(claims: RtTokenClaims, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: ALGORITHM, typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const body = `${header}.${payload}`;
  return `${body}.${sign(body, secret).toString("base64url")}`;
}

export function createDevBoardAuthority({
  secret,
  now = Date.now,
}: DevBoardAuthorityOptions): BoardAuthority {
  if (secret.length < 32) {
    // همان قاعده‌ی `devAuthEnvSchema`، اینجا هم — چون این سازنده ممکن است از
    // مسیرِ دیگری (تست، اسکریپت) هم صدا زده شود.
    throw new Error("‏[hamboom] RT_DEV_JWT_SECRET باید حداقل ۳۲ کاراکتر باشد.");
  }

  return {
    developmentOnly: true,

    // ⚠️ `async` است تا **هر** شکستی یک rejection باشد، نه گاهی throwِ همزمان:
    //    صداکننده‌ای که `.catch()` می‌زند نباید بعضی خطاها را از دست بدهد. (اینجا
    //    `await`ی نیست چون این پیاده‌سازی I/O ندارد؛ نسخه‌ی واقعیِ M3 خواهد داشت.)
    async verify(token, boardId) {
      if (!token) {
        throw new AuthError(AUTH_ERROR_CODES.missing, "برای اتصال باید وارد شوید.");
      }

      const parts = token.split(".");
      if (parts.length !== 3) {
        throw new AuthError(AUTH_ERROR_CODES.invalid, "نشست معتبر نیست.", "شکلِ توکن سه‌بخشی نیست");
      }
      const [headerSegment, payloadSegment, signatureSegment] = parts as [string, string, string];

      // ── امضا ─────────────────────────────────────────────────────
      const provided = decodeSegment(signatureSegment);
      const expected = sign(`${headerSegment}.${payloadSegment}`, secret);
      // ⚠️ `timingSafeEqual` روی طولِ نابرابر **خطا می‌دهد**، پس طول جدا بررسی
      //    می‌شود — وگرنه یک توکنِ کوتاه به‌جای «نامعتبر»، سرور را می‌انداخت.
      if (
        !provided ||
        provided.length !== expected.length ||
        !timingSafeEqual(provided, expected)
      ) {
        throw new AuthError(AUTH_ERROR_CODES.invalid, "نشست معتبر نیست.", "امضا نخواند");
      }

      // ── header ───────────────────────────────────────────────────
      //
      // ★ **بعد** از بررسیِ امضا خوانده می‌شود، ولی خودش هم باید بررسی شود:
      //   امضا روی هدر هم هست، پس مهاجم نمی‌تواند `alg` را عوض کند بدونِ اینکه
      //   امضا بشکند — مگر اینکه ما `alg` را **باور کنیم** و مثلاً `none` را
      //   بپذیریم. همین‌جا بسته می‌شود.
      const header = safeJson(headerSegment);
      if (!header || (header as { alg?: unknown }).alg !== ALGORITHM) {
        throw new AuthError(
          AUTH_ERROR_CODES.invalid,
          "نشست معتبر نیست.",
          "الگوریتمِ پشتیبانی‌نشده",
        );
      }

      // ── claimها ──────────────────────────────────────────────────
      const payload = safeJson(payloadSegment);
      if (!payload) {
        throw new AuthError(AUTH_ERROR_CODES.invalid, "نشست معتبر نیست.", "payload خوانا نیست");
      }
      const claims = payload as Partial<RtTokenClaims>;

      if (
        typeof claims.sub !== "string" ||
        claims.sub.length === 0 ||
        typeof claims.boardId !== "string" ||
        !isBoardRole(claims.role) ||
        typeof claims.exp !== "number" ||
        !Number.isFinite(claims.exp)
      ) {
        throw new AuthError(AUTH_ERROR_CODES.invalid, "نشست معتبر نیست.", "claimهای ناقص");
      }

      // ⚠️ `exp` ثانیه است، `now()` میلی‌ثانیه — تبدیل صریح، وگرنه هر توکنی
      //    برای ~۵۰ سال معتبر می‌شد.
      if (claims.exp * 1000 <= now()) {
        throw new AuthError(AUTH_ERROR_CODES.expired, "نشست منقضی شده؛ صفحه را تازه کنید.");
      }

      // ★ توکنِ معتبر برای بوردِ **دیگر** → `FORBIDDEN`، نه کدی که وجود یا
      //   نبودِ آن بورد را لو بدهد.
      if (claims.boardId !== boardId) {
        throw new AuthError(
          AUTH_ERROR_CODES.forbidden,
          "به این بورد دسترسی ندارید.",
          "boardIdِ توکن با مسیر نمی‌خواند",
        );
      }

      return {
        sub: claims.sub,
        boardId: claims.boardId,
        role: claims.role,
        exp: claims.exp,
      };
    },
  };
}

function safeJson(segment: string): unknown {
  const raw = decodeSegment(segment);
  if (!raw) return null;
  try {
    return JSON.parse(raw.toString("utf8")) as unknown;
  } catch {
    return null;
  }
}
