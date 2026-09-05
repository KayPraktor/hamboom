/**
 * پورتِ درگاهِ پرداخت — [ADR-014](../../../ARCHITECTURE_DECISIONS.md#adr-014)،
 * [ADR-049](../../../ARCHITECTURE_DECISIONS.md#adr-049).
 *
 * سه پیاده‌سازی در نقشه است: `MockGateway` (پیش‌فرضِ توسعه، P2/P3)، `ZarinpalGateway`
 * (سندباکس و production با تعویضِ میزبان)، و روزی `IdpayGateway`. اینجا فقط **شکل** است —
 * نه `fetch`، نه `pg`، نه پیکربندیِ خوانده‌شده از `process.env`.
 */

/** ورودیِ ساختِ پرداخت. ★ مبلغ **همیشه** از سرور می‌آید (ADR-014، آخرین خط). */
export interface CreatePaymentInput {
  /** ریالِ صحیح (P5). */
  amountRial: number;
  /** شرحِ فارسیِ کوتاه که در صفحه‌ی درگاه دیده می‌شود. */
  description: string;
  /** URLی که درگاه کاربر را بعد از پرداخت به آن برمی‌گرداند. */
  callbackUrl: string;
  /** شماره‌ی فاکتورِ ما — برای پیگیری در پنلِ درگاه. */
  orderId?: string;
}

export interface CreatePaymentResult {
  /** شناسه‌ی درگاه. در `payments.authority` ذخیره می‌شود (ایندکسِ یکتا). */
  authority: string;
  /** آدرسی که مرورگرِ کاربر باید به آن هدایت شود. */
  redirectUrl: string;
}

/**
 * نتیجه‌ی verify — عمداً سه حالتِ **متمایز**، نه یک boolean.
 *
 * ★★ `alreadyVerified` تفاوتِ کدِ ۱۰۰ و ۱۰۱ را نگه می‌دارد و **قلبِ ADR-050** است:
 * هر دو یعنی «پرداخت شده»، ولی فقط ۱۰۰ حق دارد اشتراک را فعال کند. اگر این پرچم را
 * تخت کنیم، یک رفرشِ مرورگر می‌تواند یک دوره‌ی اشتراکِ دوم هدیه بدهد.
 *
 * ⚠️ و `notPaid` از `gatewayError` جداست چون **دو تصمیمِ متفاوت** می‌سازند: اولی یعنی
 * «کاربر پول نداد» (ردیف را `failed` کن)، دومی یعنی «نمی‌دانیم» (ردیف را `pending`
 * بگذار تا sweep دوباره بپرسد). یکی‌کردنشان یعنی یا پرداختِ واقعی را گم می‌کنی یا
 * برای همیشه یک ردیفِ مرده نگه می‌داری.
 */
export type VerifyOutcome =
  | {
      status: "paid";
      /** ★ `true` وقتی درگاه گفت «قبلاً verify شده» (زرین‌پال: کدِ ۱۰۱). فعال‌سازیِ دوباره ممنوع. */
      alreadyVerified: boolean;
      /** شماره‌ی پیگیریِ بانک. **رشته** نگه داشته می‌شود، نه عدد (ستون `varchar`). */
      refId: string;
      cardPanMasked: string | null;
      feeRial: number | null;
    }
  | { status: "notPaid"; code: number | null; message: string }
  | { status: "gatewayError"; code: number | null; message: string };

export interface VerifyPaymentInput {
  authority: string;
  /**
   * ★ **همان مبلغی که هنگامِ ساخت فرستاده شد** — از `payments.amount_rial` خوانده می‌شود،
   * نه بازمحاسبه از `plans`. probeِ گام ۱٫۱ نشان داد اختلافِ **یک ریال** خطای `-50` می‌دهد
   * و یک مشتریِ واقعاً پرداخت‌کرده را `verify_failed` می‌کند.
   */
  amountRial: number;
}

export interface PaymentGateway {
  /** در ستونِ `payments.gateway` می‌نشیند: `zarinpal` | `mock`. */
  readonly name: string;
  /** در ستونِ `payments.gateway_mode`: `sandbox` | `production`. */
  readonly mode: string;
  /**
   * ★ اگر `true`، این پیاده‌سازی حق ندارد در production بالا بیاید.
   * ادعایش با `assertGatewayAllowed` **داخلِ ساختِ اپ** بررسی می‌شود، نه در فایلِ ورودی —
   * تا تست‌ها و هر ورودیِ آینده از یک گیت رد شوند.
   */
  readonly developmentOnly: boolean;

  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  verifyPayment(input: VerifyPaymentInput): Promise<VerifyOutcome>;

  /**
   * ⚠️ **عمداً اختیاری و در M4 پیاده نمی‌شود** (ADR-049). استردادِ زرین‌پال اصلاً در REST
   * نیست — GraphQL + OAuth2 روی میزبانِ دیگر — پس در توسعه اجراناپذیر است (P3). جایش M6.
   */
  refund?(input: { authority: string; amountRial: number }): Promise<VerifyOutcome>;
}

/** وقتی درگاه در محیطِ اشتباه سیم‌کشی شود. */
export class GatewayNotAllowedError extends Error {
  constructor(gatewayName: string, appEnv: string) {
    super(
      `درگاهِ «${gatewayName}» فقط برای توسعه است و در محیطِ «${appEnv}» بالا نمی‌آید. ` +
        "PAYMENT_PROVIDER را درست تنظیم کن (ADR-049).",
    );
    this.name = "GatewayNotAllowedError";
  }
}

/**
 * ★★ گیتی که نبودنش یعنی **هر پرداخت در production رایگان موفق می‌شود**.
 *
 * `MockGateway` همیشه «پرداخت شد» می‌گوید. اگر `APP_ENV=production` با
 * `PAYMENT_PROVIDER=mock` بالا بیاید، هیچ تستی نمی‌گیردش — چون تست‌ها **عمداً** mock را
 * تزریق می‌کنند. پس گیت باید در مسیرِ **ساختِ اپ** باشد، جایی که پیکربندیِ واقعی خوانده می‌شود.
 */
export function assertGatewayAllowed(gateway: PaymentGateway, appEnv: string): void {
  if (gateway.developmentOnly && appEnv === "production") {
    throw new GatewayNotAllowedError(gateway.name, appEnv);
  }
}
