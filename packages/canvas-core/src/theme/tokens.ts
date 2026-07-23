/**
 * توکن‌های ظاهری بوم.
 *
 * اینجا فقط چیزهایی هستند که **بوم** لازم دارد. توکن‌های دیزاین‌سیستم عمومی
 * (دکمه، مودال، فرم) جای دیگری‌اند — `packages/ui` در فاز بعد.
 *
 * ⚠️ همه‌ی فاصله‌ها منطقی‌اند، نه فیزیکی. هیچ `left`/`right` در این فایل نیست
 * ([ADR-016](../../../../ARCHITECTURE_DECISIONS.md#adr-016)).
 */

/** رنگ‌های رابط اطراف بوم. */
export const HB_UI_COLORS = {
  surface: "#FFFFFF",
  surfaceMuted: "#F7F8FA",
  border: "#E3E6EA",
  borderStrong: "#C7CCD3",
  text: "#1A1A1A",
  textMuted: "#6B7280",
  accent: "#5B8DEF",
  accentText: "#FFFFFF",
  danger: "#D14343",
  canvasBackground: "#FFFFFF",
  /** هاله‌ی انتخاب — رنگ هر همکار از `PeerState.user.color` می‌آید. */
  selection: "#5B8DEF",
} as const;

/**
 * ★ سه مقداری که تفاوت بصری اصلی با موتور پیش‌فرض را می‌سازند.
 *
 * Excalidraw ظاهر دست‌نویس دارد: خط لرزان (`roughness`)، پرکردن هاشوری
 * (`fillStyle`)، گوشه‌ی تیز. هم‌بوم استایل تمیز می‌خواهد. این سه مقدار همان
 * سوییچ‌اند — بقیه‌ی پالت و تایپوگرافی روی همین سوار می‌شوند.
 */
export const HB_LOOK = {
  /** ۰ = خط تمیز، ۱ و ۲ = دست‌نویس. */
  roughness: 0,
  /** پر یک‌دست، نه هاشور. */
  fillStyle: "solid",
  /** گوشه‌ی گرد پیش‌فرض. */
  roundnessType: 3,
} as const;

/** شعاع گوشه بر حسب پیکسل. */
export const HB_RADIUS = {
  sticky: 8,
  shape: 16,
  panel: 10,
  chip: 999,
} as const;

/** فاصله‌ها — مضرب چهار. */
export const HB_SPACE = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const HB_SHADOW = {
  panel: "0 2px 8px rgba(0, 0, 0, 0.08)",
  floating: "0 8px 24px rgba(0, 0, 0, 0.12)",
} as const;

/**
 * تایپوگرافی بوم.
 *
 * `lineHeight` عمداً ۱٫۶ است نه ۱٫۲۵ پیش‌فرض موتور: خط فارسی به‌خاطر
 * زیرنویس‌ها و اعراب به فضای عمودی بیشتری نیاز دارد و با ارتفاع کم، حروف
 * خطوط پشت‌سرهم به هم می‌چسبند.
 */
export const HB_TYPO = {
  lineHeight: 1.6,
  fontSizes: [12, 16, 20, 28, 36, 48] as const,
  defaultFontSize: 20,
  /** بازه‌ی مجاز `autoFit` استیکی. */
  stickyFontRange: { min: 12, max: 48 },
} as const;

/** اندازه‌ی پیش‌فرض عناصر هنگام ساخت. */
export const HB_SIZE = {
  sticky: { width: 220, height: 220 },
  shape: { width: 200, height: 120 },
  frame: { width: 800, height: 600 },
} as const;

/** فاصله‌ی چیدمان استیکی‌های پشت‌سرهم (رفتار Tab در گام ۳٫۲). */
export const HB_STICKY_GAP = 24;
