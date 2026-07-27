import type { HbElement } from "@hamboom/shared-types";

import { areAllLocked } from "../elements/operations";
import { commonStyle, type StylePatch } from "../elements/style";
import { HB_TYPO } from "../theme/tokens";

import "./style-panel.css";

/**
 * پنل استایل — گام ۳٫۳.
 *
 * ── چرا اینجا فقط رابط است ────────────────────────────────────────────
 *
 * همه‌ی منطق در `elements/style.ts` است؛ این کامپوننت فقط نمایش می‌دهد و
 * `onChange` صدا می‌زند. همان عملیات از منوی راست‌کلیک و میانبر هم می‌آید.
 *
 * ── مقادیر مختلط ──────────────────────────────────────────────────────
 *
 * وقتی انتخاب چند عنصر با مقادیر متفاوت باشد، `commonStyle` مقدار
 * `undefined` می‌دهد و کنترل **خالی** نشان داده می‌شود، نه مقدار اولین عنصر.
 * اگر مقدار اولی جا زده شود، اولین تعامل کاربر بقیه را هم بی‌خبر به آن مقدار
 * می‌برد.
 *
 * ── RTL ───────────────────────────────────────────────────────────────
 *
 * فقط logical properties ([ADR-016](../../../../ARCHITECTURE_DECISIONS.md#adr-016)).
 * هیچ `left`/`right` در این فایل نیست — چیدمان از `dir` سند می‌آید.
 */

const STROKE_WIDTHS = [1, 2, 4] as const;
const STROKE_STYLES = [
  { value: "solid", label: "خط ممتد" },
  { value: "dashed", label: "خط‌چین" },
  { value: "dotted", label: "نقطه‌چین" },
] as const;

const SWATCHES = [
  "#1A1A1A",
  "#D14343",
  "#E07B1B",
  "#1E7A3C",
  "#0B5F8A",
  "#4B3B9E",
  "#93326B",
  "transparent",
] as const;

export interface StylePanelProps {
  elements: HbElement[];
  selectedIds: ReadonlySet<string>;
  onChange: (patch: StylePatch) => void;
  /** toggle قفل — همان `toggleLock`ِ منوی راست‌کلیک (منبعِ واحد، ADR-024). */
  onToggleLock: () => void;
}

function ColorRow({
  label,
  value,
  onPick,
}: {
  label: string;
  value: string | undefined;
  onPick: (color: string) => void;
}) {
  return (
    <div className="hb-style-row">
      <span className="hb-style-label">{label}</span>
      <div className="hb-style-swatches" role="group" aria-label={label}>
        {SWATCHES.map((color) => (
          <button
            key={color}
            type="button"
            className={`hb-style-swatch${value === color ? " is-selected" : ""}${
              color === "transparent" ? " is-transparent" : ""
            }`}
            style={color === "transparent" ? undefined : { background: color }}
            aria-label={color === "transparent" ? "بدون رنگ" : color}
            aria-pressed={value === color}
            onClick={() => onPick(color)}
          />
        ))}
      </div>
    </div>
  );
}

export function StylePanel({ elements, selectedIds, onChange, onToggleLock }: StylePanelProps) {
  if (selectedIds.size === 0) return null;

  const current = commonStyle(elements, selectedIds);
  const hasText = current.fontSize !== undefined || elements.some((el) => selectedIds.has(el.id));
  const allLocked = areAllLocked(elements, selectedIds);

  return (
    <aside className="hb-style-panel" aria-label="استایل">
      <ColorRow
        label="رنگ خط"
        value={current.strokeColor}
        onPick={(strokeColor) => onChange({ strokeColor })}
      />
      <ColorRow
        label="رنگ پر"
        value={current.backgroundColor}
        onPick={(backgroundColor) => onChange({ backgroundColor })}
      />

      <div className="hb-style-row">
        <span className="hb-style-label">ضخامت</span>
        <div className="hb-style-group" role="group" aria-label="ضخامت خط">
          {STROKE_WIDTHS.map((width) => (
            <button
              key={width}
              type="button"
              className={`hb-style-chip${current.strokeWidth === width ? " is-selected" : ""}`}
              aria-pressed={current.strokeWidth === width}
              onClick={() => onChange({ strokeWidth: width })}
            >
              {width}
            </button>
          ))}
        </div>
      </div>

      <div className="hb-style-row">
        <span className="hb-style-label">نوع خط</span>
        <div className="hb-style-group" role="group" aria-label="نوع خط">
          {STROKE_STYLES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={`hb-style-chip${current.strokeStyle === value ? " is-selected" : ""}`}
              aria-pressed={current.strokeStyle === value}
              title={label}
              onClick={() => onChange({ strokeStyle: value })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="hb-style-row">
        <label className="hb-style-label" htmlFor="hb-opacity">
          شفافیت
        </label>
        <input
          id="hb-opacity"
          type="range"
          min={0}
          max={100}
          step={10}
          // مقدار مختلط → وسط بازه، ولی کنترل خنثی می‌ماند تا تغییر عمدی لازم باشد.
          value={current.opacity ?? 100}
          onChange={(event) => onChange({ opacity: Number(event.target.value) })}
        />
        <span className="hb-style-value">{current.opacity ?? "—"}</span>
      </div>

      {hasText && current.fontSize !== undefined ? (
        <div className="hb-style-row">
          <span className="hb-style-label">اندازه متن</span>
          <div className="hb-style-group" role="group" aria-label="اندازه متن">
            {HB_TYPO.fontSizes.map((size) => (
              <button
                key={size}
                type="button"
                className={`hb-style-chip${current.fontSize === size ? " is-selected" : ""}`}
                aria-pressed={current.fontSize === size}
                onClick={() => onChange({ fontSize: size })}
              >
                {size}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="hb-style-row">
        <span className="hb-style-label">چیدمان</span>
        <div className="hb-style-group" role="group" aria-label="چیدمان و قفل">
          {/* لایه‌بندی کارِ گام ۵٫۱ است (fractional index، ADR-007) — همین‌جا و در
              منوی راست‌کلیک coming-soon، و در ۵٫۱ هر دو به یک تابع وصل می‌شوند. */}
          <button type="button" className="hb-style-chip" disabled title="بردن به جلو · به‌زودی">
            جلو
          </button>
          <button type="button" className="hb-style-chip" disabled title="بردن به عقب · به‌زودی">
            عقب
          </button>
          <button
            type="button"
            className={`hb-style-chip${allLocked ? " is-selected" : ""}`}
            aria-pressed={allLocked}
            onClick={onToggleLock}
          >
            {allLocked ? "باز کردن قفل" : "قفل"}
          </button>
        </div>
      </div>
    </aside>
  );
}
