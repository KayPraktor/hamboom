import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { StrictModeProbe } from "./StrictModeProbe";
import { SyncPairDemo } from "./SyncPairDemo";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("عنصر #root در index.html پیدا نشد.");

// `#pair` → دموی دو-نمونه‌ای (گام ۳٫۲ و بعداً ۳٫۷). هر چیزِ دیگری → probeِ ۱٫۱.
const isPair = window.location.hash.startsWith("#pair");

// ★ **عمداً و صریحاً داخلِ `<StrictMode>`** — برخلافِ دموی canvas-core.
//   برای probeِ ۱٫۱ کلِ هدف بازتولیدِ شرایطِ ADR-028 است؛ و برای دموی جفتی،
//   اولین جایی که الگوی تاییدشده‌ی ADR-032 با آداپتورِ **واقعی** به کار می‌رود.
createRoot(container).render(
  <StrictMode>{isPair ? <SyncPairDemo /> : <StrictModeProbe />}</StrictMode>,
);

window.addEventListener("hashchange", () => window.location.reload());
