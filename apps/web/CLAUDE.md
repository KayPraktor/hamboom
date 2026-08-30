# CLAUDE.md — `@hamboom/web`

اپِ وبِ کاربر — احراز هویت، داشبورد، پوسته‌ی بورد. **ماژول M3، فاز ۸.**
React 19 + Vite 6 + TypeScript + TanStack Router (code-based) + TanStack Query.

**قبل از کار بخوان:** [TODO فاز ۸](../../TODO-M3-backend-api.md) · [PLAN §۵](../../PLAN.md) ·
ADRها: **[ADR-016](../../ARCHITECTURE_DECISIONS.md#adr-016)** (RTL) ·
**[ADR-017](../../ARCHITECTURE_DECISIONS.md#adr-017)** (فونت) ·
**[ADR-032](../../ARCHITECTURE_DECISIONS.md#adr-032)** (StrictMode) ·
**[ADR-035](../../ARCHITECTURE_DECISIONS.md#adr-035)** (undo) · ADR-038 (رد ≠ بستن).

## خط قرمزها

1. **P2 — هیچ سرویسِ خارجی در runtime.** بدون Google Fonts، CDN، Sentry SaaS.
   فونتِ Vazirmatn **خودمیزبان** از `@fontsource-variable/vazirmatn` (OFL-1.1). هر
   دارایی باید از خودِ اپ سرو شود. (آزموده: همه‌ی requestها روی `127.0.0.1`.)
2. **P6 — RTL واقعی.** `<html dir="rtl" lang="fa">` + **فقط** logical properties
   (`margin-inline-start`، نه `margin-left`). گیتِ Stylelintِ داخلِ verify اعمالش
   می‌کند (آزموده با شکستنِ عمدی). ⚠️ **استثنا: مختصاتِ بوم هرگز آینه نمی‌شود** (فاز ۸٫۴).
3. ★ **StrictMode-safe از خط اول** ([ADR-032](../../ARCHITECTURE_DECISIONS.md#adr-032)).
   بایندرِ بوم (۸٫۴) باید اشتراک را در `useEffect([api])` با cleanup بگذارد، **نه**
   در `onReady` — وگرنه زیرِ StrictMode بی‌صدا مرده می‌مانَد. اپ عمداً زیرِ StrictMode است.
4. ★ **access-token در حافظه، نه `localStorage`** (فاز ۸٫۲). فقط کوکیِ refreshِ
   HttpOnly پایدار است؛ `sdk` خودش ۴۰۱→refresh→retry را دارد.
5. **تنها کلاینتِ API `@hamboom/sdk` است.** هیچ `fetch`ِ خام به api زده نمی‌شود —
   قرارداد و ۴۰۱-refresh و §۵ error همه آنجاست.
6. ★ **fail-closed** (۸٫۴): نقشِ ناشناخته → `viewer`؛ `token()` برای **هر تلاش**
   تازه؛ `undefined`/`null` قاطی نشوند ([درسِ M2](../realtime/CLAUDE.md)).

## ★ تصمیم: روترِ code-based (نه file-based)

گیتِ `typecheck`ِ verify با `tsc`ِ خالص اجرا می‌شود، بدونِ Vite. پلاگینِ
file-based یک `routeTree.gen.ts` می‌سازد که هنگامِ `tsc` باید از قبل باشد —
یعنی یا فایلِ تولیدی commit شود یا هوکِ codegen پیش از typecheck. code-based هر
دو را حذف می‌کند و کاملاً typed می‌مانَد. مسیرها در [`src/router.tsx`](src/router.tsx).

## ساختار

| مسیر | چیست | فاز |
|---|---|---|
| `index.html` · `src/main.tsx` | ریشه: RTL، StrictMode، QueryClient، ErrorBoundary | ۸٫۱ ✅ |
| `src/router.tsx` · `src/routes/` | روترِ code-based + صفحات | ۸٫۱ ✅ |
| `src/fonts.ts` | گیتِ `document.fonts.ready` (برای بوم، ۸٫۴) | ۸٫۱ ✅ |
| `src/styles/app.css` | تمِ روشن/تیره + پوسته + فرم‌ها، فقط logical properties | ۸٫۱ ✅ |
| `src/api/client.ts` | singletonِ `sdk` (access در حافظه، `baseUrl=""`) | ۸٫۲ ✅ |
| `src/auth/` | `LoginPage` (موبایل/OTP) · `SessionProvider`+`session-context` · `RequireAuth` · `validate` | ۸٫۲ ✅ |
| (به‌زودی) `src/dashboard/` | تیم/بورد/فولدر/عضو | ۸٫۳ |
| (به‌زودی) `src/board/` | پوسته‌ی بورد + `canvas-sync` روی سرورِ واقعی | ۸٫۴ |

## ★ اجرای محلیِ کاملِ زنجیره (احراز به بعد)

```bash
pnpm db:up                                   # postgres روی 5433
APP_ENV=local node --env-file-if-exists=.env apps/api/src/server.ts   # api روی 3002 (SMS mock → کد در لاگ)
pnpm --filter @hamboom/web dev               # web روی 15380، پروکسی به 3002
```

⚠️ **کوکیِ refresh مسیرِ `/auth` دارد** — پروکسیِ dev **نباید rewrite کند** وگرنه مرورگر
کوکی را برنمی‌گردانَد. `baseUrl`ِ sdk هم به همین دلیل `""` است (هم‌مبدأ).

## دستورات

```bash
pnpm --filter @hamboom/web dev         # سرورِ dev روی 15380
pnpm --filter @hamboom/web typecheck
pnpm --filter @hamboom/web lint
pnpm --filter @hamboom/web test
pnpm --filter @hamboom/web build       # tsc --noEmit سپس vite build
```

> **پورتِ dev = 15380** (بیرونِ بازه‌ی dynamic portِ ویندوز؛ مثلِ canvas-core=15180،
> canvas-sync=15280). هوکِ `predev` با `check-dev-port.mjs` بررسی‌اش می‌کند.
