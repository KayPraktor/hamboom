import { createClient } from "@hamboom/sdk";

/**
 * نمونه‌ی سراسریِ کلاینتِ api.
 *
 * ★ یک singleton، چون `accessToken` را **در حافظه‌ی همین closure** نگه می‌دارد
 * (خط قرمزِ [`sdk`](../../../../packages/sdk/CLAUDE.md) / فاز ۸): با ناوبری بینِ
 * صفحه‌ها توکن می‌مانَد، ولی با **رفرشِ صفحه** از بین می‌رود و از کوکیِ HttpOnly
 * بازساخته می‌شود — access هرگز در `localStorage` نمی‌نشیند.
 *
 * `baseUrl=""` یعنی هم‌مبدأ: در dev پروکسیِ Vite به api می‌رساند، در production
 * همان دامنه. `onSessionEnded` را `SessionProvider` وصل می‌کند.
 */
let sessionEndedHandler: (() => void) | null = null;

export const api = createClient({
  baseUrl: "",
  onSessionEnded: () => sessionEndedHandler?.(),
});

/** `SessionProvider` خودش را وصل می‌کند تا مرگِ نشست (۴۰۱ + refreshِ ناموفق) به state برسد. */
export function setSessionEndedHandler(handler: (() => void) | null): void {
  sessionEndedHandler = handler;
}
