import type { HbElement } from "@hamboom/shared-types";

import { HB_UI_COLORS } from "../theme/tokens";
import { buildBaseElement, resolveSeed, type ElementSeedOptions } from "./factory";

/**
 * قلم آزاد (freedraw) — گام ۳٫۷.
 *
 * ── فقط نتیجه‌ی نهایی ──────────────────────────────────────────────────
 *
 * استروکِ در حال کشیدن **هرگز** وارد سند نمی‌شود؛ از کانال ephemeral پخش
 * می‌شود ([ADR-022](../../../../ARCHITECTURE_DECISIONS.md#adr-022)). این فایل
 * فقط عنصرِ **commit‌شده‌ی** خالص را می‌سازد و مسیر را ساده می‌کند —
 * سیم‌کشیِ ephemeral کار `tools/draw-tool.ts` است.
 *
 * ── چرا ساده‌سازی ─────────────────────────────────────────────────────
 *
 * یک استروک خام ۲۰۰ تا ۵۰۰ نقطه دارد. `simplifyStroke` (Ramer–Douglas–Peucker)
 * نقاطی را که از یک آستانه به خط نزدیک‌ترند حذف می‌کند، پس عنصرِ ذخیره‌شده
 * سبک می‌ماند بدون اینکه شکل دیده‌شدنی عوض شود. **این تابع فقط روی کلاینتِ
 * کشنده اجرا می‌شود و نتیجه ذخیره می‌گردد** — برخلاف مسیر کانکتور، لازم نیست
 * بین مرورگرها بیت‌به‌بیت یکسان باشد، پس استفاده از `hypot`/`sqrt` مجاز است.
 */

export type StrokePoint = [number, number];

/** فاصله‌ی عمودی نقطه‌ی `p` از خط گذرنده از `a` و `b`. */
function perpendicularDistance(p: StrokePoint, a: StrokePoint, b: StrokePoint): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const numerator = Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]);
  return numerator / Math.hypot(dx, dy);
}

/**
 * ساده‌سازی Ramer–Douglas–Peucker.
 *
 * نقاطی که فاصله‌ی عمودی‌شان از پاره‌خطِ دو سرِ بازه از `epsilon` کمتر است حذف
 * می‌شوند. خالص است و آرایه‌ی تازه برمی‌گرداند.
 */
export function simplifyStroke(points: StrokePoint[], epsilon = 1): StrokePoint[] {
  if (points.length <= 2) return points.map((p) => [p[0], p[1]]);

  const end = points.length - 1;
  const first = points[0]!;
  const last = points[end]!;

  let maxDist = 0;
  let index = 0;
  for (let i = 1; i < end; i += 1) {
    const dist = perpendicularDistance(points[i]!, first, last);
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyStroke(points.slice(0, index + 1), epsilon);
    const right = simplifyStroke(points.slice(index), epsilon);
    // نقطه‌ی مشترک (index) دوبار نیاید.
    return [...left.slice(0, -1), ...right];
  }
  return [
    [first[0], first[1]],
    [last[0], last[1]],
  ];
}

export interface CreateDrawOptions extends ElementSeedOptions {
  /** نقاط استروک در **مختصات صحنه** (مطلق). سازنده خودش نسبی‌شان می‌کند. */
  points: StrokePoint[];
  authorId: string;
  index?: string;
  strokeColor?: string;
  strokeWidth?: number;
  /** فشارِ هر نقطه. خالی = موتور از سرعت شبیه‌سازی می‌کند (`simulatePressure`). */
  pressures?: number[];
}

/**
 * ساخت عنصر freedraw از نقاط مطلق.
 *
 * `x`/`y` گوشه‌ی بالا-چپِ جعبه‌ی احاطه می‌شود و `points` نسبت به آن ذخیره
 * می‌شوند — همان قرارداد موتور. `simulatePressure` وقتی روشن است که فشاری
 * داده نشده باشد.
 */
export function createDraw(options: CreateDrawOptions): HbElement {
  const {
    points,
    authorId,
    index = "a0",
    strokeColor = HB_UI_COLORS.text,
    strokeWidth = 3,
    pressures = [],
    ...seedOptions
  } = options;

  if (points.length === 0) {
    throw new Error("createDraw: استروک بدون نقطه ساخته نمی‌شود");
  }

  const seed = resolveSeed(seedOptions);

  let minX = points[0]![0];
  let minY = points[0]![1];
  let maxX = minX;
  let maxY = minY;
  for (const [px, py] of points) {
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }

  const relative: StrokePoint[] = points.map((p) => [p[0] - minX, p[1] - minY]);

  return {
    ...buildBaseElement({
      id: `drw_${seed.makeId()}`,
      type: "freedraw",
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      index,
      kind: "draw",
      authorId,
      seed,
    }),
    strokeColor,
    strokeWidth,
    backgroundColor: "transparent",
    roundness: null,
    points: relative,
    pressures,
    simulatePressure: pressures.length === 0,
  } as unknown as HbElement;
}
