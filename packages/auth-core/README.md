# `@hamboom/auth-core`

هسته‌ی امنیتیِ پروژه — احراز و نقش، **بدونِ HTTP و بدونِ DB**. توابعِ خالص + پورت‌ها،
تا **api و realtime هر دو از یک منبع** مصرف کنند ([ADR-012](../../ARCHITECTURE_DECISIONS.md#adr-012)):
یک تعریفِ نقش، یک امضاکننده‌ی توکن، یک منطقِ OTP.

> برای کار کردن **روی** این پکیج [`CLAUDE.md`](CLAUDE.md) را بخوان. این فایل برای **مصرف‌کننده** است.

## چه می‌دهد

- **`effectiveBoardRole(input)`** — نقشِ **موثرِ** کاربر روی بورد (owner/editor/commenter/viewer یا `null`).
  api و realtime **هردو** همین را صدا می‌زنند؛ api روی هر request، realtime روی اتصال (نقش در session کش می‌شود).
- **`signRtToken(secret, claims, ttl)` / verify** — توکنِ کوتاه‌عمرِ اتصالِ realtime (HS256).
  ⚠️ `exp` را **خودِ امضاکننده** از ثانیه می‌سازد (قفلِ `exp`، [ADR-011](../../ARCHITECTURE_DECISIONS.md#adr-011)).
- **JWT + refreshِ چرخشی** — accessِ کوتاه‌عمر + refreshی که با هر مصرف **می‌چرخد** (نشتِ یک refresh = یک پنجره‌ی کوتاه).
- **OTP** — تولید/سنجش با `code_hash` (کدِ خام هرگز ذخیره نمی‌شود، P7)؛ درگاهِ پیامک یک **پورت** است
  (`SmsProvider`) با `createMockSmsProvider`ِ dev که کد را در لاگ چاپ می‌کند (بدونِ حسابِ واقعی، P3).
- **`maskPhone`** — ماسکِ شماره برای لاگ (P7).

## ★★ سه قید که اگر بشکنند، بی‌صدا نشتِ امنیتی می‌سازند

- **fail-closed، و `undefined` ≠ `null`.** `undefined` = «نظری ندارم»، `null` = «دسترسی برداشته شده».
  ⚠️ با `??` یکی می‌شوند و کاربرِ اخراج‌شده تا انقضای توکن وصل می‌مانَد.
- **نقش از `currentRole` می‌آید، نه از claimِ توکن.** توکن نقش را **حمل** می‌کند؛ بدونِ بازسنجی، کاربرِ
  تنزل‌داده‌شده با بستن/بازکردنِ تب دوباره ارتقا می‌گیرد.
- **JWT دستی سنجیده نمی‌شود مگر با سه سدِ حمله:** ردِ `alg: none` · مقایسه‌ی زمان‌ثابت · `exp`ِ اجباری. (تست‌دار.)

## گیتِ production

پیاده‌سازی‌های واقعی جای بدل‌های dev (`DevBoardAuthority` و…) را می‌گیرند و با `APP_ENV=production`
سرور **بالا می‌آید**؛ برعکس، بدلِ dev علامتِ `developmentOnly` دارد و production را **می‌بندد** — گیت روی
خودِ کد است، نه یک پرچمِ config که اولین مسیرِ فراموش‌شده دورش بزند.

## دستورات

```bash
pnpm --filter @hamboom/auth-core test        # داخلِ pnpm verify
pnpm --filter @hamboom/auth-core typecheck
```

## آنچه اینجا انجام نمی‌شود

HTTP/route → [`apps/api`](../../apps/api/) · اتصال/اتاقِ realtime → [`apps/realtime`](../../apps/realtime/) ·
خواندنِ دسترسیِ pg → [`board-access-db`](../board-access-db/) (auth-core فقط تابعِ نقش را می‌دهد، DB را نمی‌بیند).
