/**
 * زمان‌بندیِ تلاشِ دوباره — نمایی، با سقف، و **با jitter**.
 *
 * عمداً یک تابعِ خالص و بدونِ حالت است: تصمیمِ «چند ثانیه صبر کنم» جدا از
 * ماشینِ حالتِ سوکت آزموده می‌شود، و معیارِ پذیرشِ گام ۵٫۱ («فاصله‌ها
 * **اندازه‌گیری** شوند، نه ادعا») روی همین تابع هم قابلِ اجراست و هم روی سیمِ
 * واقعی.
 *
 * ── ★★ چرا jitter اختیاری نیست ────────────────────────────────────────
 *
 * سناریوی واقعیِ ADR-006: یک نود می‌رود، **همه‌ی** کلاینت‌هایش هم‌زمان قطع
 * می‌شوند. بدونِ jitter هر کدام دقیقاً همان فاصله را می‌شمارند و در یک لحظه
 * برمی‌گردند — یعنی نودی که تازه بالا آمده، اولین کاری که می‌بیند یک رگبارِ
 * هم‌زمانِ بارگذاریِ اتاق است. دوباره می‌افتد، و چرخه تکرار می‌شود.
 * **backoffِ بدونِ jitter مسئله را به تعویق می‌اندازد، حل نمی‌کند.**
 *
 * ── ★ چرا «jitterِ نیمه» و نه «jitterِ کامل» ───────────────────────────
 *
 * jitterِ کامل (تصادفی در `[۰، سقف]`) پخش‌شدگیِ بیشتری می‌دهد ولی می‌تواند
 * فاصله را به **صفر** برساند — یعنی همان نودی که هنوز بالا نیامده، بلافاصله
 * دوباره کوبیده می‌شود. اینجا نصفِ فاصله **کف** است و نصفِ دیگر تصادفی:
 * `delay ∈ [ceiling/2, ceiling]`. پخش‌شدگیِ ۲ برابری کافی است و کف حفظ می‌شود.
 */

export interface BackoffOptions {
  /** فاصله‌ی اولین تلاش. */
  baseMs?: number;
  /** سقفِ فاصله — بدونِ آن، تلاشِ بیستم ماه‌ها بعد است. */
  maxMs?: number;
  /** ضریبِ رشد. */
  factor?: number;
  /** سهمِ تصادفیِ فاصله، بین ۰ و ۱. `۰` یعنی **بدونِ** jitter (فقط برای تست). */
  jitter?: number;
  /** منبعِ تصادف — تزریق‌پذیر تا تست قطعی باشد. */
  random?: () => number;
}

/** پیش‌فرض‌های اتصالِ مجدد — نیم‌ثانیه تا سی‌ثانیه. */
export const RECONNECT_BACKOFF = {
  baseMs: 500,
  maxMs: 30_000,
  factor: 2,
  jitter: 0.5,
} as const;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * سقفِ فاصله برای تلاشِ `attempt` — **بدونِ** jitter.
 *
 * جدا صادر می‌شود چون هم تستِ رشدِ نمایی به آن نیاز دارد و هم سنجه‌ی زنده:
 * ادعای «فاصله‌ها jitter دارند» فقط وقتی معنا دارد که بدانیم از **چه چیزی**
 * منحرف شده‌اند.
 */
export function backoffCeilingMs(attempt: number, options: BackoffOptions = {}): number {
  const baseMs = options.baseMs ?? RECONNECT_BACKOFF.baseMs;
  const maxMs = options.maxMs ?? RECONNECT_BACKOFF.maxMs;
  const factor = options.factor ?? RECONNECT_BACKOFF.factor;
  // تلاشِ ۱ یعنی توانِ ۰. عددهای بی‌معنی (۰، منفی، اعشاری) به همان اول برمی‌گردند
  // تا یک باگِ صداکننده به یک فاصله‌ی منفی تبدیل نشود.
  const step = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1;
  // ⚠️ `factor ** بزرگ` به `Infinity` می‌رسد؛ `Math.min` همان‌جا به سقف می‌بُرد.
  return Math.min(maxMs, baseMs * factor ** (step - 1));
}

/**
 * فاصله‌ی واقعیِ تلاشِ `attempt` (از ۱ شروع می‌شود) — سقف منهای سهمِ تصادفی.
 *
 * ⚠️ `random()`ِ بدرفتار (بیرونِ `[۰،۱)`) نباید به فاصله‌ی منفی یا غول‌آسا
 * تبدیل شود؛ هر دو سرِ ورودی بریده می‌شوند.
 */
export function backoffDelayMs(attempt: number, options: BackoffOptions = {}): number {
  const ceiling = backoffCeilingMs(attempt, options);
  const share = clamp01(options.jitter ?? RECONNECT_BACKOFF.jitter);
  const roll = clamp01((options.random ?? Math.random)());
  return Math.round(ceiling * (1 - share * roll));
}
