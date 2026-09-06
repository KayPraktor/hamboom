import { z } from "zod";

/**
 * بخش‌های schema متغیرهای محیطی — PLAN.md بخش ۴.
 *
 * عمداً **ترکیب‌پذیر** است، نه یک schema بزرگِ واحد: هر اپ فقط بخش‌هایی را که
 * مصرف می‌کند لازم دارد. اگر یک schema واحد بود، `apps/realtime` برای بالا آمدن
 * مجبور بود `ZARINPAL_MERCHANT_ID` هم داشته باشد — و آن‌وقت اولین کاری که کسی
 * می‌کند این است که یک مقدارِ الکی بگذارد تا رد شود، و از آن به بعد گیت مرده است.
 *
 * M3/M4 بخش‌های خودشان (S3، احراز هویت، پیامک، زرین‌پال) را از PLAN بخش ۴
 * همین‌جا اضافه می‌کنند.
 */

/**
 * بولینِ محیطی.
 *
 * `Boolean("false") === true` است، پس `z.coerce.boolean()` برای متغیرِ محیطی
 * **غلط** است و بی‌صدا هر مقداری را `true` می‌کند. اینجا فقط دو رشته‌ی صریح.
 */
function envBoolean(defaultValue: "true" | "false") {
  return z
    .enum(["true", "false"])
    .default(defaultValue)
    .transform((value) => value === "true");
}

/**
 * عددِ صحیحِ **صفرپذیر** از رشته‌ی محیطی.
 *
 * ⚠️ `envInt` عمداً `positive()` است و مقدارِ `0` را **رد** می‌کند. ولی `VAT_PERCENT=0`
 * پیش‌فرضِ توسعه است ([ADR-052](../../../ARCHITECTURE_DECISIONS.md#adr-052)/M4-D6) و باید
 * بالا بیاید — پس هر آستانه‌ای که صفرش معنادار است باید از این بیاید، نه از `envInt`.
 */
function envIntFromZero(defaultValue: number) {
  return z.coerce.number().int().min(0).default(defaultValue);
}

/** عددِ صحیحِ مثبت از رشته‌ی محیطی. */
function envInt(defaultValue: number) {
  return z.coerce.number().int().positive().default(defaultValue);
}

/** ── عمومی ─────────────────────────────────────────────────────────── */
export const appEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /**
   * ★ محیطِ منطقیِ اپ — با `NODE_ENV` یکی نیست.
   *
   * گیتِ [ADR-031](../../../ARCHITECTURE_DECISIONS.md#adr-031) روی **همین** می‌نشیند:
   * با `production`، پیاده‌سازی‌های dev (مثلِ `DevBoardAuthority`) نباید بالا بیایند.
   */
  APP_ENV: z.enum(["local", "staging", "production"]).default("local"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});
export type AppEnv = z.infer<typeof appEnvSchema>;

/** ── PostgreSQL ────────────────────────────────────────────────────── */
export const databaseEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "باید یک رشته‌ی اتصالِ معتبرِ postgres باشد"),
  DATABASE_SSL: envBoolean("false"),
  DATABASE_POOL_MAX: envInt(20),
});
export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;

/** ── Redis ─────────────────────────────────────────────────────────── */
export const redisEnvSchema = z.object({
  REDIS_URL: z.string().min(1, "باید یک رشته‌ی اتصالِ معتبرِ redis باشد"),
  REDIS_TLS: envBoolean("false"),
});
export type RedisEnv = z.infer<typeof redisEnvSchema>;

/** ── Realtime (M2) ─────────────────────────────────────────────────── */
export const realtimeEnvSchema = z.object({
  RT_PORT: envInt(3001),
  RT_MAX_ROOMS_PER_NODE: envInt(500),
  RT_ROOM_IDLE_TIMEOUT_MS: envInt(120_000),
  /** باید **کوتاه‌تر** از idle timeoutِ لودبالانسر باشد — ADR-006. */
  RT_HEARTBEAT_INTERVAL_MS: envInt(25_000),
  RT_SNAPSHOT_EVERY_UPDATES: envInt(500),
  RT_SNAPSHOT_EVERY_MS: envInt(60_000),
  /**
   * ریشه‌ی `FsSnapshotStore` (D-3) — جای Object Storage تا M3.
   *
   * ★ مسیرِ **لوکال** عمدی است (P3): توسعه نباید به حسابِ ابریِ واقعی نیاز
   * داشته باشد. با آمدنِ `packages/storage`، این متغیر جایش را به تنظیماتِ
   * S3 می‌دهد و خودش می‌رود.
   */
  RT_SNAPSHOT_DIR: z.string().min(1).default(".hamboom/snapshots"),
  /** سقفِ سختِ حجمِ هر بورد — ریسکِ ثبت‌شده در PLAN بخش ۱۰. */
  RT_MAX_DOC_BYTES: envInt(52_428_800),
});
export type RealtimeEnv = z.infer<typeof realtimeEnvSchema>;

/**
 * ── احراز هویتِ توسعه‌ای ────────────────────────────────────────────
 *
 * ★ فقط تا وقتی M3 نیامده ([ADR-031](../../../ARCHITECTURE_DECISIONS.md#adr-031)).
 * حداقلِ ۳۲ کاراکتر الزامی است تا کسی در محیطِ مشترک با یک کلیدِ کوتاه توکن جعل نکند.
 */
export const devAuthEnvSchema = z.object({
  RT_DEV_JWT_SECRET: z.string().min(32, "حداقل ۳۲ کاراکتر لازم است"),
});
export type DevAuthEnv = z.infer<typeof devAuthEnvSchema>;

/**
 * ── Object Storage سازگار با S3 (M3، `packages/storage`) ─────────────────
 *
 * سوییچِ MinIO↔آروان **فقط** با همین env (P4، PLAN §۴): endpoint و کلیدها عوض
 * می‌شوند، ولی `S3_REGION` و `S3_FORCE_PATH_STYLE` روی آروان هم همان می‌مانند.
 *
 * ⚠️ **`S3_FORCE_PATH_STYLE` متغیرِ مستقل است، نه ثابت** ([ADR-013](../../../ARCHITECTURE_DECISIONS.md#adr-013)،
 * probe ۳٫۰): رفتارِ presign بین سرویس‌های S3 فرق می‌کند و MinIO این را لازم دارد.
 *
 * فقط بخشِ **دارای مصرف‌کننده در M3** است (خط‌قرمزِ این پکیج): connection + TTL +
 * دو باکتِ `snapshots` (گام ۳٫۲) و `assets` (گام ۳٫۳). `S3_BUCKET_EXPORTS` و
 * `S3_PUBLIC_BASE_URL` عمداً نیامده‌اند تا مصرف‌کننده‌شان (worker/CDN، بعد از M3) بیاید.
 */
export const s3EnvSchema = z.object({
  S3_ENDPOINT: z.string().min(1, "endpointِ S3 لازم است (لوکال: http://localhost:9000)"),
  S3_REGION: z.string().min(1).default("ir-thr-at1"),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: envBoolean("true"),
  /** TTLِ پیش‌فرضِ URLهای امضاشده (presignGet/presignUpload) — ثانیه. */
  S3_PRESIGN_TTL_SECONDS: envInt(900),
  S3_BUCKET_ASSETS: z.string().min(1).default("hamboom-assets"),
  S3_BUCKET_SNAPSHOTS: z.string().min(1).default("hamboom-snapshots"),
});
export type S3Env = z.infer<typeof s3EnvSchema>;

/**
 * ── احراز هویتِ M3 (`apps/api` فاز ۵) ───────────────────────────────────
 *
 * ★ رازِ HS256 (PLAN §۴): auth-core آن را **param** می‌گیرد، از `process.env` نمی‌خواند. حداقلِ ۳۲
 * کاراکتر تا کسی با کلیدِ کوتاه توکن جعل نکند. TTLها ثانیه‌اند و از **یک** signer می‌آیند (قفلِ exp).
 */
export const authEnvSchema = z.object({
  JWT_SECRET: z.string().min(32, "حداقل ۳۲ کاراکتر لازم است (رازِ HS256)"),
  /** عمرِ access token (JWT) — پیش‌فرض ۱۵ دقیقه. */
  ACCESS_TOKEN_TTL_SECONDS: envInt(900),
  /** عمرِ refresh token — پیش‌فرض ۳۰ روز. */
  REFRESH_TOKEN_TTL_SECONDS: envInt(2_592_000),
  /** عمرِ rt-tokenِ WS — پیش‌فرض ۶۰ ثانیه (سقفِ آینده ۲× همین است). */
  RT_TOKEN_TTL_SECONDS: envInt(60),
});
export type AuthEnv = z.infer<typeof authEnvSchema>;

/**
 * ── OTP (`apps/api` فاز ۵) ──────────────────────────────────────────────
 *
 * ★ کد hash می‌شود و هرگز لاگ نمی‌شود (P7)؛ اینجا فقط سیاستِ زمان/تلاش/cooldown. `OTP_DEV_FIXED_CODE`
 * فقط برای dev است — اگر ندهی، کد **تصادفی** است و از لاگِ MockSms خوانده می‌شود.
 */
export const otpEnvSchema = z.object({
  OTP_TTL_SECONDS: envInt(120),
  OTP_MAX_ATTEMPTS: envInt(5),
  OTP_COOLDOWN_SECONDS: envInt(60),
  /** کدِ ثابتِ dev (اختیاری) — فقط وقتی `APP_ENV=local`. وگرنه تصادفی. */
  OTP_DEV_FIXED_CODE: z.string().regex(/^\d{6}$/, "باید ۶ رقم باشد").optional(),
});
export type OtpEnv = z.infer<typeof otpEnvSchema>;

/**
 * ── پورتِ سرورِ `apps/api` ───────────────────────────────────────────────
 *
 * ★ نامش عمداً `PORT` است (نه `API_PORT`): ابزارهای میزبانی/preview پورتِ آزاد را با متغیرِ
 * استانداردِ `PORT` تزریق می‌کنند. پیش‌فرض ۳۰۰۲ (کنارِ realtimeِ ۳۰۰۱) برای اجرای دستی.
 * چون فقط `config` حق خواندنِ `process.env` را دارد، server.ts پورت را از این‌جا می‌گیرد نه مستقیم.
 */
export const apiServerEnvSchema = z.object({
  PORT: envInt(3002),
});
export type ApiServerEnv = z.infer<typeof apiServerEnvSchema>;

/**
 * ── محدودیتِ نرخِ `apps/api` ─────────────────────────────────────────────
 *
 * ⚠️ store پیش‌فرض **حافظه‌ای** است (تک‌نود). چندنودی → Redis (فاز بعد). سقفِ OTP سخت‌تر است چون
 * درخواستِ OTP پیامک می‌فرستد (هزینه) و سطحِ حمله‌ی enumeration/spam دارد.
 */
export const rateLimitEnvSchema = z.object({
  RATE_LIMIT_MAX: envInt(100),
  RATE_LIMIT_WINDOW_SECONDS: envInt(60),
  RATE_LIMIT_OTP_MAX: envInt(5),
});
export type RateLimitEnv = z.infer<typeof rateLimitEnvSchema>;

/**
 * ── سقفِ آپلودِ دارایی (`apps/api` فاز ۵) ─────────────────────────────────
 *
 * ★ کفِ مطلقِ سراسریِ سمتِ سرور برای هر آپلود. presign علاوه بر این یک سقفِ **تنگ‌تر per-file**
 * (اندازه‌ی اعلامیِ همان فایل) روی policyِ POST می‌گذارد که MinIO سمتِ سرور اعمالش می‌کند (probe ۳٫۰)؛
 * این عدد سقفی است که اعلامِ کلاینت هم از آن بالاتر نمی‌رود. پیش‌فرض ۱۰MB.
 */
export const uploadEnvSchema = z.object({
  UPLOAD_MAX_BYTES: envInt(10 * 1024 * 1024),
});
export type UploadEnv = z.infer<typeof uploadEnvSchema>;

/**
 * ── پرداخت و اشتراک (`apps/api` — M4 فاز ۳) ────────────────────────────
 *
 * ★★ **پیش‌فرضِ `PAYMENT_PROVIDER` عمداً `mock` است، نه `zarinpal`** — انحرافِ ثبت‌شده از
 * [PLAN §۴](../../../PLAN.md) (M4-D5، [ADR-049](../../../ARCHITECTURE_DECISIONS.md#adr-049)).
 * سندباکسِ زرین‌پال یک سرویسِ **خارجی روی اینترنت** است؛ پیش‌فرض‌کردنش یعنی ماشینِ آفلاین و
 * CIِ بدونِ egress جریانِ پرداختِ مرده دارند — نقضِ P2 و P3.
 *
 * ⚠️ **فیلدهای زرین‌پال عمداً `optional`اند.** اگر `ZARINPAL_MERCHANT_ID` را اجباری کنیم،
 * `pnpm dev` یک merchantِ واقعی می‌خواهد و اولین کاری که هرکس می‌کند گذاشتنِ یک مقدارِ الکی
 * است — و از آن به بعد گیت مرده است (همان هشدارِ سرِ این فایل). اعتبارسنجیِ واقعی‌شان
 * هنگامِ **ساختِ `ZarinpalGateway`** انجام می‌شود، آن هم فقط وقتی provider واقعاً زرین‌پال باشد.
 */
export const paymentEnvSchema = z.object({
  PAYMENT_PROVIDER: z.enum(["mock", "zarinpal"]).default("mock"),
  ZARINPAL_MODE: z.enum(["sandbox", "production"]).default("sandbox"),
  ZARINPAL_MERCHANT_ID: z.string().optional(),
  /**
   * ★ `literal` است نه `enum`: درگاه `IRT` (تومان) را هم می‌پذیرد و اشتباهش یعنی ضریبِ ۱۰
   * روی هر تراکنش (P5). این‌طوری کسی نمی‌تواند با یک متغیرِ محیطی عوضش کند.
   */
  ZARINPAL_CURRENCY: z.literal("IRR").default("IRR"),
  /**
   * ⚠️ **مسیر باید دقیقاً همان مسیرِ ثبت‌شده باشد: `/billing/zarinpal/callback`** — بدونِ
   * `/api/v1`. پیش‌فرضِ اولیه پیشوند داشت و هیچ‌جای api چنین پیشوندی ثبت نمی‌کند؛ یعنی
   * درگاه کاربر را بعد از **پرداختِ واقعی** به یک ۴۰۴ می‌فرستاد و تسویه فقط با
   * آشتی‌دهی (فاز ۷) نجات پیدا می‌کرد. `registerBillingRoutes` حالا در **بوت** می‌شکند
   * اگر این مسیر با route نخوانَد.
   */
  ZARINPAL_CALLBACK_URL: z.url().default("http://localhost:3002/billing/zarinpal/callback"),
  /**
   * ⚠️ **پیش‌فرض صفر، و این یک تصمیمِ حقوقی است نه فنی** (M4-D6): تا وقتی روشن نشده که
   * هم‌بوم در نظامِ مالیاتی ثبت شده و حق دارد VAT بگیرد، عددِ امن صفر است. نرخِ هر فاکتور
   * هنگامِ صدور روی **خودِ فاکتور** منجمد می‌شود، نه بازمحاسبه از این مقدار.
   */
  VAT_PERCENT: envIntFromZero(0),
  /** ریشه‌ی اپِ وب — بازگشت از درگاه به این‌جا ریدایرکت می‌شود (نه به خودِ api). */
  WEB_BASE_URL: z.url().default("http://localhost:5173"),

  /**
   * ── آشتی‌دهی (M4 فاز ۷، ADR-051/ADR-056) ─────────────────────────────
   *
   * ⚠️ **پیش‌فرض خاموش، و این عمدی است.** یک کارِ بازه‌ای که خودش را در هر نود بالا
   * می‌آورد، در استقرارِ چندنودی چند بار هم‌زمان اجرا می‌شود. ایمن **هست** (قفلِ ردیفِ
   * ADR-050 دو تسویه‌ی هم‌زمان را سریالی می‌کند و سنجه‌اش هم همین را اثبات می‌کند) ولی
   * اتلاف است؛ انتخابِ رهبر کارِ M5 است. تا آن‌وقت: `pnpm billing:reconcile`.
   */
  BILLING_RECONCILE_ENABLED: envBoolean("false"),
  BILLING_RECONCILE_INTERVAL_SECONDS: envInt(300),
  /**
   * ★ زیرِ این سن به هیچ ردیفی دست زده نمی‌شود. عددش از یک **مشاهده** می‌آید نه از
   * مستندات: در گام ۱٫۱ یک authorityِ پرداخت‌نشده بعد از ~۲۰ دقیقه منقضی شد.
   */
  BILLING_PENDING_STALE_MINUTES: envInt(20),
  /** بالای این سن **و فقط بعد از دستِ‌کم یک پرسش از درگاه**، ردیف باطل می‌شود. */
  BILLING_PENDING_EXPIRE_HOURS: envInt(72),
  BILLING_RECONCILE_BATCH: envInt(50),
  /**
   * ⚠️ **فرزندخواندگیِ ردیفِ یتیم — پیش‌فرض خاموش.** تنها گامِ آشتی‌دهی است که «حدس»
   * می‌زند کدام پرداختِ درگاه مالِ کدام ردیفِ ماست (فهرستِ `unVerified` شناسه‌ی سفارشِ ما
   * را ندارد). قاعده‌اش سخت است و هر ابهامی را رد می‌کند، ولی تا وقتی روی حسابِ واقعی
   * اثبات نشده، **عملِ آگاهانه‌ی اپراتور** است نه رفتارِ خودکار.
   */
  BILLING_ADOPT_ORPHANS: envBoolean("false"),
});
export type PaymentEnv = z.infer<typeof paymentEnvSchema>;
