import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { installCanvasStub } from "./canvas-stub";

/**
 * Excalidraw در زمان لود ماژول `getContext("2d")` می‌زند و jsdom آن را ندارد.
 * بدون این، هر تستی که از canvas-core چیزی import کند در زمان collect می‌ترکد.
 *
 * ⚠️ این stub رندر واقعی نمی‌کند — محدودیت‌هایش در `canvas-stub.ts` مستند است.
 * هر ادعایی درباره‌ی اندازه‌ی متن باید در مرورگر واقعی آزموده شود، نه اینجا.
 */
installCanvasStub();

/**
 * پاک‌سازی DOM بین تست‌ها.
 *
 * `@testing-library/react` فقط وقتی cleanup را خودکار ثبت می‌کند که
 * `globals: true` در vitest فعال باشد. ما globals را عمداً خاموش نگه داشته‌ایم
 * (import صریح خواناتر است)، پس باید دستی ثبت شود — وگرنه رندرهای تست قبلی
 * در DOM می‌مانند و کوئری‌ها «چند عنصر پیدا شد» می‌دهند.
 */
afterEach(cleanup);

/**
 * jsdom پیش‌فرض `dir` را روی سند ست نمی‌کند. چون کل رابط هم‌بوم RTL است
 * (ADR-016)، تست‌ها هم باید در همان شرایط اجرا شوند — وگرنه رگرسیون RTL
 * در تست دیده نمی‌شود.
 */
document.documentElement.setAttribute("dir", "rtl");
document.documentElement.setAttribute("lang", "fa");
