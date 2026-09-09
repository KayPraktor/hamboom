import { createHash, randomInt, timingSafeEqual } from "node:crypto";

/**
 * OTP + درگاهِ پیامک — [ADR-011](../../../ARCHITECTURE_DECISIONS.md#adr-011).
 *
 * ★ **P7 — کد هرگز خام ذخیره یا لاگ نمی‌شود:** فقط **هش**ش در store می‌ماند، و منطق آن را به هیچ
 * loggerی نمی‌دهد؛ تنها مقصدِ کدِ خام `SmsProvider.send` است. شماره در پیام/لاگ **ماسک** می‌شود.
 * ★ **ضدِ enumeration:** `requestOtp` همیشه موفق است (نبودِ کاربر لو نمی‌رود).
 */

export interface OtpRecord {
  /** هشِ کد — خام هرگز. */
  codeHash: string;
  attempts: number;
  /** unix seconds. */
  expiresAt: number;
  createdAt: number;
}

export interface OtpStore {
  get(phone: string): Promise<OtpRecord | null>;
  set(phone: string, record: OtpRecord): Promise<void>;
  delete(phone: string): Promise<void>;
  incrementAttempts(phone: string): Promise<void>;
}

/**
 * درگاهِ پیامک — `MockProvider` در dev، و یک سرویسِ ایرانیِ واقعی در production.
 *
 * ★ `name`/`developmentOnly` عمداً **اجباری**اند و دقیقاً مثلِ `PaymentGateway` (M4):
 * تنها راهی که یک پیاده‌سازیِ آینده نتواند بی‌صدا از گیتِ production رد شود، این است که
 * مجبور باشد خودش را معرفی کند.
 */
export interface SmsProvider {
  /** نامِ خوانا — فقط برای پیامِ خطا و لاگ. */
  readonly name: string;
  /** ★★ `true` یعنی این پیاده‌سازی در `APP_ENV=production` **بالا نمی‌آید** (ADR-031). */
  readonly developmentOnly: boolean;
  send(phone: string, code: string): Promise<void>;
}

/** وقتی درگاهِ پیامک در محیطِ اشتباه سیم‌کشی شود. */
export class SmsProviderNotAllowedError extends Error {
  constructor(providerName: string, appEnv: string) {
    super(
      `درگاهِ پیامکِ «${providerName}» فقط برای توسعه است و در محیطِ «${appEnv}» بالا نمی‌آید ` +
        "(ADR-031). یک سرویسِ پیامکِ واقعی سیم‌کشی کن یا APP_ENV را درست بگذار.",
    );
    this.name = "SmsProviderNotAllowedError";
  }
}

/**
 * ★★ گیتی که نبودنش یعنی **هیچ کاربرِ واقعی نمی‌تواند وارد شود** — و کدِ ورود در لاگِ
 * سرور می‌نشیند.
 *
 * ⚠️ این نقص در M5 فاز ۲ با یک اجرای واقعی پیدا شد: کلِ استک با `APP_ENV=production`
 * بالا آمد و کدِ OTP از **لاگِ سرور** خوانده شد. `MockSmsProvider` هیچ پیامکی نمی‌فرستد،
 * پس در production نه فقط ناامن است — **بی‌فایده** است.
 *
 * ⚠️ **پیامدِ عمدی:** تا وقتی یک سرویسِ پیامکِ واقعی سیم‌کشی نشود، `APP_ENV=production`
 * اصلاً بالا نمی‌آید. دقیقاً مثلِ گیتِ `MockGateway` در M4 — و به همان دلیل.
 */
export function assertSmsProviderAllowed(sms: SmsProvider, appEnv: string): void {
  if (sms.developmentOnly && appEnv === "production") {
    throw new SmsProviderNotAllowedError(sms.name, appEnv);
  }
}

export interface OtpConfig {
  /** عمرِ کد (ثانیه). */
  ttlSeconds: number;
  maxAttempts: number;
  /** حداقل فاصله‌ی بین دو `requestOtp` برای یک شماره (ضدِ spam). */
  cooldownSeconds: number;
  clock?: () => number;
  /** ★ کدِ ثابتِ توسعه — فقط اگر داده شود (`OTP_DEV_FIXED_CODE`، `APP_ENV=local`). وگرنه تصادفی. */
  fixedCode?: string;
}

const sha256hex = (s: string): string => createHash("sha256").update(s).digest("hex");
const nowSeconds = (clock?: () => number): number => Math.floor((clock?.() ?? Date.now()) / 1000);
const genCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, "0");

/** ماسکِ شماره برای لاگ/پیام (P7): چهار رقمِ اول، دو رقمِ آخر، بینشان `***`. */
export function maskPhone(phone: string): string {
  if (phone.length <= 6) return "***";
  return `${phone.slice(0, 4)}***${phone.slice(-2)}`;
}

/**
 * درخواستِ OTP — ★ **همیشه موفق** (ضدِ enumeration). کد hash می‌شود، خام فقط به `sms.send` می‌رود.
 * cooldown مانعِ spam است ولی خطا نمی‌دهد (وگرنه enumeration).
 */
export async function requestOtp(
  store: OtpStore,
  sms: SmsProvider,
  phone: string,
  config: OtpConfig,
): Promise<void> {
  const now = nowSeconds(config.clock);
  const existing = await store.get(phone);
  if (existing !== null && now - existing.createdAt < config.cooldownSeconds) return; // cooldown، بی‌صدا

  const code = config.fixedCode ?? genCode();
  await store.set(phone, {
    codeHash: sha256hex(code),
    attempts: 0,
    expiresAt: now + config.ttlSeconds,
    createdAt: now,
  });
  try {
    await sms.send(phone, code); // ★ تنها جایی که کدِ خام می‌رود — هرگز به logger.
  } catch (error) {
    /**
     * ★★ اگر ارسال نشد، چالش را **پس بگیر** — M5 فازِ ۴٫۵.
     *
     * ⚠️ این نقص تا امروز **غیرقابلِ‌رسیدن** بود: تنها فرستنده `MockSmsProvider` بود که
     * هرگز شکست نمی‌خورد. با فرستنده‌ی واقعی مسیرش باز می‌شود، و شکلش بد است —
     * ردیفِ چالش **پیش از** ارسال ذخیره می‌شود، پس یک شکستِ گذرا (اعتبارِ تمام‌شده،
     * timeout) کاربر را برای کلِ `cooldownSeconds` در حالتی می‌گذاشت که هر تلاشِ
     * دوباره **بی‌صدا رد می‌شود** و هیچ پیامکی هم نیامده. یعنی «کد نیامد، دوباره
     * بزن» هم جواب نمی‌داد.
     *
     * ⊕ cooldown را تضعیف نمی‌کند: فقط وقتی پاک می‌شود که ارسال **شکست خورده** باشد،
     * و مهاجم نمی‌تواند شکستِ فرستنده را به‌دلخواه بسازد.
     */
    await store.delete(phone).catch(() => undefined);
    throw error;
  }
}

export type OtpResult =
  { ok: true } | { ok: false; reason: "no_challenge" | "expired" | "locked" | "mismatch" };

/** اعتبارسنجیِ OTP — تطبیقِ زمان‌ثابت، سقفِ تلاش، انقضا. موفق → چالش حذف می‌شود. */
export async function verifyOtp(
  store: OtpStore,
  phone: string,
  code: string,
  config: OtpConfig,
): Promise<OtpResult> {
  const record = await store.get(phone);
  const now = nowSeconds(config.clock);
  if (record === null) return { ok: false, reason: "no_challenge" };
  if (record.expiresAt <= now) {
    await store.delete(phone);
    return { ok: false, reason: "expired" };
  }
  if (record.attempts >= config.maxAttempts) return { ok: false, reason: "locked" };

  if (!timingSafeEqualHex(record.codeHash, sha256hex(code))) {
    await store.incrementAttempts(phone);
    return { ok: false, reason: "mismatch" };
  }

  await store.delete(phone);
  return { ok: true };
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * MockProvider — ★ کد را در ترمینال چاپ می‌کند (فقط dev، P3: بدونِ حسابِ پیامکِ واقعی). شماره
 * **ماسک** است. در production کاوه‌نگار با سوییچِ env می‌آید (فاز ۵). `sink` تزریق‌پذیر برای تست.
 */
export function createMockSmsProvider(sink?: (phone: string, code: string) => void): SmsProvider {
  return {
    name: "mock",
    developmentOnly: true,
    send(phone, code) {
      // ⚠️ چاپِ کد فقط در MockProviderِ **dev** است (بدونِ حسابِ پیامکِ واقعی، P3)؛ `warn` تنها
      //    متدِ مجازِ console است و اینجا معنایش «این mock است، نه پیامکِ واقعی» را هم می‌رساند.
      if (sink) sink(phone, code);
      else console.warn(`[SMS mock — فقط dev] → ${maskPhone(phone)}: کدِ ورود ${code}`);
      return Promise.resolve();
    },
  };
}

/** نمونه‌ی حافظه‌ای برای تست — پیاده‌سازیِ DB (`otp_challenges`) فاز ۵. */
export function createMemoryOtpStore(): OtpStore {
  const map = new Map<string, OtpRecord>();
  return {
    get: (p) => Promise.resolve(map.get(p) ?? null),
    set: (p, r) => {
      map.set(p, { ...r });
      return Promise.resolve();
    },
    delete: (p) => {
      map.delete(p);
      return Promise.resolve();
    },
    incrementAttempts: (p) => {
      const r = map.get(p);
      if (r) r.attempts++;
      return Promise.resolve();
    },
  };
}
