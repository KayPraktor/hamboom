# CLAUDE.md — `@hamboom/sdk`

کلاینتِ typedِ REST برای [`apps/api`](../../apps/api/). **بخشِ فاز ۶ ماژول M3.**

★ **کلاینتِ نازکِ framework-agnostic:** فقط `fetch`ِ سراسری + DTOهای `@hamboom/shared-types`. `apps/web`
(فاز ۸) این را wrap می‌کند؛ خودِ sdk به React/DOM وابسته نیست.

**قبل از کار بخوان:** [PLAN §۵](../../PLAN.md) (قراردادِ API) · [`shared-types/src/api`](../shared-types/src/api/)
(DTOها + بدنه‌های درخواست) · [PROGRESS-M3 §فاز ۶](../../PROGRESS-M3-backend-api.md).

## خط قرمزها

1. ★ **همه‌ی typeها از `shared-types`** — پاسخ‌ها DTO، بدنه‌ها `*Body`. فقط envelopeهای api-محور
   (verify/me/access) این‌جا **ترکیبِ** DTOها هستند، نه بازتعریف. **هیچ تعریفِ موازیِ یک تایپِ shared-types.**
2. ★ **دورِ باطل ممنوع:** `@hamboom/api` را در `src` نمی‌بیند (گیتِ `sdkBoundaries`). با api فقط از راهِ HTTP
   حرف می‌زند، نه import. تستِ قراردادی (که `buildApp` را import می‌کند) عمداً **بیرونِ `src/`** است
   (`scripts/sdk-contract.ts`) تا گیتِ `src/**` نشکند.
3. ★ **لایه‌های سرور/UI/Yjs ممنوع:** storage/auth-core/assets، react/excalidraw، ydoc-schema/canvas —
   هیچ‌کدام. sdk فقط قراردادِ سیم را می‌داند.
4. ★ **access token در حافظه، نه localStorage** (فاز ۸/handoff). روی **۴۰۱** یک‌بار refresh + retryِ خودکار
   (کوکیِ HttpOnly با `credentials:include`)؛ refreshِ همزمان **یک‌بار** اجرا می‌شود (وعده‌ی مشترک).
5. ★ **`process.env` نمی‌خواند** — `baseUrl`/`fetch` را param می‌گیرد (config کارِ apps/web است).

## ساختار

| فایل | چیست |
|---|---|
| `src/client.ts` | `createClient({ baseUrl, fetch? })` → متدهای گروه‌بندی‌شده (auth/me/teams/folders/boards/links/assets) |
| `src/errors.ts` | `SdkError` (code/status/requestId/details — قالبِ §۵) |
| `contract/`(نیست) | تستِ قراردادی در `scripts/sdk-contract.ts` است (DB لازم دارد، بیرونِ verify) |

## دستورات

```bash
pnpm --filter @hamboom/sdk typecheck
pnpm --filter @hamboom/sdk test         # unit با fetchِ دروغین (داخلِ verify)
pnpm sdk:contract                        # ★ در برابرِ buildApp()ِ واقعی + DB (بیرونِ verify)
```

## چیزهایی که اینجا انجام نمی‌شوند

منطقِ سرور (کارِ `apps/api`)؛ UI/state (کارِ `apps/web`)؛ ترابریِ WebSocket (کارِ `canvas-sync`؛ sdk فقط
`rt-token` را می‌گیرد، خودش وصل نمی‌شود)؛ و آپلودِ واقعیِ فایل به S3 (کلاینت با `fields`ِ presign مستقیم POST می‌کند).
