import { ConfigError, type EnvSource } from "./load.ts";

/**
 * ★★ گاردهای بوتِ **production** — M5 گام ۴٫۱.
 *
 * ── چرا این‌جا و نه در zod ────────────────────────────────────────────────
 *
 * schemaها عمداً ترکیب‌پذیرند (هر اپ فقط بخشِ خودش را می‌خواهد)، ولی این قاعده‌ها
 * **بینِ بخش‌ها**اند: «رازِ ضعیف» به `APP_ENV` هم نگاه می‌کند، و «دیتابیسِ دور» هم به
 * `DATABASE_URL` و هم به `DATABASE_SSL`. یک `superRefine` روی یک بخش نمی‌تواند
 * بخشِ دیگری را ببیند.
 *
 * ── چرا **بوت** و نه هشدار ───────────────────────────────────────────────
 *
 * همان استدلالِ [ADR-031](../../../ARCHITECTURE_DECISIONS.md#adr-031) و
 * `assertGatewayAllowed`: یک هشدار در لاگِ یک سرویسِ زنده **دیده نمی‌شود**. تا فاز ۲،
 * کلِ `apps/api/src/plugins` فقط **یک** `throw` داشت.
 *
 * ★ همه‌ی تخلف‌ها **با هم** گزارش می‌شوند، نه یکی‌یکی — وگرنه اپراتور سه بار deploy
 * می‌کند تا سه ایراد را پیدا کند.
 */

/**
 * نشانه‌های متنیِ رازِ توسعه‌ای.
 *
 * ⚠️ همه **چندبخشی**اند و هیچ‌کدام در خروجیِ تصادفی (hex/base64) ظاهر نمی‌شوند — عمدی،
 * تا این گارد یک رازِ واقعی را قرمزِ **دروغ** نکند. یک نشانه‌ی تک‌کلمه‌ای مثلِ `test`
 * دقیقاً همان اشتباه بود.
 */
const DEV_SECRET_MARKERS = [
  "change_me",
  "changeme",
  "dev_only",
  "test_secret",
  "insecure",
  "your_",
  "example",
  "placeholder",
];

/**
 * حداقلِ تنوعِ کاراکترِ یک رازِ واقعی.
 *
 * ⚠️ عددش محافظه‌کارانه است تا **مثبتِ کاذب** ندهد: یک رازِ تصادفیِ ۳۲کاراکتریِ hex
 * حدودِ ۱۶ کاراکترِ متمایز دارد و base64 بیشتر. چیزی که این می‌گیرد، رازهای دستیِ
 * تکراری‌اند (`aaaa…`, `secret123secret123…`).
 */
const MIN_DISTINCT_CHARS = 8;

/**
 * متغیرهایی که فقط برای توسعه‌اند و **وجودشان** در production خطاست.
 *
 * ⚠️ هیچ‌کدام امروز مصرف‌کننده ندارند (`RT_DEV_JWT_SECRET` از M3 مرده است و
 * `OTP_DEV_FIXED_CODE` را `app.ts` فقط با `APP_ENV=local` می‌خواند). پس این گارد
 * درباره‌ی رفتار نیست — دربارهٔ **`.env`ی است که از روی dev کپی شده**، که همان‌جا
 * احتمالاً `JWT_SECRET`ِ dev را هم آورده.
 */
const DEV_ONLY_VARS = ["RT_DEV_JWT_SECRET", "OTP_DEV_FIXED_CODE"];

export class ProductionConfigError extends ConfigError {
  constructor(violations: readonly string[]) {
    super(
      [
        "‏[hamboom] پیکربندیِ production ایمن نیست؛ اجرا متوقف شد.",
        ...violations.map((v) => `  • ${v}`),
        "",
        "‏`.env.production.example` را ببین. برای توسعه `APP_ENV=local` یا `staging` بگذار.",
      ].join("\n"),
    );
    this.name = "ProductionConfigError";
  }
}

export interface ProductionGuardInput {
  APP_ENV: string;
  JWT_SECRET?: string;
  DATABASE_URL?: string;
  DATABASE_SSL?: boolean;
  /** M5 فازِ ۴٫۵ — فقط وقتی `smsir` است، کلید هم سنجیده می‌شود. */
  SMS_PROVIDER?: string;
  SMS_IR_API_KEY?: string;
  /** M5 گام ۹٫۲ — فقط `apps/api` می‌فرستدش؛ بقیه‌ی مصرف‌کننده‌ها ندارند و سنجیده نمی‌شوند. */
  TRUST_PROXY?: boolean;
}

/** آیا این راز بوی پیش‌فرضِ توسعه می‌دهد؟ (بدونِ لو دادنِ خودِ مقدار) */
export function weakSecretReason(secret: string): string | null {
  const lower = secret.toLowerCase();
  const marker = DEV_SECRET_MARKERS.find((m) => lower.includes(m));
  if (marker !== undefined) return `نشانه‌ی رازِ توسعه‌ای «${marker}» را دارد`;
  const distinct = new Set(secret).size;
  if (distinct < MIN_DISTINCT_CHARS) {
    return `فقط ${String(distinct)} کاراکترِ متمایز دارد (حداقل ${String(MIN_DISTINCT_CHARS)})`;
  }
  return null;
}

/**
 * آیا میزبانِ دیتابیس **بیرونِ** همین ماشین/شبکه‌ی compose است؟
 *
 * قاعده: loopback یا نامِ **تک‌بخشی** (مثلِ `postgres` — نامِ سرویس در شبکه‌ی داخلیِ
 * compose) یعنی محلی؛ هر نامِ نقطه‌دار یا IP یعنی اتصال از این ماشین بیرون می‌رود.
 *
 * ⚠️ **این یک اثبات نیست، یک گارد است.** یک نامِ تک‌بخشی هم می‌تواند به میزبانِ دور
 * resolve شود. ولی حالتِ خطرناکِ **واقعی** — کسی `DATABASE_URL` را به PostgreSQLِ
 * Managedِ آروان می‌بَرد و `DATABASE_SSL` را یادش می‌رود — دقیقاً همین را می‌شکند.
 * ⊕ و [ADR-059](../../../ARCHITECTURE_DECISIONS.md#adr-059) یعنی چیدمانِ امروزِ ما
 * (`postgres` در همان compose، بدونِ پورتِ هاست) بدونِ TLS هم درست است — پس یک قاعده‌ی
 * «همیشه SSL» استقرارِ خودمان را روزِ اول می‌شکست.
 */
export function isRemoteDatabaseHost(databaseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    // آدرسِ نامفهوم را «دور» می‌شماریم: fail-closed.
    return true;
  }
  const bare = host.replace(/^\[|\]$/g, "");
  if (bare === "localhost" || bare === "127.0.0.1" || bare === "::1") return false;
  return bare.includes(".") || bare.includes(":");
}

/**
 * گاردهای production را اجرا می‌کند. بیرون از `APP_ENV=production` **کاری نمی‌کند**.
 *
 * `raw` برای بررسیِ **وجودِ** متغیرهای dev-only است (که در هیچ schemaی production
 * نیستند، پس در شیءِ تجزیه‌شده دیده نمی‌شوند).
 */
export function assertProductionConfig(
  input: ProductionGuardInput,
  raw: EnvSource = process.env,
): void {
  if (input.APP_ENV !== "production") return;

  const violations: string[] = [];

  if (input.JWT_SECRET !== undefined) {
    const reason = weakSecretReason(input.JWT_SECRET);
    if (reason !== null) violations.push(`JWT_SECRET برای production ضعیف است — ${reason}`);
  }

  if (input.DATABASE_URL !== undefined && input.DATABASE_SSL === false) {
    if (isRemoteDatabaseHost(input.DATABASE_URL)) {
      violations.push(
        "DATABASE_SSL=false است ولی میزبانِ دیتابیس بیرونِ این ماشین/شبکه‌ی compose به‌نظر می‌رسد " +
          "⇒ رمزِ عبور و کلِ ترافیک روی شبکه رمزنشده می‌رود. یا DATABASE_SSL=true بگذار یا دیتابیس را کنارِ اپ بیاور",
      );
    }
  }

  for (const name of DEV_ONLY_VARS) {
    const value = raw[name];
    if (value !== undefined && value.length > 0) {
      violations.push(
        `${name} فقط برای توسعه است و در production نباید تعریف شود ` +
          "(نشانه‌ی یک .envِ کپی‌شده از dev)",
      );
    }
  }

  /**
   * ★ کلیدِ sms.ir — M5 فازِ ۴٫۵.
   *
   * ⚠️ همان سناریوی `.env`ِ کپی‌شده از dev، ولی این‌بار پیامدش خاص است: کلیدِ
   * جای‌نگه‌دار **در بوت نمی‌شکند** (رشته‌ی ناتهی است)، سرور بالا می‌آید، و تازه
   * اولین کاربرِ واقعی می‌فهمد که هیچ پیامکی نمی‌آید. پس همان‌جایی گرفته می‌شود که
   * بقیه‌ی رازهای ضعیف گرفته می‌شوند.
   *
   * ⊕ فقط با `SMS_PROVIDER=smsir` معنا دارد؛ با `mock` کلید اصلاً خوانده نمی‌شود.
   */
  if (input.SMS_PROVIDER === "smsir" && input.SMS_IR_API_KEY !== undefined) {
    const reason = weakSecretReason(input.SMS_IR_API_KEY);
    if (reason !== null) {
      violations.push(`SMS_IR_API_KEY جای‌نگه‌دار به‌نظر می‌رسد — ${reason}`);
    }
  }

  /**
   * ★★ `TRUST_PROXY` — M5 گام ۹٫۲.
   *
   * در چیدمانِ ADR-059 هیچ درخواستی بدونِ عبور از nginx به api نمی‌رسد، پس IPِ سوکت
   * همیشه nginx است. با `TRUST_PROXY=false` سقفِ نرخ **کلِ سایت را یک کاربر** می‌بیند
   * (اندازه‌گیری‌شده). این نه «ضعیف» است نه «ناامن» — فقط در production **غلط** است.
   */
  if (input.TRUST_PROXY === false) {
    violations.push(
      "TRUST_PROXY=false است ولی در production هر درخواست از nginx می‌آید ⇒ سقفِ نرخ روی " +
        "IPِ nginx کلید می‌خورد و همه‌ی کاربران یک سطل دارند. TRUST_PROXY=true بگذار",
    );
  }

  if (violations.length > 0) throw new ProductionConfigError(violations);
}
