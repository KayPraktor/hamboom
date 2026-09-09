/**
 * ★★ فرستنده‌ی واقعیِ پیامک — **sms.ir** (M5 فازِ ۴٫۵).
 *
 * جفتِ دقیقِ `ZarinpalGateway` در `billing-core`: پورت (`SmsProvider`) و mock از قبل
 * وجود داشتند، این پیاده‌سازیِ واقعی است. سوییچ فقط با `SMS_PROVIDER` است.
 *
 * ── ⚠️ درسِ زرین‌پال، عیناً همین‌جا هم صدق می‌کند ──────────────────────────
 *
 * در M4 تماسِ **زنده** با درگاه پنج فرضِ غلط را گرفت که هیچ‌کدام از مستندات درنمی‌آمد —
 * مهم‌ترینش این بود که خطای کسب‌وکار **non-2xx** می‌آید و شکلِ بدنه هم عوض می‌شود، پس
 * **هرگز نباید روی `res.ok` شاخه زد**. این‌جا همان قاعده اعمال شده: تصمیم از **بدنه‌ی
 * تجزیه‌شده** گرفته می‌شود، و کدِ HTTP فقط بخشی از پیامِ خطاست.
 *
 * ⚠️ **و قرارداد این فایل هنوز از روی مستندات است، نه اندازه‌گیری.**
 * [`scripts/sms-probe.ts`](../../../scripts/sms-probe.ts) یک ارسالِ واقعی می‌کند و
 * **بدنه‌ی خام** را چاپ می‌کند؛ هر اختلافی با آنچه این‌جا فرض شده، همان‌جا دیده می‌شود.
 *
 * ── ★ P7: هیچ PIIی بیرون نمی‌رود ─────────────────────────────────────────
 *
 * نه کد و نه شماره‌ی خام در هیچ پیامِ خطایی نمی‌آیند. شماره **ماسک** می‌شود و کد اصلاً
 * ذکر نمی‌شود — یک استکِ خطا که کدِ ورود را داشته باشد، همان لاگی است که گیتِ فاز ۴
 * برای جلوگیری‌اش ساخته شد.
 */
import { maskPhone, type SmsProvider } from "./otp.ts";

/** خطای فرستنده — کدِ HTTP و کدِ خودِ سرویس **هر دو** نگه داشته می‌شوند. */
export class SmsIrError extends Error {
  readonly httpStatus: number | undefined;
  readonly providerStatus: number | undefined;

  constructor(message: string, opts: { httpStatus?: number; providerStatus?: number } = {}) {
    super(message);
    this.name = "SmsIrError";
    this.httpStatus = opts.httpStatus;
    this.providerStatus = opts.providerStatus;
  }
}

/** وقتی `SMS_PROVIDER=smsir` است ولی پیکربندی ناقص — **در بوت** می‌شکند، نه سرِ ورود. */
export class SmsIrConfigError extends Error {
  constructor(missing: string) {
    super(
      `‏[hamboom] «${missing}» لازم است چون SMS_PROVIDER=smsir است. ` +
        "‏بدونِ آن هیچ کاربری نمی‌تواند وارد شود — پس این‌جا می‌شکند، نه سرِ اولین ورود.",
    );
    this.name = "SmsIrConfigError";
  }
}

export interface SmsIrConfig {
  apiKey: string | undefined;
  /** شناسه‌ی **عددیِ** قالبِ تاییدشده. */
  templateId: number | undefined;
  /** نامِ پارامتر داخلِ قالب، بدونِ `#`. */
  parameterName: string;
  baseUrl: string;
  timeoutMs: number;
  /** تزریق برای تست — بدونش `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
}

/** ارقامِ فارسی و عربی → لاتین. */
const DIGIT_MAP: Record<string, string> = {
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

/**
 * شماره‌ی موبایلِ ایرانی → شکلِ `09XXXXXXXXX`.
 *
 * ⚠️ **تبدیلِ ارقامِ فارسی اختیاری نیست.** کاربرِ ایرانی با کیبوردِ فارسی `۰۹۱۲…` تایپ
 * می‌کند و آن رشته با `09…` **برابر نیست**؛ بدونِ این تبدیل، پیامک به یک شماره‌ی
 * نامعتبر می‌رود و خطایش سمتِ سرویس ظاهر می‌شود، نه سمتِ ما.
 *
 * چهار شکلِ رایج پذیرفته می‌شوند: `09…` · `9…` · `+989…` · `00989…`
 */
export function normalizeIranianMobile(input: string): string {
  const ascii = [...input.trim()]
    .map((ch) => DIGIT_MAP[ch] ?? ch)
    .join("")
    .replace(/[\s\-()]/g, "");

  let digits = ascii;
  if (digits.startsWith("+98")) digits = `0${digits.slice(3)}`;
  else if (digits.startsWith("0098")) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith("98") && digits.length === 12) digits = `0${digits.slice(2)}`;
  else if (digits.startsWith("9") && digits.length === 10) digits = `0${digits}`;

  if (!/^09\d{9}$/.test(digits)) {
    // ⚠️ خودِ شماره در پیام نمی‌آید (P7) — فقط طولش، که برای تشخیص کافی است.
    throw new SmsIrError(
      `شماره‌ی موبایل معتبر نیست (پس از نرمال‌سازی ${String(digits.length)} رقم شد؛ انتظار: 09XXXXXXXXX).`,
    );
  }
  return digits;
}

/** شکلی که از `/v1/send/verify` انتظار داریم — و probe همین را می‌سنجد. */
interface SmsIrResponse {
  status?: number;
  message?: string;
  data?: { messageId?: number; cost?: number } | null;
}

/**
 * نتیجه‌ی تجزیه‌شده‌ی یک ارسال — probe به همین نگاه می‌کند.
 *
 * ★ عمداً از `send` جداست: `SmsProvider.send` قرارداد است و `void` برمی‌گرداند، ولی
 * probe به `messageId` و هزینه نیاز دارد تا بتواند بگوید **چه چیزی واقعاً رخ داد**.
 */
export interface SmsIrSendResult {
  httpStatus: number;
  providerStatus: number | undefined;
  message: string | undefined;
  messageId: number | undefined;
  cost: number | undefined;
  /** بدنه‌ی خام — برای probe، تا قرارداد با **اندازه‌گیری** قفل شود نه با فرض. */
  rawBody: string;
}

function requireConfig(config: SmsIrConfig): { apiKey: string; templateId: number } {
  if (config.apiKey === undefined || config.apiKey.trim() === "") {
    throw new SmsIrConfigError("SMS_IR_API_KEY");
  }
  if (config.templateId === undefined) throw new SmsIrConfigError("SMS_IR_TEMPLATE_ID");
  return { apiKey: config.apiKey, templateId: config.templateId };
}

/**
 * یک ارسالِ واقعی، با نتیجه‌ی **کامل**. هم `send` و هم probe از این استفاده می‌کنند،
 * پس probe دقیقاً همان مسیری را می‌سنجد که production می‌رود — نه یک بدلِ موازی.
 */
export async function sendVerifyCode(
  config: SmsIrConfig,
  phone: string,
  code: string,
): Promise<SmsIrSendResult> {
  const { apiKey, templateId } = requireConfig(config);
  const mobile = normalizeIranianMobile(phone);
  const doFetch = config.fetchImpl ?? globalThis.fetch;
  const url = `${config.baseUrl.replace(/\/+$/, "")}/v1/send/verify`;

  let response: Response;
  try {
    response = await doFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify({
        mobile,
        templateId,
        parameters: [{ name: config.parameterName, value: code }],
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    // ⚠️ timeout و قطعیِ شبکه هر دو این‌جا می‌افتند و **باید** از خطای کسب‌وکار جدا
    //    بمانند: اولی «دوباره تلاش کن» است، دومی «پیکربندی/قالب غلط است».
    throw new SmsIrError(
      `تماس با sms.ir انجام نشد (${String((error as Error).name)}): ${String((error as Error).message)}`,
    );
  }

  const rawBody = await response.text();
  let parsed: SmsIrResponse | null = null;
  try {
    parsed = JSON.parse(rawBody) as SmsIrResponse;
  } catch {
    parsed = null;
  }

  return {
    httpStatus: response.status,
    providerStatus: parsed?.status,
    message: parsed?.message,
    messageId: parsed?.data?.messageId,
    cost: parsed?.data?.cost,
    rawBody,
  };
}

/**
 * ★ آیا این نتیجه «فرستاده شد» است؟
 *
 * ⚠️ **`res.ok` تنها معیار نیست** — درسِ زرین‌پال. معیار `status === 1`ِ خودِ سرویس
 * است؛ کدِ HTTP فقط وقتی حرف می‌زند که بدنه اصلاً JSON نباشد.
 */
export function describeFailure(result: SmsIrSendResult): string | null {
  if (result.providerStatus === 1) return null;
  if (result.providerStatus === undefined) {
    return `پاسخِ sms.ir قابلِ تجزیه نبود (HTTP ${String(result.httpStatus)}): ${result.rawBody.slice(0, 200)}`;
  }
  return (
    `sms.ir ارسال را نپذیرفت — status=${String(result.providerStatus)}` +
    `، HTTP ${String(result.httpStatus)}: ${result.message ?? "(بدونِ پیام)"}`
  );
}

/**
 * `SmsProvider`ِ واقعی.
 *
 * ★ `developmentOnly: false` — یعنی گیتِ [ADR-031](../../../ARCHITECTURE_DECISIONS.md#adr-031)
 * جلویش را نمی‌گیرد و `APP_ENV=production` **بالا می‌آید**. این تنها چیزی است که آن
 * گیت را باز می‌کند، و به همین دلیل پیکربندیِ ناقص همین‌جا در بوت می‌شکند.
 */
export function createSmsIrProvider(config: SmsIrConfig): SmsProvider {
  // ★ در **ساخت** اعتبارسنجی می‌شود، نه در `send`: با `SMS_PROVIDER=smsir` و کلیدِ
  //   نداشته، سرور اصلاً بالا نیاید بهتر از این است که هر ورود ۵۰۰ بدهد.
  requireConfig(config);

  return {
    name: "sms.ir",
    developmentOnly: false,
    async send(phone, code) {
      const result = await sendVerifyCode(config, phone, code);
      const failure = describeFailure(result);
      if (failure !== null) {
        // ⚠️ شماره ماسک و کد **اصلاً** ذکر نمی‌شود (P7) — این پیام به لاگ می‌رسد.
        throw new SmsIrError(`${failure} · گیرنده: ${maskPhone(phone)}`, {
          httpStatus: result.httpStatus,
          providerStatus: result.providerStatus,
        });
      }
    },
  };
}
