import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { SpikeText } from "./SpikeText";
import "./fonts.css";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("عنصر #root در index.html پیدا نشد.");

/** مسیریابی حداقلی برای محیط دمو — `#spike` صفحه‌ی spike گام ۱٫۳ را می‌آورد. */
const Page = window.location.hash === "#spike" ? SpikeText : App;

createRoot(container).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);

window.addEventListener("hashchange", () => window.location.reload());
