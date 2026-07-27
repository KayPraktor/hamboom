import { formatZoomPercent } from "./zoom";
import "./zoom-control.css";

/**
 * کنترلِ بزرگ‌نمایی — گام ۴٫۳. ارائه‌ای؛ مقدارِ zoom و سه callback می‌گیرد.
 * محاسبه در `zoom.ts` و اتصال به موتور با مصرف‌کننده. کلیک روی درصد = برازش با صفحه.
 */

export interface ZoomControlProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}

export function ZoomControl({ zoom, onZoomIn, onZoomOut, onFit }: ZoomControlProps) {
  return (
    <div className="hb-zoom" role="group" aria-label="بزرگ‌نمایی">
      <button type="button" className="hb-zoom-btn" aria-label="کوچک‌نمایی" onClick={onZoomOut}>
        −
      </button>
      <button
        type="button"
        className="hb-zoom-percent"
        title="برازش با صفحه"
        aria-label={`بزرگ‌نمایی ${formatZoomPercent(zoom)} — کلیک برای برازش با صفحه`}
        onClick={onFit}
      >
        {formatZoomPercent(zoom)}
      </button>
      <button type="button" className="hb-zoom-btn" aria-label="بزرگ‌نمایی" onClick={onZoomIn}>
        +
      </button>
    </div>
  );
}
