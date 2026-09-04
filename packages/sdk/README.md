# `@hamboom/sdk`

کلاینتِ **typed**ِ REST برای [`apps/api`](../../apps/api/). نازک و framework-agnostic —
فقط `fetch`ِ سراسری + DTOهای [`@hamboom/shared-types`](../shared-types/). مصرف‌کننده‌اش
`apps/web` است؛ خودِ sdk به React/DOM وابسته نیست.

> برای کار کردن **روی** این پکیج [`CLAUDE.md`](CLAUDE.md) را بخوان. این فایل برای **مصرف‌کننده** است.

## استفاده

```ts
import { createClient } from "@hamboom/sdk";

const api = createClient({
  baseUrl: "",                       // هم‌مبدأ (پروکسیِ dev به api)
  onSessionEnded: () => redirectToLogin(),
});

await api.auth.requestOtp({ phone });
const { accessToken } = await api.auth.verifyOtp({ phone, code });   // access در حافظه می‌نشیند
const { boards } = await api.boards.list();
const board = await api.boards.create({ title: "بوردِ من" });
const { token } = await api.boards.rtToken(board.id);                // برای اتصالِ realtime
```

متدها گروه‌بندی‌شده‌اند: `auth` · `me` · `teams` · `folders` · `boards` · `links` · `assets`.
پاسخ‌ها DTOی `shared-types` اند، بدنه‌ها `*Body`؛ فقط envelopeهای api-محور (verify/me/access)
**ترکیبِ** DTOها هستند، نه بازتعریف.

## سه قیدی که رعایت می‌کند

- ★ **access token در حافظه، نه `localStorage`.** فقط کوکیِ refreshِ HttpOnly پایدار است.
- ★ **روی ۴۰۱ یک‌بار refresh + retryِ خودکار** (`credentials:include`)؛ چند ۴۰۱ همزمان **یک‌بار**
  refresh می‌کنند (وعده‌ی مشترک). اگر refresh هم شکست خورد → `onSessionEnded`.
- ★ **fail-closed** — خطا را `SdkError` (code/status/requestId/details، قالبِ §۵) می‌اندازد.

## ⚠️ دارایی (تله‌ی مرورگر — کشفِ M3 گام ۱۱٫۲)

`assets.resolveBlob(fileId)` **بایت‌های** فایل را می‌دهد (`Blob`) با **دنبال‌کردنِ ۳۰۲** به
Object Storage. ⚠️ نسخه‌ی قبلی `redirect:"manual"` بود که در **مرورگر** پاسخِ opaque (status 0)
می‌دهد و Location هرگز خوانده نمی‌شود — در Node نه، پس تستِ mock سبز بود ولی مرورگر می‌شکست.
مصرف‌کننده‌ی مرورگری از این `Blob` یک `data:URI` یا `objectURL` می‌سازد (`apps/web` `data:` می‌سازد
چون excalidraw `blob:` را در `addFiles` رندر نمی‌کند).

## دستورات

```bash
pnpm --filter @hamboom/sdk test        # unit با fetchِ دروغین (داخلِ pnpm verify)
pnpm --filter @hamboom/sdk typecheck
pnpm sdk:contract                       # ★ در برابرِ buildApp()ِ واقعی + DB (بیرونِ verify)
```

## آنچه اینجا انجام نمی‌شود

منطقِ سرور → [`apps/api`](../../apps/api/) · UI/state → [`apps/web`](../../apps/web/) ·
ترابریِ WebSocket → [`canvas-sync`](../canvas-sync/) (sdk فقط `rt-token` را می‌گیرد، خودش وصل نمی‌شود).
