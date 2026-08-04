import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { StrictModeProbe } from "./StrictModeProbe";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("عنصر #root در index.html پیدا نشد.");

// ★ **عمداً و صریحاً داخلِ `<StrictMode>`** — برخلافِ دموی canvas-core.
//   کلِ هدفِ این صفحه بازتولیدِ همان شرایطی است که ADR-028 توصیف می‌کند؛ بدونِ
//   StrictMode این probe هیچ چیزی را اثبات نمی‌کند.
createRoot(container).render(
  <StrictMode>
    <StrictModeProbe />
  </StrictMode>,
);

window.addEventListener("hashchange", () => window.location.reload());
