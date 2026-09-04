# `@hamboom/web`

اپِ وبِ کاربر — احراز (موبایل/OTP) → داشبورد/تیم/فولدر → پوسته‌ی بورد (بوم + نوار ابزار + حضور + تصویر).
React 19 + Vite 6 + TypeScript + TanStack Router (**code-based**) + TanStack Query.

> برای کار کردن **روی** این اپ [`CLAUDE.md`](CLAUDE.md) را بخوان (خط‌قرمزها، تله‌های مرورگر، درس‌ها). این فایل مرورِ کلی است.

## ★ اجرای محلیِ کاملِ زنجیره

بورد به **هر سه** سرویس نیاز دارد (api برای rt-token، realtime برای WS، web):

```bash
pnpm db:up                                                                          # postgres ۵۴۳۳ + redis ۷۳۷۹ + minio ۹۶۰۰ (پورت‌ها در .envِ محلی)
APP_ENV=local node --env-file-if-exists=.env apps/api/src/server.ts                 # api روی ۳۰۰۲ (OTP در لاگ)
RT_PORT=3001 APP_ENV=local node --env-file-if-exists=.env apps/realtime/src/main.ts # realtime روی ۳۰۰۱
pnpm --filter @hamboom/web dev                                                      # web روی ۱۵۳۸۰ (پروکسی به ۳۰۰۲، WS به ۳۰۰۱)
```

تستِ همگام: یک بورد بساز، `/b/<id>` را در **دو تب** باز کن، در یکی رسم/تصویر بگذار → در آن یکی زنده دیده می‌شود.

## ساختار

`src/auth/` (ورود، `SessionProvider`، `RequireAuth`) · `src/dashboard/` (فهرست/ساخت/نشان + فولدر + سطل) ·
`src/team/` (اعضا/دعوت/نقش) · `src/board/` (پوسته‌ی بورد: `HamboomCanvas` + `YjsSyncAdapter` + نوار ابزار +
منوی ⋯ + مکان‌نمای همتا + تصویر) · `src/api/` (singletonِ sdk) · `src/router.tsx` (code-based).

## خط‌قرمزها (کاملش در CLAUDE.md)

- **P2 — هیچ سرویسِ خارجی در runtime.** فونتِ Vazirmatn **خودمیزبان**؛ همه‌ی requestها روی `127.0.0.1`.
- **P6 — RTL واقعی.** `<html dir="rtl">` + **فقط** logical properties (گیتِ Stylelintِ داخلِ verify). ⚠️ مختصاتِ بوم هرگز آینه نمی‌شود.
- ★ **StrictMode-safe از خط اول** ([ADR-032](../../ARCHITECTURE_DECISIONS.md#adr-032)): اشتراکِ بوم در `useEffect([api])` با cleanup، **نه** در `onReady` — وگرنه بی‌صدا مرده می‌مانَد. اپ عمداً زیرِ StrictMode است.
- ★ **access-token در حافظه، نه `localStorage`**؛ تنها کلاینتِ api **`@hamboom/sdk`** است (هیچ fetchِ خام).
- ★ **fail-closed**: نقشِ ناشناخته → `viewer`؛ `rt-token` برای **هر تلاش** تازه.

## ⚠️ نکاتِ مرورگری که وقت‌گیر بودند

- **excalidraw رویدادِ اشاره‌گرِ مصنوعی را دسته می‌کند** — نرخِ واقعیِ سینک فقط با درگِ ابزارِ **واقعی** سنجیدنی است.
- **screenshot در این محیط time-out می‌کند** (بومِ excalidraw روی GPU composite) — اثباتِ رابط با `getBoundingClientRect` + کلیکِ واقعی + `read_network_requests`، نه صرفاً چشمی.
- **تصویر** (M3 گام ۱۱٫۲): نمایش با `data:URI` (نه `blob:`/http که موتور رندر نمی‌کند)؛ `resolver` هم به adapter هم به binding داده می‌شود، وگرنه تصویرِ همتا/reload «قابِ خالی» می‌مانَد.

## دستورات

```bash
pnpm --filter @hamboom/web dev
pnpm --filter @hamboom/web typecheck
pnpm --filter @hamboom/web lint
pnpm --filter @hamboom/web build       # tsc --noEmit سپس vite build
```
