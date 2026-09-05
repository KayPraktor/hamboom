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
| `src/api/billing.ts` | ★ پلن/اشتراک/فاکتور — فاز ۲ی M4 ([ADR-054](../../ARCHITECTURE_DECISIONS.md#adr-054)) |

## ★★ پولْ primitiveِ خودش را دارد

هر فیلدِ مبلغ از `rial` (`primitives.ts`) می‌آید، **نه `z.number()`ِ خام**. دلیلش این است
که `z.number()` مقدارِ `1234.5` ریال را بی‌صدا می‌پذیرد و floatِ پول تا دیتابیس می‌رود —
نقضِ P5 بدونِ هیچ علامتِ قرمزی. با `rial`، `.int()` **یک‌بار** نوشته می‌شود.

دو قاعده‌ی دیگر که تست پینشان می‌کند: هیچ فیلدِ پولیِ **پاسخ** `.optional()` نیست (فقط
`.nullable()` — چون sdk پاسخ را اعتبارسنجی نمی‌کند و `undefined` تا مرورگر می‌رود)، و
`checkoutBody` **هیچ فیلدِ ریالی ندارد** (ADR-014: مبلغ از کلاینت پذیرفته نمی‌شود).

## آنچه هنوز اینجا نیست (به ترتیب نیاز)

- `Template`/`Comment` — فاز ۱۰ی M3 (به تعویق)
- `Coupon` — عمداً نیامد (M4-D2b): شکلش در PLAN §۵٫۱ اصلاً وجود ندارد
- **فیلدهای مالیِ `Team`** (`planCode`/`subscriptionStatus`/`limits`/`usage`) — مصرف‌کننده
  دارند ولی **منبعِ داده ندارند** تا seedِ پلن‌ها در فاز ۴ی M4 بیاید؛ به فاز ۵ موکول شد
- ✅ `User`/`Team`/`Board` + کدهای خطا + `rtTokenClaims`: گام ۲٫۲/۲٫۳ی M3
- ✅ `Plan`/`Subscription`/`Invoice` + `rial`: فاز ۲ی M4

## دستورات

```bash
pnpm --filter @hamboom/shared-types test
pnpm --filter @hamboom/shared-types typecheck
```
