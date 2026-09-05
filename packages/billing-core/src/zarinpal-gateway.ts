import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentGateway,
  VerifyOutcome,
  VerifyPaymentInput,
} from "./gateway.ts";
import { assertGatewayAmount } from "./money.ts";

/**
 * آداپتورِ زرین‌پال — [ADR-014](../../../ARCHITECTURE_DECISIONS.md#adr-014)،
 * [ADR-049](../../../ARCHITECTURE_DECISIONS.md#adr-049).
 *
 * ★★ **سه قاعده‌ای که با تماسِ زنده در گام ۱٫۱ اندازه‌گیری شدند، نه از مستندات نقل:**
 *
 * ۱. **هرگز روی `res.ok` شاخه نزن.** زرین‌پال برای نتایجِ **عادیِ** کسب‌وکار non-2xx
 *    برمی‌گرداند — اندازه‌گیری‌شده: `-9` ⇒ HTTP ۴۲۲، `-51` (پرداخت‌نشده) ⇒ HTTP **۴۰۱**،
 *    `-50` (اختلافِ مبلغ) ⇒ HTTP ۴۰۱. یک wrapper که روی `!res.ok` استثنا بیندازد،
 *    «هنوز پرداخت نشده» را به یک خطای سیستمی تبدیل می‌کند و بدنه‌ی JSON را هم دور می‌ریزد.
 *
 * ۲. **`errors` بینِ موفق و ناموفق تغییرِ نوع می‌دهد** — موفق `[]` (**آرایه**)، ناموفق
 *    `{message, code}` (**شیء**). هر schemaی نوشته‌شده از روی مسیرِ خوشحال، هر خطای واقعی
 *    را به خطای اعتبارسنجی تبدیل می‌کند و کدِ واقعیِ درگاه را پنهان.
 *
 * ۳. ★★ **{۱۰۰، ۱۰۱} یعنی پرداخت‌شده.** verifyِ دومِ همان تراکنش **همیشه** ۱۰۱ می‌دهد —
 *    و probeِ گام ۱٫۱ با یک پرداختِ واقعی دیدش (HTTP ۲۰۰، `errors` آرایه، یعنی شکلِ
 *    **موفق**). چکِ ساده‌ی `code === 100` یک مشتریِ پرداخت‌کرده را «ناموفق» ثبت می‌کند.
 *
 * و **همیشه `currency: "IRR"` صریح** فرستاده می‌شود: پیش‌فرضِ درگاه ریال است ولی `IRT`
 * (تومان) هم مجاز است، و اشتباهش یعنی ضریبِ ۱۰ روی هر تراکنش (P5).
 */

export interface ZarinpalConfig {
  /** `https://payment.zarinpal.com` یا `https://sandbox.zarinpal.com`. */
  baseUrl: string;
  /** UUIDِ ۳۶ کاراکتری. در سندباکس هر UUIDِ دلخواهی کار می‌کند. */
  merchantId: string;
  mode: "sandbox" | "production";
  /** برای تست تزریق می‌شود؛ در runtime `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** بدنه‌ی خامِ پاسخِ درگاه، بدونِ هیچ فرضی درباره‌ی شکلش. */
interface RawReply {
  status: number;
  body: Record<string, unknown>;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** کدهایی که «پرداخت شده» یعنی — ۱۰۰ بارِ اول، ۱۰۱ هر بارِ بعد. */
const PAID_CODES = new Set([100, 101]);

export class ZarinpalGateway implements PaymentGateway {
  readonly name = "zarinpal";
  readonly mode: string;
  /** ★ برخلافِ mock، در production مجاز است. */
  readonly developmentOnly = false;

  readonly #config: Required<Omit<ZarinpalConfig, "mode">> & { mode: string };

  constructor(config: ZarinpalConfig) {
    if (config.merchantId.length !== 36) {
      // اندازه‌گیری‌شده در گام ۱٫۱: merchantِ کوتاه ⇒ HTTP ۴۲۲ کدِ `-9`. بهتر است در
      // **بوت** بشکند تا سرِ اولین پرداختِ واقعیِ مشتری.
      throw new Error(
        `ZARINPAL_MERCHANT_ID باید دقیقاً ۳۶ کاراکتر باشد (طولِ فعلی: ${config.merchantId.length}).`,
      );
    }
    this.mode = config.mode;
    this.#config = {
      baseUrl: config.baseUrl.replace(/\/+$/, ""),
      merchantId: config.merchantId,
      mode: config.mode,
      fetchImpl: config.fetchImpl ?? globalThis.fetch,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
  }

  /** ★ قاعده ۱ و ۲: بدنه **همیشه** خوانده می‌شود، روی هر status. */
  async #call(path: string, payload: Record<string, unknown>): Promise<RawReply> {
    const res = await this.#config.fetchImpl(`${this.#config.baseUrl}/pg/v4/payment/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.#config.timeoutMs),
    });

    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      // بدنه‌ی غیر-JSON یعنی چیزی بینِ ما و درگاه است (پروکسی، صفحه‌ی خطا). بدنه‌ی خالی
      // می‌ماند و شاخه‌ی `gatewayError` تصمیم می‌گیرد — نه استثنا.
    }
    return { status: res.status, body };
  }

  /** کدِ کسب‌وکار را می‌کشد بیرون: از `data.code` (موفق) یا `errors.code` (ناموفق). */
  static #codeOf(reply: RawReply): number | null {
    const data = reply.body.data as Record<string, unknown> | undefined;
    if (data && typeof data.code === "number") return data.code;
    const errors = reply.body.errors;
    if (errors !== null && typeof errors === "object" && !Array.isArray(errors)) {
      const code = (errors as Record<string, unknown>).code;
      if (typeof code === "number") return code;
    }
    return null;
  }

  static #messageOf(reply: RawReply): string {
    const errors = reply.body.errors;
    if (errors !== null && typeof errors === "object" && !Array.isArray(errors)) {
      const message = (errors as Record<string, unknown>).message;
      if (typeof message === "string") return message;
    }
    const data = reply.body.data as Record<string, unknown> | undefined;
    if (data && typeof data.message === "string") return data.message;
    return `پاسخِ نامنتظر از درگاه (HTTP ${reply.status}).`;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    assertGatewayAmount(input.amountRial);

    const reply = await this.#call("request.json", {
      merchant_id: this.#config.merchantId,
      amount: input.amountRial,
      currency: "IRR", // ★ همیشه صریح — پیش‌فرض ریال است ولی IRT هم مجاز
      description: input.description.slice(0, 500), // کدِ -9 روی توضیحِ بلندتر
      callback_url: input.callbackUrl,
      ...(input.orderId === undefined ? {} : { metadata: { order_id: input.orderId } }),
    });

    const data = reply.body.data as Record<string, unknown> | undefined;
    const authority = data?.authority;
    if (ZarinpalGateway.#codeOf(reply) !== 100 || typeof authority !== "string") {
      throw new Error(
        `ساختِ پرداخت ناموفق بود (کدِ ${String(ZarinpalGateway.#codeOf(reply))}): ${ZarinpalGateway.#messageOf(reply)}`,
      );
    }

    return {
      authority,
      redirectUrl: `${this.#config.baseUrl}/pg/StartPay/${authority}`,
    };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyOutcome> {
    let reply: RawReply;
    try {
      reply = await this.#call("verify.json", {
        merchant_id: this.#config.merchantId,
        amount: input.amountRial, // ★ همان مبلغِ ذخیره‌شده، نه بازمحاسبه (خطرِ -50)
        authority: input.authority,
      });
    } catch (cause) {
      // شبکه قطع بود ⇒ «نمی‌دانیم»، نه «پرداخت نشد». ردیف `pending` می‌مانَد تا sweep.
      return {
        status: "gatewayError",
        code: null,
        message: `تماس با درگاه ممکن نشد: ${String((cause as Error).message)}`,
      };
    }

    const code = ZarinpalGateway.#codeOf(reply);

    // ★★ قاعده ۳ — {۱۰۰، ۱۰۱} = پرداخت‌شده. فقط ۱۰۰ حق دارد فعال کند.
    if (code !== null && PAID_CODES.has(code)) {
      const data = (reply.body.data ?? {}) as Record<string, unknown>;
      return {
        status: "paid",
        alreadyVerified: code === 101,
        // ⚠️ `ref_id` را درگاه **عدد** می‌دهد (اندازه‌گیری‌شده: ۴۷۶۵۶۹۶۰۱). به رشته
        //    تبدیل می‌شود چون ستون `varchar` است و بزرگیِ بیشینه‌اش مستند نیست.
        refId: data.ref_id === undefined || data.ref_id === null ? "" : String(data.ref_id),
        cardPanMasked: typeof data.card_pan === "string" ? data.card_pan : null,
        feeRial: typeof data.fee === "number" ? data.fee : null,
      };
    }

    // کدِ کسب‌وکارِ شناخته‌شده ⇒ «پرداخت نشد». بدونِ کد ⇒ «نمی‌دانیم».
    const message = ZarinpalGateway.#messageOf(reply);
    return code === null
      ? { status: "gatewayError", code: null, message }
      : { status: "notPaid", code, message };
  }
}
