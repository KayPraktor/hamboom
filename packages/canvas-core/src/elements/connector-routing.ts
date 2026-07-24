import type { HbConnectorStyle } from "@hamboom/shared-types";

/**
 * مسیریابی کانکتور — پیاده‌سازی [ADR-008](../../../../ARCHITECTURE_DECISIONS.md#adr-008).
 *
 * ── چرا این تابع باید قطعی باشد ───────────────────────────────────────
 *
 * مسیر کانکتور **حالت مشتق‌شده** است، نه ذخیره‌شده: هر کلاینت آن را از روی
 * هندسه‌ی دو سر حساب می‌کند، نه اینکه از شبکه بگیرد. اگر خروجی بین دو مرورگر
 * بیت‌به‌بیت یکسان نباشد، دو کاربر خط را در دو جای متفاوت می‌بینند و تصور
 * می‌کنند بورد خراب است.
 *
 * ── قواعد سخت برای حفظ قطعی بودن ──────────────────────────────────────
 *
 * 1. **بدون `Math.random`، بدون `Date`، بدون state پنهان.** ورودی یکسان همیشه
 *    خروجی یکسان.
 * 2. **فقط چهار عمل اصلی + `Math.round`.** این‌ها در IEEE 754 کاملاً مشخص‌اند و
 *    بین موتورهای جاوااسکریپت واگرا نمی‌شوند. `Math.hypot`, `Math.atan2`,
 *    `toFixed` **ممنوع‌اند** — مشخصاتشان فقط ۱ ULP دقت را الزام می‌کند، پس
 *    آخرین بیتشان بین مرورگرها می‌تواند فرق کند.
 * 3. **گرد کردن به ۲ رقم** با `Math.round(x * 100) / 100`، نه `toFixed` (که
 *    رشته می‌دهد و رفتار لبه‌اش ثابت نیست).
 *
 * `connector-routing.test.ts` این را با یک self-test از مقادیر pin‌شده می‌بندد:
 * اگر فرمول عوض شود یا روزی روی موتور دیگری خروجی فرق کند، فوراً لو می‌رود.
 */

export interface Point {
  x: number;
  y: number;
}

/** مستطیل محیطی یک عنصر — برای محاسبه‌ی نقطه‌ی اتصال روی لبه. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** گرد کردن قطعی به ۲ رقم اعشار. تنها راه مجاز گرد کردن در این فایل. */
export function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundPoint(p: Point): Point {
  return { x: roundTo2(p.x), y: roundTo2(p.y) };
}

/** مرکز یک جعبه. */
export function boxCenter(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * نقطه‌ی روی لبه‌ی جعبه که در راستای خطِ مرکز-به-هدف قرار دارد.
 *
 * به‌جای `atan2` (که دقت آخرین بیتش تضمین نیست)، از تقاطع پارامتری خط با
 * چهار لبه استفاده می‌شود — فقط ضرب و تقسیم، کاملاً قطعی.
 */
export function edgePoint(box: Box, toward: Point): Point {
  const center = boxCenter(box);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;

  if (dx === 0 && dy === 0) return roundPoint(center);

  const halfW = box.width / 2;
  const halfH = box.height / 2;

  // بزرگ‌ترین ضریب t که نقطه هنوز داخل مرز جعبه بماند.
  // t برای برخورد با لبه‌ی افقی و عمودی جدا حساب و کمینه گرفته می‌شود.
  const tx = dx === 0 ? Infinity : halfW / Math.abs(dx);
  const ty = dy === 0 ? Infinity : halfH / Math.abs(dy);
  const t = Math.min(tx, ty);

  return roundPoint({ x: center.x + dx * t, y: center.y + dy * t });
}

export interface RouteInput {
  /** جعبه‌ی مبدأ، یا نقطه‌ی آزاد اگر کانکتور به چیزی وصل نیست. */
  start: Box | Point;
  end: Box | Point;
  style: HbConnectorStyle;
}

function isBox(value: Box | Point): value is Box {
  return "width" in value && "height" in value;
}

/** نقطه‌ی اتصال یک سر — لبه‌ی جعبه، یا خود نقطه اگر آزاد است. */
function anchor(node: Box | Point, toward: Point): Point {
  return isBox(node) ? edgePoint(node, toward) : roundPoint(node);
}

/**
 * مسیر یک کانکتور را به‌صورت آرایه‌ی نقاط برمی‌گرداند.
 *
 * خروجی همیشه به ۲ رقم گرد است و برای ورودی یکسان بیت‌به‌بیت یکسان.
 *
 * - `straight` — دو نقطه، مستقیم بین دو لبه.
 * - `elbow` — مسیر پله‌ای (میرو-استایل): افقی سپس عمودی، با یک نقطه‌ی میانی.
 * - `curved` — همان نقاط `straight` با یک نقطه‌ی کنترل میانی که رندر منحنی
 *   از آن استفاده می‌کند (خود منحنی در لایه‌ی رندر کشیده می‌شود).
 */
export function routeConnector(input: RouteInput): Point[] {
  const { start, end, style } = input;

  const startCenter = isBox(start) ? boxCenter(start) : start;
  const endCenter = isBox(end) ? boxCenter(end) : end;

  const a = anchor(start, endCenter);
  const b = anchor(end, startCenter);

  if (style === "straight") {
    return [a, b];
  }

  if (style === "elbow") {
    // نقطه‌ی زانویی: افقی تا وسط، عمودی تا وسط. جهت بر اساس فاصله‌ی بزرگ‌تر.
    const dx = b.x - a.x;
    const dy = b.y - a.y;

    if (Math.abs(dx) >= Math.abs(dy)) {
      // افقی غالب: از a افقی به میانه، عمودی، سپس افقی به b.
      const midX = roundTo2(a.x + dx / 2);
      return [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b];
    }
    // عمودی غالب.
    const midY = roundTo2(a.y + dy / 2);
    return [a, { x: a.x, y: midY }, { x: b.x, y: midY }, b];
  }

  // curved: نقطه‌ی کنترل وسط، کمی جابه‌جا برای انحنا.
  const midX = roundTo2(a.x + (b.x - a.x) / 2);
  const midY = roundTo2(a.y + (b.y - a.y) / 2);
  return [a, { x: midX, y: midY }, b];
}

/**
 * تبدیل نقاط مطلق به نقاط نسبی به نقطه‌ی اول — شکلی که موتور برای `points`
 * یک عنصر خطی می‌خواهد (`points[0]` همیشه `[0, 0]` است).
 */
export function toRelativePoints(points: Point[]): [number, number][] {
  if (points.length === 0) return [];
  const origin = points[0]!;
  return points.map((p) => [roundTo2(p.x - origin.x), roundTo2(p.y - origin.y)]);
}
