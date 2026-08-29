import {
  createAuthCoreBoardAuthority,
  TokenError,
  type BoardAccessReader,
} from "@hamboom/auth-core";

import { AUTH_ERROR_CODES, AuthError, type BoardAuthority } from "./board-authority.ts";

/**
 * آداپتورِ realtimeِ `AuthCoreBoardAuthority` (M3 فاز ۷ — جایگزینِ `DevBoardAuthority`).
 *
 * ★ **منطق در `auth-core` است؛ این‌جا فقط نگاشتِ خطا.** `createAuthCoreBoardAuthority` یک شیءِ **هم‌شکلِ**
 * `BoardAuthority` می‌سازد ولی `TokenError` (خطای auth-core) می‌اندازد، نه `AuthError` (کدِ پروتکلیِ realtime).
 * این تابع آن را می‌پیچد و `TokenError` → کدِ پروتکلی نگاشت می‌دهد — همان الگوی `StorageSnapshotStore`
 * ([ADR-031](../../../../ARCHITECTURE_DECISIONS.md#adr-031)). `BoardAccessReader`ِ pg مشترک است
 * ([ADR-046](../../../../ARCHITECTURE_DECISIONS.md#adr-046)).
 *
 * ⚠️ برخلافِ `DevBoardAuthority`، `developmentOnly=false` → با `APP_ENV=production` سرور **بالا می‌آید**
 * (گیتِ `assertAuthorityUsable`، ADR-031). این تفاوتِ اصلیِ فاز ۷ است.
 */
export interface RealtimeAuthorityConfig {
  /** رازِ HS256 (JWT_SECRET)؛ config می‌خواند، این‌جا param. */
  secret: Uint8Array;
  /** TTLِ rt-token (ثانیه) — سقفِ آینده ۲× همین است (قفلِ exp). */
  rtTokenTtlSeconds: number;
  /** ★ منبعِ واحدِ داده‌ی دسترسی (pg) — main.ts از `@hamboom/board-access-db` می‌سازد و تزریق می‌کند. */
  accessReader: BoardAccessReader;
  clock?: () => number;
}

export function createRealtimeAuthority(config: RealtimeAuthorityConfig): BoardAuthority {
  const core = createAuthCoreBoardAuthority(config);
  return {
    developmentOnly: false,

    async verify(token, boardId) {
      // ★ توکنِ غایب کدِ خودش را دارد (TOKEN_MISSING)، قبل از verify — مثلِ DevBoardAuthority.
      if (token.length === 0) {
        throw new AuthError(AUTH_ERROR_CODES.missing, "برای اتصال باید وارد شوید.");
      }
      try {
        return await core.verify(token, boardId);
      } catch (error) {
        if (error instanceof TokenError) throw mapTokenError(error);
        throw error;
      }
    },

    // نقشِ همین‌حالا via effectiveBoardRole + readerِ pg (هرگز undefined — auth-core همیشه نظر دارد).
    currentRole: (sub, boardId) => core.currentRole(sub, boardId),
  } satisfies BoardAuthority;
}

/**
 * `TokenError` → کدِ پروتکلی. `detail` (کدِ خام) فقط در لاگِ سرور، نه به کلاینت (PII نیست ولی علتِ دقیق
 * نباید لو رود). ★ **توکنِ معتبرِ بوردِ دیگر → FORBIDDEN**، نه چیزی که وجود/نبودِ بورد را لو دهد.
 */
function mapTokenError(error: TokenError): AuthError {
  if (error.code === "expired") {
    return new AuthError(AUTH_ERROR_CODES.expired, "نشست منقضی شده؛ صفحه را تازه کنید.", error.code);
  }
  if (error.code === "wrong_board") {
    return new AuthError(AUTH_ERROR_CODES.forbidden, "به این بورد دسترسی ندارید.", error.code);
  }
  // malformed | signature | shape | exp_too_far → نامعتبر
  return new AuthError(AUTH_ERROR_CODES.invalid, "نشست معتبر نیست.", error.code);
}
