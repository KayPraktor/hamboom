import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { SpikeEditing } from "./SpikeEditing";
import { SpikeText } from "./SpikeText";
import "./fonts.css";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("عنصر #root در index.html پیدا نشد.");

/** مسیریابی حداقلی برای محیط دمو — صفحه‌های spike گام ۱٫۳. */
const PAGES: Record<string, typeof App> = {
  "#spike": SpikeText,
  "#spike-edit": SpikeEditing,
};
const Page = PAGES[window.location.hash] ?? App;

createRoot(container).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);

window.addEventListener("hashchange", () => window.location.reload());
