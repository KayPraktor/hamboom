import { BOARD_ROLES, HB_ERROR_CODES, type BoardRole } from "@hamboom/ydoc-schema";

import { RtProtocolError } from "../protocol-error.ts";

/**
 * پورتِ احراز هویتِ بورد — [ADR-031](../../../../ARCHITECTURE_DECISIONS.md#adr-031)،
 * تصمیمِ **D-2**.
 *
 * ── چرا پورت، و چرا claimها **اینجا** ────────────────────────────────
 *
 * صادرکننده‌ی واقعیِ `rtToken` سرویسِ احراز هویتِ M3 است که هنوز وجود ندارد
 * (`packages/auth-core`). دو راه بود: صبر تا M3، یا تعریفِ همین شکل در
 * `shared-types` تا بعداً مشترک شود.
 *
 * ★ **هیچ‌کدام.** قیدِ صریحِ D-2: شکلِ claimها **داخلِ همین پورت** می‌مانَد تا M2
 * بدونِ یک خط تغییر در `shared-types` تمام شود. وقتی M3 `auth-core` را ساخت،
 * آن‌وقت **با تاییدِ مالک** تصمیم گرفته می‌شود که این تایپ بیرون برود یا نه —
 * الان بردنش یعنی قفل‌کردنِ قراردادی که هنوز مصرف‌کننده‌ی دومی ندارد.
 *
 * ⚠️ `BoardRole` عمداً از [`ydoc-schema`](../../../../packages/ydoc-schema/src/protocol.ts)
 * می‌آید و اینجا **تکرار نمی‌شود**: همان نقشی که روی سیم می‌رود باید همان نقشی
 * باشد که توکن حمل می‌کند. دو تعریف یعنی دو چیزی که واگرا می‌شوند (ADR-024).
 */

/**
 * claimهایی که سرور از `rtToken` بیرون می‌کشد.
 *
 * ⚠️ `exp` **ثانیه** است نه میلی‌ثانیه — قراردادِ JWT (RFC 7519). این تنها جای
 * پروژه است که زمان بر حسبِ ثانیه است، پس تبدیل باید صریح باشد.
 */
export interface RtTokenClaims {
  /** شناسه‌ی کاربر. ⚠️ **PII است** — خام لاگ نشود (P7، `maskSubject`). */
  sub: string;
  boardId: string;
  role: BoardRole;
  /** انقضا، **ثانیه**ی یونیکس. */
  exp: number;
}

/**
 * خطای احراز هویت — همیشه با یک کدِ **پروتکلی**، نه یک رشته‌ی آزاد.
 *
 * ★ پیامش به کلاینت می‌رود، پس نباید چیزی درباره‌ی **علتِ دقیق** لو بدهد
 * (کدام claim خراب بود، بورد وجود دارد یا نه). جزئیات فقط در لاگِ سرور.
 */
export class AuthError extends RtProtocolError {
  constructor(code: RtProtocolError["code"], message: string, detail?: string) {
    super(code, message, detail);
    this.name = "AuthError";
  }
}

/**
 * پورت — تنها چیزی که سرور از احراز هویت می‌شناسد.
 *
 * پیاده‌سازیِ واقعیِ M3 همین را برمی‌دارد و به `auth-core` وصل می‌شود؛ سرور عوض
 * نمی‌شود.
 */
export interface BoardAuthority {
  /**
   * ★ **علامتِ «فقط توسعه»** — گیتِ بوت روی همین می‌نشیند، نه روی یک پرچمِ config.
   *
   * دلیلش ساختاری است: اگر گیت به `APP_ENV` **و** یک `if` در جای درست وابسته
   * بود، اولین مسیرِ فراموش‌شده دورش می‌زد. با علامت روی **خودِ پیاده‌سازی**، هر
   * مسیری که آن را تزریق کند از گیت رد می‌شود (`assertAuthorityUsable`).
   */
  readonly developmentOnly?: boolean;

  /**
   * توکن را بررسی کن و claimها را برگردان، یا `AuthError` بینداز.
   *
   * `boardId` هم داده می‌شود تا پیاده‌سازی بتواند تطابقِ توکن با **همین** بورد را
   * بسنجد — یک توکنِ معتبرِ بوردِ دیگر نباید اینجا کار کند.
   */
  verify(token: string, boardId: string): Promise<RtTokenClaims>;
}

/** آیا مقدار یکی از نقش‌های شناخته‌شده است؟ */
export function isBoardRole(value: unknown): value is BoardRole {
  return typeof value === "string" && (BOARD_ROLES as readonly string[]).includes(value);
}

/**
 * ★★ گیتِ runtime علیهِ پیاده‌سازیِ توسعه در production
 * ([ADR-031](../../../../ARCHITECTURE_DECISIONS.md#adr-031)).
 *
 * ⚠️ **باید سرور را بالا نیاورد، نه اینکه هشدار بدهد.** هرکس
 * `RT_DEV_JWT_SECRET` را بداند می‌تواند برای خودش نقشِ `owner` صادر کند — یعنی
 * کلِ [ADR-012](../../../../ARCHITECTURE_DECISIONS.md#adr-012) از پشت دور زده
 * می‌شود. یک هشدار در لاگ، در یک سرویسِ زنده، دیده نمی‌شود.
 *
 * این خطر در گام ۰٫۱ حین نوشتنِ ADR-031 بیرون آمد و در TODO ثبت شد؛ اینجا
 * پیاده‌اش می‌کنیم.
 */
export function assertAuthorityUsable(authority: BoardAuthority, appEnv: string): void {
  if (appEnv === "production" && authority.developmentOnly === true) {
    throw new Error(
      "‏[hamboom] پیاده‌سازیِ توسعه‌ایِ احراز هویت در production مجاز نیست: هرکس " +
        "RT_DEV_JWT_SECRET را بداند می‌تواند برای خودش نقشِ owner صادر کند (ADR-031). " +
        "یک BoardAuthorityِ واقعی تزریق کن یا APP_ENV را درست بگذار.",
    );
  }
}

/** کدهای خطایی که این لایه تولید می‌کند — برای خوانایی، از همان منبعِ پروتکل. */
export const AUTH_ERROR_CODES = {
  missing: HB_ERROR_CODES.TOKEN_MISSING,
  invalid: HB_ERROR_CODES.TOKEN_INVALID,
  expired: HB_ERROR_CODES.TOKEN_EXPIRED,
  forbidden: HB_ERROR_CODES.FORBIDDEN,
} as const;
