# CLAUDE.md — `@hamboom/realtime`

سرورِ WebSocket همگام‌سازیِ بلادرنگ. **بخشِ سرورِ ماژول M2.**

**قبل از کار بخوان:** [TODO.md](../../TODO.md) (فازهای ۴ و ۵)،
[PLAN بخش ۵٫۳](../../PLAN.md) (پروتکل) و [بخش ۶](../../PLAN.md) (جدول‌های
`board_updates`/`board_snapshots`)، و
[ARCHITECTURE_DECISIONS.md](../../ARCHITECTURE_DECISIONS.md) — به‌ویژه ADR-004،
ADR-005، **ADR-006**، **ADR-009**، **ADR-012**، ADR-022، ADR-029، **ADR-030**، **ADR-031**.

## خط قرمزها

1. **این سرور هرگز بوم را نمی‌بیند.** بدون `canvas-core`، `canvas-sync`، React،
   `@excalidraw/*`. مدلِ سند را فقط از [`ydoc-schema`](../../packages/ydoc-schema/)
   می‌گیرد ([ADR-029](../../ARCHITECTURE_DECISIONS.md#adr-029)).
2. **بدون `@aws-sdk/*` خام** — دسترسی به Object Storage فقط از راهِ
   `packages/storage` (P4). ⚠️ خودِ `@hamboom/storage` و `@hamboom/auth-core`
   **مجازند**؛ ممنوعیت روی SDKِ خام است.
3. ★ **نقش را در هر update بررسی کن، نه فقط هنگام اتصال**
   ([ADR-012](../../ARCHITECTURE_DECISIONS.md#adr-012)) — نقش می‌تواند وسطِ session
   عوض شود. رایج‌ترین حفره‌ی امنیتی در محصولات مشابه این است که REST درست چک
   می‌کند ولی WebSocket نه.
4. ★ **`DevBoardAuthority` هرگز نباید در production زنده شود**
   ([ADR-031](../../ARCHITECTURE_DECISIONS.md#adr-031)). هرکس `RT_DEV_JWT_SECRET` را
   بداند می‌تواند برای خودش نقشِ owner صادر کند. با `APP_ENV=production` سرور باید
   **بالا نیاید** — نه اینکه هشدار بدهد و ادامه دهد.
5. ★ **update قبل از ack به کلاینت نوشته شود**
   ([ADR-009](../../ARCHITECTURE_DECISIONS.md#adr-009)). `SaveState` باید **حقیقت**
   را بگوید نه خوش‌بینی؛ اگر «ذخیره شد» نشان دادیم و کاربر تب را بست، کارش نباید برود.
6. **داده‌ی ephemeral هرگز پایدار نمی‌شود** — `HB_EPHEMERAL` فقط پخش می‌شود
   ([ADR-022](../../ARCHITECTURE_DECISIONS.md#adr-022)).
7. ★ **P7 — هیچ PII در لاگ.** توکن هرگز، شناسه‌ی کاربر ماسک‌شده.
8. **ترابری پشتِ seam بماند** ([ADR-030](../../ARCHITECTURE_DECISIONS.md#adr-030)) —
   منطقِ اتاق نباید مستقیم به `ws` گره بخورد.

## ★ تله: پسوندِ `.ts` روی importهای نسبی

این اپ مستقیماً با Node اجرا می‌شود و برخلاف Vite پسوند حدس زده نمی‌شود — همه‌ی
importهای نسبی باید `.ts` صریح داشته باشند (`allowImportingTsExtensions` روشن است).
جزئیات در [`packages/config/CLAUDE.md`](../../packages/config/CLAUDE.md).

## ساختار (فازهای ۴ و ۵ پرش می‌کنند)

| فایل | مسئولیت | گام TODO |
|---|---|---|
| `src/index.ts` | صادرات | ۰٫۲ |
| `src/server.ts` | سرورِ ws + دست‌دادن | ۴٫۱ ✅ |
| `src/auth/` | پورتِ `BoardAuthority` + `DevBoardAuthority` | ۴٫۱ ✅ |
| `src/log.ts` | لاگِ ساخت‌یافته + ماسکِ P7 | ۴٫۱ ✅ |
| `src/room.ts` | چرخه‌ی عمرِ اتاق (بارگذاری/حافظه/تخلیه) | ۴٫۲ |
| `src/persistence/` | لاگِ update در Postgres + پورتِ `SnapshotStore` | ۴٫۳–۴٫۴ |
| `src/pubsub/` | fanout با Redis + قفلِ صاحب | ۴٫۷ |
| `src/awareness.ts` | awareness و ephemeral | ۴٫۶ |

## ★★ آنچه گام ۴٫۱ تثبیت کرد

**دو نوعِ ردکردن، و قاطی نکردنشان:**

| چه چیزی | پاسخ | چرا |
|---|---|---|
| مسیرِ اشتباه یا `board`ِ غایب | HTTP خام، **بدونِ upgrade** | این اصلاً کلاینتِ ما نیست |
| توکنِ غایب/نامعتبر/منقضی | **upgrade می‌شود**، بعد `HB_ERROR` و بستن با **۱۰۰۸** | کلاینتِ ماست و باید **کد** را بفهمد؛ ردِ HTTP فقط یک خطای عمومی به مرورگر می‌دهد |

**سه کد برای سه وضعیت** (`TOKEN_MISSING`/`TOKEN_EXPIRED`/`TOKEN_INVALID`) چون کارِ
کلاینت در هرکدام فرق می‌کند. ⚠️ ولی توکنِ معتبرِ **بوردِ دیگر** عمداً `FORBIDDEN`
می‌گیرد — وگرنه همین خطا به ابزارِ شمارشِ بورد تبدیل می‌شود.

**★ گیتِ production روی خودِ پیاده‌سازی است، نه روی پرچمِ config:** علامتِ
`developmentOnly` روی `BoardAuthority`. با یک پرچمِ config، اولین مسیرِ
فراموش‌شده دورش می‌زد.

**★ P7 ساختاری است، نه قاعده‌ای:** `maskSubject` تنها راهِ گذاشتنِ شناسه در لاگ، و
`redactSecrets` روی **کلِ خط** به‌عنوان آخرین سد. نگهبانش دو تست است — یکی لاگِ
واقعی را اسکن می‌کند، یکی ثابت می‌کند خودِ نگهبان روی نشتِ عمدی **می‌افتد**.

⚠️ **`DevBoardAuthority` عمداً JWT را دستی می‌سنجد** (`node:crypto`، بدونِ
کتابخانه) چون با آمدنِ `auth-core`ِ M3 **حذف می‌شود**. هزینه‌اش صریح است: سه
حمله‌ی کلاسیکِ JWT تست دارند — `alg: none` · مقایسه‌ی زمان‌ثابت · `exp`ِ اجباری.
**به آن دست نزن بدونِ اینکه همان سه تست را نگه داری.**

## دستورات

```bash
pnpm --filter @hamboom/realtime test
pnpm --filter @hamboom/realtime typecheck
pnpm --filter @hamboom/realtime lint
```

## چیزهایی که اینجا انجام نمی‌شوند

binder و هر کدِ کلاینتی (کارِ [`canvas-sync`](../../packages/canvas-sync/))؛ ساختارِ
سند و codec (کارِ [`ydoc-schema`](../../packages/ydoc-schema/))؛ CRUDِ بورد/تیم/کاربر و
احراز هویتِ واقعی (کارِ M3 — اینجا فقط پورت + stub).
