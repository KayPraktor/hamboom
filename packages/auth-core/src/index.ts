/**
 * `@hamboom/auth-core` — منطقِ احراز هویت و نقش (M3 فاز ۴).
 *
 * ★ **منطقِ خالص + پورت است، نه اپ.** JWT (`jose`)، `effectiveBoardRole` (ADR-012)، و
 * `AuthCoreBoardAuthority` اینجا؛ **پیاده‌سازیِ DBِ پورت‌ها (`BoardAccessReader`، …) در `apps/api`
 * فاز ۵** است. `@aws-sdk`/`pg`/`ioredis` را نمی‌بیند (گیتِ `authCoreBoundaries`).
 */
export {
  TokenError,
  signRtToken,
  verifyRtToken,
  signAccessToken,
  verifyAccessToken,
} from "./tokens.ts";
export type { TokenErrorCode } from "./tokens.ts";

export { effectiveBoardRole } from "./roles.ts";
export type { BoardAccessInput } from "./roles.ts";

export { createAuthCoreBoardAuthority } from "./board-authority.ts";
export type { BoardAccessReader, AuthCoreBoardAuthorityConfig } from "./board-authority.ts";
