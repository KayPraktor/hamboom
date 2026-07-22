import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("عنصر #root در index.html پیدا نشد.");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
