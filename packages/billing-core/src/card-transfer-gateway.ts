import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentGateway,
  VerifyOutcome,
  VerifyPaymentInput,
} from "./gateway.ts";
import { assertGatewayAmount } from "./money.ts";

/**
 * درگاهِ کارت‌به‌کارت/شبا با **تاییدِ دستی** —
 * [ADR-070](../../../ARCHITECTURE_DECISIONS.md#adr-070).
 *
 * ★★ **این یک درگاه است، نه یک میان‌بُر — و همین نکته‌ی اصلیِ ADR-070 است.**
 * [ADR-055](../../../ARCHITECTURE_DECISIONS.md#adr-055) می‌گوید `settlePayment` **تنها** مسیرِ
 * فعال‌سازی است. یک عملِ «دستی فعالش کن» مجبور بود قفلِ ردیف، مصرفِ کوپن سرِ تسویه، محاسبه‌ی
 * دوره و خروجِ زودهنگامِ ردیفِ `refunded` را یا کپی کند یا دور بزند — و آن‌وقت سنجه‌ی
 * `billing:settle` دیگر مسیرِ نو را پوشش نمی‌داد. وقتی تایید از **خودِ پورت** جواب می‌دهد،
 * مسیرِ نو همان مسیرِ قدیم است.
 *
 * ★ **تنها تفاوتش با دو درگاهِ دیگر:** به‌جای `fetch`، از یک پورتِ باریکِ تزریق‌شده
 * (`TransferApprovalReader`) می‌خواند که پشتش جدولِ `payments`ِ خودمان است. پس `billing-core`
 * همچنان نه `fetch` می‌بیند نه `pg` (الگوی [ADR-046](../../../ARCHITECTURE_DECISIONS.md#adr-046)).
 *
 * ⚠️⚠️ **و بندی که بیشترین اثر را دارد، نگاشتِ سه‌حالتیِ `VerifyOutcome` است.**
 * `settleLocked` روی `gatewayError` عمداً `failure_code` را **دست نمی‌زند**، و کلِ
 * [ADR-056](../../../ARCHITECTURE_DECISIONS.md#adr-056) روی همان ستون می‌ایستد. پس:
 *
 * | وضعیتِ ردیف | پاسخ | نتیجه |
 * |---|---|---|
 * | staff تایید کرده | `paid` | فعال می‌شود |
 * | کاربر ادعای پرداخت ثبت کرده | `gatewayError` | **هرگز ابطالِ خودکار** |
 * | بی‌ادعا، هنوز داخلِ پنجره | `gatewayError` | هنوز قضاوت نمی‌کنیم |
 * | بی‌ادعا، پنجره گذشته | `notPaid` | ابطالِ عادی (رهاشده) |
 *
 * دلیلش پایا است: تسویه‌اش **چرخه‌ای** است و می‌تواند روزِ کاری بعد بنشیند. اگر ردیفِ ادعاشده
 * `notPaid` می‌گرفت، sweep بعد از سقفِ سن باطلش می‌کرد و پول **بعدش** می‌رسید — دقیقاً همان
 * «پول گرفته شد، سرویس داده نشد» که نردبان برای حذفش نوشته شد.
 */

/** وضعیتِ یک ردیفِ انتقال، همان‌طور که دیتابیس می‌بیندش. همه‌ی زمان‌ها epoch ms. */
export interface TransferRecord {
  /** `null` تا وقتی staff تایید نکرده. */
  approvedAtMs: number | null;
  /** شماره‌ی مرجعی که **staff در صورت‌حساب دید** — مرجعِ تصمیم، نه ادعای کاربر. */
  transferRef: string | null;
  /** ۴ رقمِ آخرِ کارتِ مبدأ، اگر staff ثبتش کرده باشد. */
  senderLast4: string | null;
  /** `null` تا وقتی کاربر «پرداخت کردم» را ثبت نکرده. */
  claimedAtMs: number | null;
  requestedAtMs: number;
  /**
   * ★★ ساعتِ **دیتابیس**، نه `Date.now()`ِ پروسه.
   *
   * فاز ۷ی M6 اختلافِ ساعتِ PG↔api را اندازه گرفت (۰–۲ms) و همان اختلاف یک باگِ تولیدی ساخته
   * بود (حلقه‌ی بی‌پایانِ ۴۲۸ در `stepUpFresh`). این‌جا هم سن با همان ساعتی سنجیده می‌شود که
   * `requested_at` را نوشته — وگرنه دو ساعت داریم و مقایسه‌شان بی‌معنی است.
   */
  nowMs: number;
}

/**
 * پورتِ خواندنِ وضعیتِ انتقال.
 *
 * ⚠️ **باید تراکنش‌محدود ساخته شود.** تایید و فعال‌سازی در یک تراکنش‌اند
 * (ADR-014 اتمیک‌بودنشان را می‌خواهد)، پس خواننده‌ای که روی اتصالِ **دیگری** از استخر بخواند،
 * تاییدِ commit‌نشده را **نمی‌بیند** و `verifyPayment` می‌گوید «هنوز تایید نشده».
 * همان تله‌ی اتصالِ استخر که `infra:probe-lock` در M5 فاز ۱ ثبتش کرد.
 */
export interface TransferApprovalReader {
  read(authority: string): Promise<TransferRecord | null>;
}

export interface CardTransferGatewayConfig {
  /** ریشه‌ی صفحه‌ی «این مبلغ را به این کارت بریز» که `apps/web` سرو می‌کند. */
  checkoutBaseUrl: string;
  /** `production` یا `sandbox` — در ستونِ `payments.gateway_mode` می‌نشیند. */
  mode: string;
  reader: TransferApprovalReader;
  /**
   * تا این مدت بعد از ساختِ فاکتور، نبودِ ادعا **قضاوت نمی‌شود** (`gatewayError`).
   * بعدش «رهاشده» است (`notPaid`) و نردبان می‌تواند باطلش کند.
   */
  claimWindowMs: number;
  /** برای تستِ قطعی؛ پیش‌فرض Web Crypto. */
  authorityFactory?: () => string;
}

/** کدهای شکست — رشته‌ی `failure_code` از اینها ساخته می‌شود. عمداً عددی‌اند مثلِ زرین‌پال. */
export const CARD_TRANSFER_ABANDONED = 1001;

/**
 * تصمیم، **خالص** و بدونِ ساعتِ محلی — تا با یک رکوردِ ساختگی کامل آزمون‌پذیر باشد.
 *
 * ★ همان انضباطِ `reconcile.ts`: لحظه‌ی مرجع پارامتر است، نه `new Date()`.
 */
export function decideTransfer(
  record: TransferRecord | null,
  claimWindowMs: number,
): VerifyOutcome {
  // ★ ردیفی که پیدا نشد یعنی «نمی‌دانیم»، نه «پرداخت نشد». `settleLocked` فقط برای ردیفی که
  //   خودش قفل کرده verify می‌زند، پس اینجا رسیدن یعنی مسابقه یا باگ — و در هر دو حالت
  //   `notPaid` گفتن، `failure_code` می‌نوشت و ردیف را در معرضِ ابطال می‌گذاشت.
  if (record === null) {
    return { status: "gatewayError", code: null, message: "وضعیتِ این واریز خوانده نشد." };
  }

  if (record.approvedAtMs !== null) {
    // ⚠️ CHECKِ `payments_transfer_approval_ck` تضمین می‌کند تایید بدونِ شماره وجود ندارد؛
    //    این نگهبان برای خواننده‌ی بدلی در تست است، نه برای دیتابیس.
    if (record.transferRef === null) {
      return { status: "gatewayError", code: null, message: "تاییدِ بدونِ شماره‌ی مرجع." };
    }
    return {
      status: "paid",
      // ★ همیشه `false`: این درگاه هرگز **مستقلاً** پول نمی‌گیرد. کدِ ۱۰۱ی زرین‌پال یعنی
      //   «خودم قبلاً capture کرده‌ام»؛ این‌جا هیچ‌کس جز خودمان capture نمی‌کند، و ردیفِ
      //   تسویه‌شده اصلاً به verify نمی‌رسد (خروجِ زودهنگامِ `settleLocked`).
      alreadyVerified: false,
      refId: record.transferRef,
      cardPanMasked: maskLast4(record.senderLast4),
      // ⊕ هشِ کارت نداریم و **نمی‌سازیم**: ستونش جای پاسخِ درگاه است، نه حدسِ ما.
      cardHash: null,
      // ⊕ کارمزدِ بانک را فرستنده می‌دهد و در صورت‌حسابِ ما نمی‌آید.
      feeRial: null,
    };
  }

  if (record.claimedAtMs !== null) {
    return {
      status: "gatewayError",
      code: null,
      message: "کاربر پرداخت را اعلام کرده و در انتظارِ تاییدِ اپراتور است.",
    };
  }

  if (record.nowMs - record.requestedAtMs < claimWindowMs) {
    return {
      status: "gatewayError",
      code: null,
      message: "هنوز داخلِ مهلتِ پرداخت است.",
    };
  }

  return {
    status: "notPaid",
    code: CARD_TRANSFER_ABANDONED,
    message: "مهلتِ پرداخت گذشت و هیچ واریزی اعلام نشد.",
  };
}

/**
 * ⚠️ فقط چیزی را نشان می‌دهد که **می‌دانیم**.
 *
 * زرین‌پال `603799******1234` می‌دهد چون شش رقمِ اولش را هم دارد. ما فقط چهار رقمِ آخر را از
 * صورت‌حساب داریم، پس ساختنِ یک PANِ ۱۶رقمیِ جعلی یعنی وانمودکردن به دانشی که نداریم — و
 * ردیفِ شبا اصلاً کارتی ندارد.
 */
export function maskLast4(last4: string | null): string | null {
  return last4 === null ? null : `****${last4}`;
}

export class CardTransferGateway implements PaymentGateway {
  readonly name = "card_transfer";
  readonly mode: string;
  /**
   * ★★ `false` — و برخلافِ `MockGateway` این امن است.
   *
   * `MockGateway` به **هر** authority «پرداخت شد» می‌گوید؛ این یکی فقط وقتی `paid` می‌دهد که
   * یک staff از `requireStepUp` رد شده و یک ردیفِ ممیزی در **همان تراکنش** نوشته شده باشد
   * ([ADR-067](../../../ARCHITECTURE_DECISIONS.md#adr-067)).
   * ⊕ و چون هیچ سرویسِ بیرونی‌ای در کار نیست، **کلِ این فلو لوکال اجرا می‌شود** — اولین بار که
   *   مسیرِ پرداخت اصلِ P3 را بدونِ حسابِ ابری رعایت می‌کند.
   */
  readonly developmentOnly = false;

  readonly #checkoutBaseUrl: string;
  readonly #reader: TransferApprovalReader;
  readonly #claimWindowMs: number;
  readonly #authorityFactory: () => string;

  constructor(config: CardTransferGatewayConfig) {
    this.#checkoutBaseUrl = config.checkoutBaseUrl.replace(/\/+$/, "");
    this.mode = config.mode;
    this.#reader = config.reader;
    this.#claimWindowMs = config.claimWindowMs;
    this.#authorityFactory = config.authorityFactory ?? randomAuthority;
  }

  // ★ `async` به همان دلیلِ `MockGateway`: `assertGatewayAmount` می‌تواند پرتاب کند و پرتابِ
  //   **همزمان** از متدی که `Promise` اعلام کرده با `.catch()` گرفته نمی‌شود.
  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    assertGatewayAmount(input.amountRial);
    const authority = this.#authorityFactory();
    // ⊕ هیچ حالتی این‌جا نگه داشته نمی‌شود: ردیفِ `payments` که `createCheckout` درج می‌کند
    //   خودش کلِ حالت است. درگاهی که حافظه‌ی خودش را داشته باشد، بعد از ری‌استارت دروغ می‌گوید.
    return { authority, redirectUrl: `${this.#checkoutBaseUrl}/${authority}` };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyOutcome> {
    const record = await this.#reader.read(input.authority);
    return decideTransfer(record, this.#claimWindowMs);
  }

  // ⛔ `refund` پیاده نمی‌شود: پول روی کارتِ شخصی نشسته و برگرداندنش یک انتقالِ **دستی** است.
  //    نبودنش یعنی `REFUND_UNAVAILABLE` و همان «ثبتِ استردادِ دستی»ِ ADR-068 — بدونِ یک خط کدِ نو.
  // ⛔ `reverse` هم نه: چیزی برای «برگرداندن پیش از تسویه» وجود ندارد.
  // ⛔ `listUnverified` هم نه: واریزِ **بی‌صاحب** (پولی که آمده و هیچ فاکتوری ادعایش نکرده) تا
  //    وقتی پیامکِ بانک خوانده نشود دیده نمی‌شود — گامِ ۴ی ADR-070 و ADRِ خودش.
}

/**
 * ★ authority این‌جا برخلافِ `MockGateway` یک **مرزِ امنیتی** است: توکنِ URLِ صفحه‌ای که شماره‌ی
 * کارت و مبلغ را نشان می‌دهد. قابلِ‌حدس‌بودنش یعنی هر کسی می‌تواند فاکتورهای دیگران را بشمارد.
 * پس `Math.random` (که Mock عمداً استفاده می‌کند) این‌جا **کافی نیست**.
 *
 * ⊕ `globalThis.crypto` عمدی است، نه `import`ِ `node:crypto`: `billing-core` هیچ وابستگیِ Node
 *   ندارد و Web Crypto در Node ۲۴ و مرورگر هر دو سراسری است. طول: ۳۴ کاراکتر (< ۸۰ی ستون).
 */
function randomAuthority(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `CT${hex}`;
}
