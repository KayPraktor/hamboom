/**
 * نمودارِ میله‌ایِ خانگی — M6 فاز ۷٫۳ (M6-D8).
 *
 * ★★ **صفر وابستگی، و این یک تصمیمِ مرزیِ تاییدشده است نه سلیقه.** افزودنِ یک کتابخانه‌ی نمودار
 * هم‌زمان سه گیت را می‌شکند: `license:check` (P1)، `deps` (اعلامِ وابستگی)، و معیارِ «صفر dep»ِ
 * خودِ ۷٫۳. یک نمودارِ میله‌ای چند ده خط SVG است.
 *
 * ★ **تم مجانی است:** رنگ‌ها از توکن‌های `--hb-*` می‌آیند که در `prefers-color-scheme: dark`
 * دوباره تعریف شده‌اند، پس حالتِ تیره بدونِ یک خط کدِ اضافه درست کار می‌کند.
 *
 * ⚠️ **بدونِ `xmlns`:** JSXِ درون‌خطی لازمش ندارد، و نوشتنش یک میزبانِ `http://www.w3.org/...` به
 * سورسِ runtime اضافه می‌کرد که گیتِ P2 (`check-p2.ts`) قرمزش می‌کند.
 *
 * ★★ **زمان از راست به چپ می‌رود** (قدیمی‌ترین سمتِ راست). این رابط فارسیِ native است نه ترجمه
 * (P6)، و چشم از راست شروع می‌کند. ⚠️ استثنای P6 مالِ **مختصاتِ بوم** است که هرگز آینه نمی‌شود؛
 * نمودار بوم نیست.
 */

export interface BarPoint {
  /** کلیدِ یکتا (تاریخِ ISO). */
  key: string;
  /** برچسبِ محورِ افقی — از قبل فارسی/جلالی شده. */
  label: string;
  value: number;
  /** متنِ کاملِ tooltip — `<title>`ِ بومیِ SVG، بدونِ یک خط جاوااسکریپت. */
  title: string;
}

interface Props {
  points: readonly BarPoint[];
  /** برای `aria-label` و `<desc>` — مثلاً «بوردهای ساخته‌شده». */
  caption: string;
  /** مقدارِ بیشینه را چطور بخوانیم (عدد/تومان). */
  formatValue: (v: number) => string;
  /** هر چند برچسب یکی نشان داده شود (۳۰ روز ⇒ هر ۵ تا). */
  labelEvery?: number;
}

const W = 640;
const H = 150;
const PAD_TOP = 8;
const AXIS = 22;
const PLOT = H - AXIS - PAD_TOP;

export function BarChart({ points, caption, formatValue, labelEvery }: Props) {
  const max = points.reduce((m, p) => (p.value > m ? p.value : m), 0);
  const total = points.reduce((s, p) => s + p.value, 0);
  const slot = points.length === 0 ? W : W / points.length;
  const barW = Math.max(2, slot * 0.62);
  const every = labelEvery ?? Math.max(1, Math.ceil(points.length / 7));

  if (points.length === 0 || max === 0) {
    return (
      <p className="field-hint" role="status">
        {caption}: در این بازه هیچ داده‌ای نیست.
      </p>
    );
  }

  return (
    <svg
      className="hb-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${caption} — جمعِ بازه ${formatValue(total)}، بیشینه‌ی روزانه ${formatValue(max)}`}
      preserveAspectRatio="none"
    >
      <desc>{`${caption}. زمان از راست (قدیمی‌ترین) به چپ (تازه‌ترین).`}</desc>
      {/* خطِ پایه */}
      <line
        x1={0}
        y1={PAD_TOP + PLOT}
        x2={W}
        y2={PAD_TOP + PLOT}
        className="hb-chart__axis"
        vectorEffect="non-scaling-stroke"
      />
      {points.map((p, i) => {
        // ★ i=0 قدیمی‌ترین است و سمتِ **راست** می‌نشیند.
        const slotStart = W - (i + 1) * slot;
        const x = slotStart + (slot - barW) / 2;
        const h = max === 0 ? 0 : (p.value / max) * PLOT;
        const y = PAD_TOP + PLOT - h;
        return (
          <g key={p.key}>
            <rect
              x={x}
              y={y}
              width={barW}
              // ⚠️ ارتفاعِ صفر در SVG اصلاً رسم نمی‌شود؛ یک نوارِ نازک نشان می‌دهد «روز هست، مقدار صفر است»
              height={Math.max(h, p.value === 0 ? 1 : 2)}
              className={p.value === 0 ? "hb-chart__bar hb-chart__bar--zero" : "hb-chart__bar"}
            >
              <title>{p.title}</title>
            </rect>
            {i % every === 0 ? (
              <text
                x={slotStart + slot / 2}
                y={H - 6}
                textAnchor="middle"
                className="hb-chart__label"
              >
                {p.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
