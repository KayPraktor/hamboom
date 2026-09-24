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
type SessionEndedHandler = (reason?: { code: string }) => void;
let sessionEndedHandler: SessionEndedHandler | null = null;

export const api = createClient({
  baseUrl: "",
  onSessionEnded: (reason) => sessionEndedHandler?.(reason),
});

/**
 * `SessionProvider` خودش را وصل می‌کند تا مرگِ نشست (۴۰۱ + refreshِ ناموفق) به state برسد.
 * `reason.code === "USER_SUSPENDED"` = حساب معلق است (M6 ۵٫۲) — نه «دوباره وارد شو».
 */
export function setSessionEndedHandler(handler: SessionEndedHandler | null): void {
  sessionEndedHandler = handler;
}
