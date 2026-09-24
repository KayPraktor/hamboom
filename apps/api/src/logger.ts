/**
 * پیکربندیِ لاگِ P7 — [ADR-020](../../../ARCHITECTURE_DECISIONS.md#adr-020).
 *
 * ★ **هیچ PII در لاگ.** آخرین سدِ دفاعی: pino هر مسیرِ حساس را به `[Redacted]` تبدیل
 * می‌کند. این جای «ماسک در منبع» را نمی‌گیرد (شماره با `maskPhone`، کدِ OTP اصلاً لاگ
 * نمی‌شود) — بلکه دفاعِ لایه‌ایِ دوم است برای وقتی چیزی سهواً لاگ شود.
 *
 * ⚠️ **fastify به‌صورت پیش‌فرض هدرها را لاگ نمی‌کند** (سریالایزرِ req فقط method/url)، ولی
 * اگر جایی `req.headers` یا شیئی با توکن صریحاً لاگ شود، این فهرست می‌گیردش. نگهبانش
 * `logger.test.ts` است که با یک نشتِ عمدی ثابت می‌کند redact **شلیک می‌کند**.
 *
 * ⚠️ **یکی‌شدن با نسخه‌ی realtime** (`apps/realtime/src/log.ts`) نیتِ «لیستِ مرکزی»ِ ADR-020
 * است؛ فعلاً اینجا، انتقال به یک ابزارِ مشترک یک گامِ آینده است (ثبت‌شده در PROGRESS).
 */
export const LOG_REDACT_PATHS = [
  // هدرهایی که توکن/کوکی حمل می‌کنند:
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  'req.headers["x-refresh-token"]',
  // دفاعِ لایه‌ای روی هر شیئی که صریح لاگ شود (یک سطح عمق):
  "*.authorization",
  "*.cookie",
  "*.password",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.refresh_token",
  "*.code", // کدِ OTP
  "*.otp",
  "*.codeHash",
  "*.code_hash",
  "*.secret",
  // ── M4 (billing) — شناسه‌های پرداخت هرگز در لاگ (P7) ──────────────────
  // ⚠️ `redact` فقط روی **propertyِ شیء** کار می‌کند، نه داخلِ template string. دو جای
  //    موجود (کدِ OTP در app.ts و توکنِ دعوت در routes/teams.ts) دقیقاً همین را دور می‌زنند
  //    و mockِ درگاه از رویشان کپی خواهد شد — پس آن‌جا باید **دستی** مواظب بود.
  "*.authority",
  "*.Authority",
  "*.refId",
  "*.ref_id",
  "*.cardPan",
  "*.card_pan",
  "*.cardHash",
  "*.card_hash",
  "*.merchantId",
  "*.merchant_id",
  // ⚠️ خطای یکتاییِ pg شناسه را داخلِ `detail` می‌آورد («Key (gateway, authority)=(…)»)
  //    و `errors.ts` کلِ `err` را لاگ می‌کند. این دو مسیر را می‌بندد.
  "*.detail",
  "*.where",
  // ── M6 فاز ۴ (ADR-067 §۳) — پیش از اولین نویسنده‌ی audit_logs ────────────────
  // ⚠️ ردیفِ audit `ip`/`user_agent` را **ذخیره می‌کند** (forensics) ولی نباید به لاگ برسد؛
  //    و `phone`/`email` تا امروز فقط با ماسکِ دستی محافظت می‌شدند. wildcard یک‌سطحی است، پس
  //    هر دو شکلِ camel/snake و هم سطحِ ریشه هم آمده. `req.remoteAddress`ِ fastify (لاگِ دسترسی)
  //    عمداً دست‌نخورده است — آن IPِ اتصال است، نه داده‌ی یک شخص در یک ردیفِ ممیزی.
  //    ⚠️ و یک سطحِ **دوم** (`*.*.ip`): `AuditEntry` شکلِ `{ actor: { ip } }` دارد و اگر کسی کلِ entry
  //    را لاگ کند، wildcardِ یک‌سطحی نمی‌گیردش — تستِ نشتِ عمدی دقیقاً همین را گرفت.
  ...["ip", "phone", "user_agent", "userAgent", "email"].flatMap((k) => [k, `*.${k}`, `*.*.${k}`]),
] as const;

export const LOG_REDACT_CENSOR = "[Redacted]";

/** `/x?y=z` → `/x` — query string هرگز به لاگِ دسترسی نمی‌رسد (M6 ۵٫۵: `?q=<شماره>` کاملِ یک شخص می‌شد). */
export const stripQuery = (url: string | undefined): string | undefined =>
  url === undefined ? undefined : url.split("?")[0];

/**
 * گزینه‌های loggerِ pino که fastify مصرف می‌کند — تنها منبعِ redact.
 *
 * ★ سریالایزرِ `req` همان فیلدهای پیش‌فرضِ fastify است، فقط `url` **بدونِ query string**: یافته‌ی بازبینیِ ۵٫۵
 * نشان داد `GET /admin/search?q=0912…` شماره‌ی کامل را در لاگِ api (و nginx) می‌نشانْد. جست‌وجو POST شد، ولی این
 * سد برای هر مسیرِ بعدی هم می‌مانَد؛ redact روی propertyها کار می‌کند نه داخلِ رشته‌ی url.
 */
export function loggerOptions(level: string): {
  level: string;
  redact: { paths: string[]; censor: string };
  serializers: {
    req: (req: {
      method?: string;
      url?: string;
      hostname?: string;
      ip?: string;
      socket?: { remotePort?: number };
    }) => Record<string, unknown>;
  };
} {
  return {
    level,
    redact: { paths: [...LOG_REDACT_PATHS], censor: LOG_REDACT_CENSOR },
    serializers: {
      req: (req) => ({
        method: req.method,
        url: stripQuery(req.url),
        host: req.hostname,
        remoteAddress: req.ip,
        remotePort: req.socket?.remotePort,
      }),
    },
  };
}
