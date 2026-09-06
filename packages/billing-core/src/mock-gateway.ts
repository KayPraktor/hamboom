import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentGateway,
  UnverifiedPayment,
  VerifyOutcome,
  VerifyPaymentInput,
} from "./gateway.ts";
import { assertGatewayAmount } from "./money.ts";

/**
 * درگاهِ ساختگیِ توسعه — **پیش‌فرضِ `PAYMENT_PROVIDER`** (M4-D5،
 * [ADR-049](../../../ARCHITECTURE_DECISIONS.md#adr-049)).
 *
 * ★ **چرا پیش‌فرض است و سندباکسِ زرین‌پال نه:** سندباکس یک **سرویسِ خارجی روی اینترنت**
 * است. اگر پیش‌فرضِ توسعه شود، یک ماشینِ آفلاین یا CIِ بدونِ egress جریانِ پرداختِ **مرده**
 * دارد — نقضِ مستقیمِ P2 و P3 («`docker compose up && pnpm dev` باید کافی باشد»).
 * PLAN §۴ پیش‌فرض را `zarinpal`+sandbox نوشته بود؛ این انحرافِ ثبت‌شده است.
 *
 * ★★ **`developmentOnly = true` و این پرچم شوخی نیست:** این درگاه همیشه «پرداخت شد»
 * می‌گوید. اگر در production بالا بیاید، **هر اشتراکی رایگان فعال می‌شود** — و هیچ تستی
 * نمی‌گیردش، چون تست‌ها عمداً همین را تزریق می‌کنند. گیتش `assertGatewayAllowed` است که
 * باید در مسیرِ **ساختِ اپ** صدا زده شود.
 *
 * رفتارش عمداً شبیهِ زرین‌پالِ واقعی است تا کدِ بالادست دو مسیر نگیرد: authority می‌سازد،
 * ریدایرکت می‌دهد، و **گذارِ ۱۰۰→۱۰۱** را بازتولید می‌کند (verifyِ دوم `alreadyVerified`).
 */

export interface MockGatewayConfig {
  /** ریشه‌ی صفحه‌ی ساختگیِ پرداخت که `apps/api` سرو می‌کند (فاز ۵). */
  checkoutBaseUrl: string;
  /** برای تستِ قطعی؛ پیش‌فرض یک شمارنده‌ی داخلی. */
  authorityFactory?: () => string;
  /** اگر `true`، هر پرداخت «ناموفق» می‌شود — برای دیدنِ مسیرِ شکست در توسعه. */
  failEveryPayment?: boolean;
}

interface MockRecord {
  amountRial: number;
  verifiedAt: number | null;
}

export class MockGateway implements PaymentGateway {
  readonly name = "mock";
  readonly mode = "sandbox";
  /** ★★ گیتِ production. بدونِ این، «پرداخت» رایگان می‌شود. */
  readonly developmentOnly = true;

  readonly #checkoutBaseUrl: string;
  readonly #failEveryPayment: boolean;
  readonly #authorityFactory: () => string;
  readonly #records = new Map<string, MockRecord>();
  #counter = 0;

  constructor(config: MockGatewayConfig) {
    this.#checkoutBaseUrl = config.checkoutBaseUrl.replace(/\/+$/, "");
    this.#failEveryPayment = config.failEveryPayment ?? false;
    this.#authorityFactory = config.authorityFactory ?? (() => this.#nextAuthority());
  }

  /**
   * ★★ **شمارنده به‌تنهایی کافی نیست — و این را یک شکستنِ عمدی در فاز ۸ ثابت کرد.**
   *
   * نگارشِ اول `MOCK` + شمارنده‌ی صفرپرشده بود، یعنی هر پروسه‌ی تازه دوباره از
   * `MOCK…0001` شروع می‌کرد. ولی ردیف‌های dev در دیتابیس **می‌مانند**؛ پس دومین
   * `pnpm dev` (یا دومین اجرای هر اسکریپت) روی `payments_authority_uq` می‌خورْد و
   * checkout با ۵۰۰ می‌افتاد — نقضِ مستقیمِ P3 («`docker compose up && pnpm dev` باید کافی
   * باشد»)، آن هم روی اولین کاری که یک توسعه‌دهنده امتحان می‌کند.
   *
   * حالا شمارنده فقط خوانایی می‌دهد و یکتایی از بخشِ تصادفی می‌آید. طول همچنان ۳۶
   * کاراکتر است، مثلِ authorityِ واقعی. ⚠️ `Math.random` عمدی است: `billing-core` هیچ
   * وابستگیِ Node ندارد (بدونِ `node:crypto`) و این یک شناسه‌ی **ساختگیِ توسعه** است،
   * نه چیزی که امنیت به آن تکیه کند.
   */
  #nextAuthority(): string {
    const counter = String(++this.#counter).padStart(3, "0").slice(-3);
    const chunk = (): string => Math.random().toString(36).slice(2).padEnd(11, "0").slice(0, 11);
    return `MOCK${counter}${chunk()}${chunk()}${chunk()}`.slice(0, 36);
  }

  // ★ `async` عمدی: `assertGatewayAmount` می‌تواند پرتاب کند، و متدی که `Promise` اعلام
  //   کرده ولی **همزمان** پرتاب می‌کند با `.catch()` گرفته نمی‌شود — یک ناسازگاریِ واقعی
  //   که فراخوان را غافلگیر می‌کند. همان قاعده برای `verifyPayment`.
  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    // ★ همان نگهبانِ مبلغِ درگاهِ واقعی — تا پیکربندیِ بدِ پلن در dev هم دیده شود، نه فقط در production.
    assertGatewayAmount(input.amountRial);

    const authority = this.#authorityFactory();
    this.#records.set(authority, { amountRial: input.amountRial, verifiedAt: null });

    return { authority, redirectUrl: `${this.#checkoutBaseUrl}/${authority}` };
  }

  /**
   * فهرستِ authorityهایی که ساخته شده‌اند و هنوز verify نشده‌اند (M4 فاز ۷).
   *
   * ⚠️ **معادلِ دقیقِ زرین‌پال نیست و نباید وانمود کند هست:** آن‌جا فهرست فقط تراکنش‌های
   * **پرداخت‌شده**ی verify‌نشده است، این‌جا هر پرداختِ ساخته‌شده‌ی verify‌نشده — چون درگاهِ
   * ساختگی اصلاً مفهومِ «کاربر پول داد» ندارد (هر verify موفق است). برای اثباتِ مسیرِ
   * **فرزندخواندگیِ** ردیفِ یتیم کافی است و همان چیزی است که سنجه‌ی فاز ۷ می‌سنجد.
   */
  async listUnverified(): Promise<UnverifiedPayment[]> {
    const out: UnverifiedPayment[] = [];
    for (const [authority, record] of this.#records) {
      if (record.verifiedAt === null) out.push({ authority, amountRial: record.amountRial });
    }
    return out;
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyOutcome> {
    const record = this.#records.get(input.authority);
    if (record === undefined) {
      return { status: "notPaid", code: -51, message: "این پرداخت در درگاهِ ساختگی وجود ندارد." };
    }

    if (this.#failEveryPayment) {
      return { status: "notPaid", code: -51, message: "پرداختِ ناموفق (حالتِ تست)." };
    }

    // ★ همان خطای `-50`ِ واقعی: مبلغِ verify باید با مبلغِ ساخت یکی باشد.
    if (record.amountRial !== input.amountRial) {
      return {
        status: "notPaid",
        code: -50,
        message: "مبلغِ پرداخت‌شده با مبلغِ ارسالی در verify متفاوت است.",
      };
    }

    // ★★ بازتولیدِ گذارِ ۱۰۰→۱۰۱ — تا مسیرِ idempotencyِ ADR-050 در توسعه هم واقعاً آزموده شود.
    const alreadyVerified = record.verifiedAt !== null;
    if (!alreadyVerified) record.verifiedAt = this.#records.size;

    return {
      status: "paid",
      alreadyVerified,
      refId: `MOCKREF${input.authority.slice(-8)}`,
      cardPanMasked: "502229******0000",
      cardHash: null,
      feeRial: 0,
    };
  }
}
