# CLAUDE.md — `@hamboom/shared-types`

قرارداد مشترک بین همه‌ی ماژول‌ها. پایین‌ترین لایه‌ی پروژه.

## ⚠️ قاعده‌ی اول

**تغییر این پکیج نیاز به تایید صریح مالک دارد** ([ADR-021](../../ARCHITECTURE_DECISIONS.md#adr-021)).

پروژه با چند session مستقل ساخته می‌شود. اگر هر session نسخه‌ی خودش از `HbElement`
را تعریف کند، در نقطه‌ی ادغام همه‌چیز می‌شکند. اگر به تغییری نیاز داری:
پیشنهاد را در `PROGRESS.md` بنویس و **متوقف شو**.

ساختن اولیه‌ی پکیج (گام ۲٫۱) استثنا بود و انجام شد.

## خط قرمزها

1. **بدون وابستگی به پکیج دیگر.** فقط `zod`. یک قاعده‌ی ESLint هر
   `@hamboom/*` را خطا می‌کند. اگر به چیزی نیاز داری، یا اینجا تعریفش کن یا در
   پکیج مصرف‌کننده.
2. **بدون کد مخصوص مرورگر یا Node.** این پکیج در هر دو محیط اجرا می‌شود —
   `window`، `document`، `fs`، `process` ممنوع.
3. **zod منبع حقیقت است، نه `interface`.** type ها با `z.infer` استخراج می‌شوند.
   یک تعریف، سه خروجی: تایپ، اعتبارسنجی زمان اجرا، و schema برای OpenAPI.
4. **`type` را با `kind` قاطی نکن** ([ADR-010](../../ARCHITECTURE_DECISIONS.md#adr-010)).
   `type` را موتور رندر می‌فهمد، `customData.hb.kind` را محصول.

## ساختار

| مسیر | چیست |
|---|---|
| `src/canvas/element.ts` | انواع عنصر بوم — PLAN بخش ۷ |
| `src/canvas/asset.ts` | متادیتای فایل. **باینری هرگز اینجا نیست.** |
| `src/text/normalize.ts` | نرمال‌سازی فارسی — مصرف‌کننده: بوم، API، realtime |
| `src/api/roles.ts` | ★ نقش‌ها — **منبعِ حقیقتِ `BoardRole`** ([ADR-043](../../ARCHITECTURE_DECISIONS.md#adr-043))، `teamRole`، `boardAccessMode`، `assignableBoardRole` |
| `src/api/{primitives,user,team,board,error,rt-token}.ts` | DTOهای API — گام ۲٫۲/۲٫۳ی M3 (PLAN §۵٫۱، ADR-042) |

## آنچه هنوز اینجا نیست (به ترتیب نیاز)

- DTOهای `Template`/`Comment`/`Plan`/`Subscription`/`Invoice` و فیلدهای مالیِ `Team` — فاز ۱۰/M4
  (طبق اصلِ «چیزی بدونِ مصرف‌کننده اضافه نکن»)
- ✅ `User`/`Team`/`Board` + کدهای خطا + `rtTokenClaims`: گام ۲٫۲/۲٫۳ی M3

## دستورات

```bash
pnpm --filter @hamboom/shared-types test
pnpm --filter @hamboom/shared-types typecheck
```
