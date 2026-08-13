import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { OfflineDemo } from "./OfflineDemo";
import { StrictModeProbe } from "./StrictModeProbe";
import { SyncPairDemo } from "./SyncPairDemo";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("عنصر #root در index.html پیدا نشد.");

// `#pair` → دموی دو-نمونه‌ای (گام ۳٫۲ و ۳٫۷) · `#offline` → دموی آفلاین (۵٫۲) ·
// هر چیزِ دیگری → probeِ ۱٫۱.
const hash = window.location.hash;
const isPair = hash.startsWith("#pair");
const isOffline = hash.startsWith("#offline");

function route() {
  if (isOffline) return <OfflineDemo />;
  return isPair ? <SyncPairDemo /> : <StrictModeProbe />;
}

// ★ **عمداً و صریحاً داخلِ `<StrictMode>`** — برخلافِ دموی canvas-core.
//   برای probeِ ۱٫۱ کلِ هدف بازتولیدِ شرایطِ ADR-028 است؛ و برای دموی جفتی،
//   اولین جایی که الگوی تاییدشده‌ی ADR-032 با آداپتورِ **واقعی** به کار می‌رود.
createRoot(container).render(<StrictMode>{route()}</StrictMode>);

window.addEventListener("hashchange", () => window.location.reload());
