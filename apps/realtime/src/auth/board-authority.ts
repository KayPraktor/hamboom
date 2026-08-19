import { type RtTokenClaims } from "@hamboom/shared-types";
import { BOARD_ROLES, HB_ERROR_CODES, type BoardRole } from "@hamboom/ydoc-schema";

import { RtProtocolError } from "../protocol-error.ts";

/**
 * پورتِ احراز هویتِ بورد — [ADR-031](../../../../ARCHITECTURE_DECISIONS.md#adr-031)،
 * تصمیمِ **D-2**.
 *
 * ── claimها حالا در `shared-types` اند (به‌روزرسانیِ گام ۲٫۳) ──────────
 *
 * قیدِ D-2 (شکلِ claimها **داخلِ همین پورت**) برای M2 بود تا `shared-types` دست‌نخورده
 * بماند. حالا که M3 هم صادرکننده (`apps/api` endpointِ rt-token) و هم مصرف‌کننده
 * (`auth-core`) را می‌سازد، `RtTokenClaims` به `shared-types` رفت
 * ([ADR-042](../../../../ARCHITECTURE_DECISIONS.md#adr-042)، تاییدِ مالک ۱۴۰۵/۰۵/۲۴)؛ این پورت
 * واردش می‌کند و re-export. (`exp` ثانیه است و `sub` **PII** — جزئیات آنجا.) `BoardRole` هم
 * از `ydoc-schema` می‌آید که منبعش را از همان `shared-types` می‌گیرد ([ADR-043](../../../../ARCHITECTURE_DECISIONS.md#adr-043)) — یک تعریف.
 */

export type { RtTokenClaims };

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

  /**
   * ★★ نقشِ **همین حالا** — گام ۴٫۵، [ADR-012](../../../../ARCHITECTURE_DECISIONS.md#adr-012).
   *
   * ⚠️ **این حفره را می‌بندد:** نقش داخلِ توکن است و توکن **تغییر نمی‌کند**. پس
   * کاربری که وسطِ کار به `viewer` تنزل داده شده، کافی است تبش را ببندد و
   * دوباره باز کند تا با همان توکنِ قدیمی دوباره `editor` شود — و کلِ اعمالِ
   * مجوز از پشت دور می‌خورد. اجرای مجوز روی هر update بدونِ این، فقط **تا اولین
   * اتصالِ مجدد** دوام دارد.
   *
   * ADR-012 هم دقیقاً همین را می‌گوید: نقش یک مقدارِ **محاسبه‌شده** است، نه چیزی
   * که در یک توکن ذخیره شده باشد.
   *
   * `undefined` (یا نبودِ خودِ متد) یعنی «نظری ندارم، همان نقشِ توکن معتبر است» —
   * که برای پیاده‌سازیِ توسعه‌ی امروز کافی است. `null` یعنی **این کاربر دیگر هیچ
   * دسترسی‌ای ندارد** و اتصال باید رد شود.
   */
  currentRole?(sub: string, boardId: string): Promise<BoardRole | null | undefined>;
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
