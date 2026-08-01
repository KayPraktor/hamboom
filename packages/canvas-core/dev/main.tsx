import { createRoot } from "react-dom/client";

import { App } from "./App";
import { Bench } from "./Bench";
import { Palette } from "./Palette";
import { SpikeEditing } from "./SpikeEditing";
import { SpikeText } from "./SpikeText";
// fonts.css عمداً اینجا نیست — از گام ۱٫۴ بخشی از خود پکیج است و
// HamboomCanvas آن را import می‌کند.
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("عنصر #root در index.html پیدا نشد.");

/** مسیریابی حداقلی برای محیط دمو — صفحه‌های spike گام ۱٫۳. */
const PAGES: Record<string, typeof App> = {
  "#spike": SpikeText,
  "#spike-edit": SpikeEditing,
  "#palette": Palette,
  "#bench": Bench,
};
const Page = PAGES[window.location.hash] ?? App;

// ★ عمداً بدونِ StrictMode. **این را تستِ E2E گام ۶٫۱ کشف کرد، نه چشم:** StrictMode
//   دموی Excalidraw را دوبار mount/unmount می‌کند و APIِ امریِ موتور (`excalidrawAPI`)
//   با این چرخه سازگار نیست — بعدش مسیرِ `onChange → refreshCounts → setSnapshot` مرده
//   می‌مانَد و پنلِ استایل با **هیچ** انتخابِ موتوری (کلیک/Shift+کلیک/کادر/Ctrl+A)
//   به‌روز نمی‌شود (بخشِ هم‌ترازی ظاهر نمی‌شد). خودِ منطقِ refreshCounts درست است
//   (بدون StrictMode کامل کار می‌کند؛ لغوِ listenerها هم درمانش نکرد — ناسازگاریِ
//   عمیق‌ترِ StrictMode با APIِ امری است). دمو ابزارِ توسعه است و کارش اجرای موتورِ
//   واقعی است؛ دوبار-mountِ یک موتورِ third-party اینجا فقط artifact می‌سازد، نه
//   نمایانگرِ رفتارِ محصول. اپِ اصلی (apps/web) می‌تواند StrictMode را روی
//   کامپوننت‌های خودش داشته باشد.
createRoot(container).render(<Page />);

window.addEventListener("hashchange", () => window.location.reload());
