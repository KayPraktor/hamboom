import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

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
