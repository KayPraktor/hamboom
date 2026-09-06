# `@hamboom/billing-core`

منطقِ **خالصِ** پرداخت و اشتراک: پورتِ درگاه، ریاضیِ ریال، دوره‌ی اشتراک، و تصمیمِ آشتی‌دهی.
قرینه‌ی [`auth-core`](../auth-core/) — پورت و ریاضی این‌جا، جدول و تراکنش در
[`apps/api`](../../apps/api/) ([ADR-049](../../ARCHITECTURE_DECISIONS.md#adr-049)).

> ⚠️ **هیچ `pg`، هیچ `fastify`، هیچ UI — و هیچ `process.env`.** هر تابعی که به زمان نیاز
> دارد، لحظه‌ی مرجع را **پارامتر** می‌گیرد و هرگز `new Date()` صدا نمی‌زند.

## چه چیزی این‌جاست

| فایل | چیست |
|---|---|
| [`gateway.ts`](src/gateway.ts) | پورتِ `PaymentGateway` + `VerifyOutcome`ِ **سه‌حالته** + `assertGatewayAllowed` |
| [`mock-gateway.ts`](src/mock-gateway.ts) | درگاهِ توسعه — **پیش‌فرضِ `PAYMENT_PROVIDER`** (P2/P3) |
| [`zarinpal-gateway.ts`](src/zarinpal-gateway.ts) | آداپتورِ زرین‌پال، نوشته‌شده از روی **اندازه‌گیریِ زنده** نه مستندات |
| [`money.ts`](src/money.ts) | `computeCharge` + **یک** قاعده‌ی گِردکردن + کف/سقفِ درگاه |
| [`period.ts`](src/period.ts) | دوره‌ی اشتراک، شماره‌ی فاکتورِ جلالی، `addUtcMonths`ِ clamp‌دار |
| [`reconcile.ts`](src/reconcile.ts) | تصمیمِ **خالصِ** sweep + تطبیقِ ردیفِ یتیم |

## استفاده

```ts
import { computeCharge, computePeriod, MockGateway, planSweep } from "@hamboom/billing-core";

const charge = computeCharge({ plan, period: "monthly", seats: 3, coupon, vatPercent: 0 });
// { subtotalRial, discountRial, vatRial, totalRial, lineItems }

const gateway = new MockGateway({ checkoutBaseUrl: "http://localhost:3410/billing/mock/pay" });
const { authority, redirectUrl } = await gateway.createPayment({ amountRial: charge.totalRial, … });
const verdict = await gateway.verifyPayment({ authority, amountRial: charge.totalRial });
```

## ★★ پنج چیزی که اگر ندانی، بی‌صدا پول از دست می‌رود

۱. **`VerifyOutcome` سه حالت دارد، نه دو.** `notPaid` («کاربر هنوز پول نداده») از
   `gatewayError` («نمی‌دانیم») جداست، چون **دو تصمیمِ متفاوت** می‌سازند. یکی‌کردنشان یعنی یا
   پرداختِ واقعی را گم می‌کنی یا یک ردیفِ مرده برای همیشه نگه می‌داری.
۲. **`alreadyVerified` را تخت نکن.** کدِ ۱۰۰ و ۱۰۱ هر دو یعنی «پول گرفته شده»، ولی فقط
   وضعیتِ ردیفِ خودمان تصمیم می‌گیرد که فعال‌سازی رخ دهد یا نه
   ([ADR-055](../../ARCHITECTURE_DECISIONS.md#adr-055)).
۳. **`developmentOnly` شوخی نیست.** `MockGateway` همیشه «پرداخت شد» می‌گوید؛ اگر در
   production بالا بیاید **هر اشتراکی رایگان فعال می‌شود** و هیچ تستی نمی‌گیردش (چون تست‌ها
   عمداً همین را تزریق می‌کنند). گیتش `assertGatewayAllowed` است و باید در مسیرِ **ساختِ اپ**
   صدا زده شود.
۴. **مبلغِ verify باید همان مبلغِ ساخت باشد.** اندازه‌گیری‌شده: اختلافِ **یک ریال** خطای `-50`
   می‌دهد و یک مشتریِ واقعاً پرداخت‌کرده را ناموفق ثبت می‌کند. پس از `payments.amount_rial`
   خوانده می‌شود، نه بازمحاسبه از `plans`.
۵. **`-1` یعنی نامحدود.** مقایسه‌ی ساده‌ی `count >= max` روی پلنِ نامحدود همه‌چیز را می‌بندد.

## ★★ قراردادِ زرین‌پال — با تماسِ **زنده** اثبات شد، نه از مستندات نقل

- میزبان **`payment.zarinpal.com`** (نه `api.zarinpal.com`) · `pg/v4/payment/{request,verify}.json`
- **هرگز روی `res.ok` شاخه نزن:** خطای عادیِ کسب‌وکار **non-2xx** است (`-51` ⇒ HTTP ۴۰۱).
- `errors` بینِ موفق و ناموفق **تغییرِ نوع می‌دهد**: `[]` در برابرِ `{message, code}`.
- **verifyِ اول `100`، هر verifyِ بعدیِ همان تراکنش `101`** — و ۱۰۱ شکلِ **موفق** دارد.
- واحد ریال، ولی `IRT` هم مجاز ⇒ همیشه صریح `"currency":"IRR"` (اشتباهش = ضریبِ ۱۰).
- کف **۱۰۰۰ ریال**. ⚠️ authorityِ پرداخت‌نشده منقضی می‌شود (~۲۰ دقیقه دیده شد).
- ⚠️ **`listUnverified` تنها متدی است که با تماسِ زنده اثبات نشده** — به یک تراکنشِ
  پرداخت‌شده‌ی verify‌نشده روی حسابِ واقعی نیاز دارد. پس تدافعی خوانده می‌شود و هر انحراف را
  به فهرستِ خالی ترجمه می‌کند، نه به استثنا.

## نردبانِ تصمیمِ آشتی‌دهی ([ADR-056](../../ARCHITECTURE_DECISIONS.md#adr-056))

```
جوان‌تر از آستانه            ⇒ دست نزن (کاربر ممکن است روی صفحه‌ی بانک باشد)
بدونِ authority              ⇒ یتیم — گزارش، هرگز شکست‌خورده‌ی خودکار
کهنه **و** قبلاً پرسیده‌شده  ⇒ باطل
وگرنه                        ⇒ از درگاه بپرس
```

★★ **هیچ ردیفی پیش از دستِ‌کم یک پرسش باطل نمی‌شود.** ایندکسِ sweep روی `status='pending'`
است، پس یک `failed`ِ زودهنگام پرداختِ احتمالاً‌پرداخت‌شده را **برای همیشه** نامرئی می‌کند.

## پوشش

**۹۰٪** (نه ۶۰٪ی بقیه) — [ADR-049](../../ARCHITECTURE_DECISIONS.md#adr-049)/M4-D7. کدِ پول
تنها جایی است که یک شاخه‌ی آزموده‌نشده مستقیماً به پولِ گم‌شده ترجمه می‌شود.

```bash
pnpm --filter @hamboom/billing-core test           # داخلِ pnpm verify
pnpm billing:probe-math                            # ریاضیِ ریال + مرزِ سالِ جلالی (بدونِ DB)
pnpm billing:probe-gateway -- --request            # ★ تماسِ زنده با سندباکس (اینترنت لازم)
```

## آنچه این‌جا انجام نمی‌شود

جدول و تراکنش → [`apps/api/src/services/`](../../apps/api/src/services/) · UI →
[`apps/web/src/billing/`](../../apps/web/src/billing/) · استردادِ کامل (`refund`) و `reverse`
→ **M6** (GraphQL+OAuth و whitelistِ IP؛ در dev اجراناپذیر) · فاکتورِ PDF → بعد از `apps/worker`.
