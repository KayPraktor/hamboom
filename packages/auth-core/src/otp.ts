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

/** درگاهِ پیامک — `MockProvider` در dev، کاوه‌نگار با سوییچِ env در production (فاز ۵، P2/P3). */
export interface SmsProvider {
  send(phone: string, code: string): Promise<void>;
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
  await sms.send(phone, code); // ★ تنها جایی که کدِ خام می‌رود — هرگز به logger.
}

export type OtpResult =
  | { ok: true }
  | { ok: false; reason: "no_challenge" | "expired" | "locked" | "mismatch" };

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
