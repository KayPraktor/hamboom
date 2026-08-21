import type { BoardRole, RtTokenClaims } from "@hamboom/shared-types";
import { rtTokenClaims } from "@hamboom/shared-types";
import { SignJWT, errors, jwtVerify } from "jose";

/**
 * امضا و اعتبارسنجیِ JWT — [ADR-011](../../../ARCHITECTURE_DECISIONS.md#adr-011).
 *
 * ★★ **قفلِ حفره‌ی `exp` (probe ۱٫۳):** سه سدِ مستقل، هر سه لازم:
 *   ۱. `algorithms: ["HS256"]`ِ صریح در `jwtVerify` → `alg:none` و سردرگمیِ الگوریتم رد می‌شوند.
 *   ۲. **یک** signer که `exp` را **خودش از ثانیه** حساب می‌کند → صادرکننده نمی‌تواند ms بدهد.
 *   ۳. **سقفِ آینده** روی rt-token → `exp - now > 2×TTL` رد؛ چون توکنِ ۶۰ثانیه‌ای با `exp`ِ سال‌ها
 *      دورتر یا ms است یا حمله. probe نشان داد `jose` **تنها** این را نمی‌گیرد (سالِ ~۵۸۶۰۷).
 *
 * راز HS256 است (زیرساختِ مورداعتماد؛ realtime و api هر دو مورداعتمادند — یک نودِ realtimeِ
 * لو رفته از قبل می‌تواند مجوزِ خودش را دور بزند، پس نامتقارن سطحِ حمله‌ی تازه‌ای اضافه نمی‌کند).
 * راز **param** است، نه از `process.env` — config می‌خواندش (PLAN §۴).
 */

export type TokenErrorCode =
  | "malformed"
  | "signature"
  | "expired"
  | "shape"
  | "exp_too_far"
  | "wrong_board";

/** خطای توکن — کدِ نمادین دارد، ولی پیامش علتِ دقیق را به کلاینت **لو نمی‌دهد**. */
export class TokenError extends Error {
  constructor(
    readonly code: TokenErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TokenError";
  }
}

const ALG = "HS256";
const nowSeconds = (clock?: () => number): number => Math.floor((clock?.() ?? Date.now()) / 1000);

/**
 * ★★ **تنها جای امضای rt-token.** `exp` را خودش از `ttlSeconds` حساب می‌کند (ثانیه)، پس صادرکننده
 * نمی‌تواند واحد را اشتباه بدهد. `clock` تزریق‌پذیر تا تست قطعی بماند.
 */
export function signRtToken(
  secret: Uint8Array,
  claims: { sub: string; boardId: string; role: BoardRole },
  ttlSeconds: number,
  clock?: () => number,
): Promise<string> {
  const exp = nowSeconds(clock) + ttlSeconds;
  return new SignJWT({ boardId: claims.boardId, role: claims.role })
    .setProtectedHeader({ alg: ALG })
    .setSubject(claims.sub)
    .setExpirationTime(exp)
    .sign(secret);
}

/**
 * اعتبارسنجیِ rt-token — امضا/الگوریتم + انقضا (jose) + **سقفِ آینده** + تطبیقِ **شکل**
 * (schemaِ shared-types، fail-closed) + تطبیقِ `boardId`.
 */
export async function verifyRtToken(
  secret: Uint8Array,
  token: string,
  expectedBoardId: string,
  ttlSeconds: number,
  clock?: () => number,
): Promise<RtTokenClaims> {
  let payload: Record<string, unknown>;
  try {
    // ★ `currentDate` از همان `clock` — تا سنجشِ انقضای jose با سقفِ آینده هم‌ساعت باشد (و تست قطعی).
    ({ payload } = await jwtVerify(token, secret, {
      algorithms: [ALG],
      currentDate: new Date(nowSeconds(clock) * 1000),
    }));
  } catch (e) {
    if (e instanceof errors.JWTExpired) throw new TokenError("expired", "توکن منقضی شده است");
    if (e instanceof errors.JWSSignatureVerificationFailed) {
      throw new TokenError("signature", "امضای توکن نامعتبر است");
    }
    if (e instanceof errors.JOSEAlgNotAllowed) {
      throw new TokenError("signature", "الگوریتمِ توکن مجاز نیست");
    }
    throw new TokenError("malformed", "توکن قابلِ خواندن نیست");
  }

  // ★ شکل را با همان schemaِ سیم می‌سنجیم — واگراییِ شکل (نقشِ ناشناخته، فیلدِ غایب) fail-closed.
  const parsed = rtTokenClaims.safeParse({
    sub: payload.sub,
    boardId: payload.boardId,
    role: payload.role,
    exp: payload.exp,
  });
  if (!parsed.success) throw new TokenError("shape", "شکلِ claimهای توکن نامعتبر است");
  const claims = parsed.data;

  // ★★ سقفِ آینده — سدِ سومِ حفره‌ی exp.
  if (claims.exp - nowSeconds(clock) > 2 * ttlSeconds) {
    throw new TokenError("exp_too_far", "exp بیش از حد در آینده است (احتمالِ ms یا حمله)");
  }

  // ★ توکنِ معتبرِ **بوردِ دیگر** اینجا کار نمی‌کند.
  if (claims.boardId !== expectedBoardId) {
    throw new TokenError("wrong_board", "توکن برای این بورد نیست");
  }

  return claims;
}

/**
 * accessِ کوتاه‌عمرِ API (JWT، ۱۵دقیقه — [ADR-011](../../../ARCHITECTURE_DECISIONS.md#adr-011)).
 * فقط هویت (`sub`) را حمل می‌کند؛ نقش **محاسبه‌شده** است، نه در توکن (ADR-012). امضا از همین
 * signerِ واحد می‌آید، پس `exp` باز هم از ثانیه است.
 */
export function signAccessToken(
  secret: Uint8Array,
  sub: string,
  ttlSeconds: number,
  clock?: () => number,
): Promise<string> {
  const exp = nowSeconds(clock) + ttlSeconds;
  return new SignJWT({})
    .setProtectedHeader({ alg: ALG })
    .setSubject(sub)
    .setExpirationTime(exp)
    .sign(secret);
}

/** اعتبارسنجیِ access — الگوریتمِ صریح + انقضا + حضورِ `sub`. */
export async function verifyAccessToken(
  secret: Uint8Array,
  token: string,
  clock?: () => number,
): Promise<{ sub: string }> {
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, secret, {
      algorithms: [ALG],
      currentDate: new Date(nowSeconds(clock) * 1000),
    }));
  } catch (e) {
    if (e instanceof errors.JWTExpired) throw new TokenError("expired", "توکن منقضی شده است");
    throw new TokenError("signature", "توکنِ access نامعتبر است");
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new TokenError("shape", "sub در توکن نیست");
  }
  return { sub: payload.sub };
}
