# CLAUDE.md — `@hamboom/auth-core`

منطقِ احراز هویت و نقش. **بخشِ حساس‌ترین فاز M3 (فاز ۴).** JWT، `effectiveBoardRole`، `BoardAuthority`.

★ **منطقِ خالص + پورت است، نه اپ.** پیاده‌سازیِ DBِ پورت‌ها (`BoardAccessReader`، refresh/OTP store)
در `apps/api` (فاز ۵) است. auth-core `pg`/`ioredis`/`@aws-sdk` را نمی‌بیند (گیتِ `authCoreBoundaries`).

**قبل از کار بخوان:** [ADR-011](../../ARCHITECTURE_DECISIONS.md#adr-011) (JWT/OTP/refresh) ·
[ADR-012](../../ARCHITECTURE_DECISIONS.md#adr-012) (نقشِ موثر) · [PROGRESS-M3 §تصمیم‌های باز](../../PROGRESS-M3-backend-api.md)
(OD-1/OD-3) · پورتِ `BoardAuthority` در [`apps/realtime/src/auth/board-authority.ts`](../../apps/realtime/src/auth/board-authority.ts).

## خط قرمزها

1. ★★ **سه سدِ حفره‌ی `exp` — هر سه لازم** (probe ۱٫۳): `algorithms:["HS256"]`ِ صریح در `jwtVerify`
   (`alg:none` رد)؛ **یک** signer که `exp` را از **ثانیه** حساب می‌کند؛ و **سقفِ آینده**
   (`exp - now > 2×TTL` → رد). probe ثابت کرد `jose` **تنها** سومی را نمی‌گیرد (سالِ ~۵۸۶۰۷). ★ تستِ
   «exp-in-ms → رد» با شکستنِ عمدی قرمز شد. **هر سه را نگه دار.**
2. ★★ **`effectiveBoardRole` fail-closed است:** هیچ منبعی → `null`. و ⚠️ **`undefined`≠`null`** در
   `currentRole` — auth-core همیشه نظر دارد پس **هرگز `undefined`** برنمی‌گرداند (فقط dev-impl می‌داد).
3. ★★ **گیتینگِ `access_mode` (OD-1):** مسیرِ تیم فقط `access_mode='team'`؛ `private` → فقط مالک +
   `board_members` + staff؛ حالتِ لینک → مسیرِ تیم خاموش. **دست‌کاریِ این یعنی حفره‌ی دسترسی.**
4. ⚠️ **OD-3 — قیدِ `member→editor`:** فقط تا وقتی عضویتِ تیم با افزودنِ **عمدی** است معتبر است. عضویتِ
   باز (لینکِ دعوت، ثبت‌نامِ خودکار) → بازنگریِ `mapTeamRole` لازم. کامنتش را در `roles.ts` نگه دار.
5. **راز param است، نه `process.env`** (PLAN §۴): config می‌خواندش، auth-core می‌گیرد. HS256 (زیرساختِ
   مورداعتماد؛ realtime از قبل مورداعتماد است، پس نامتقارن سطحِ حمله‌ی تازه اضافه نمی‌کند).
6. **`BoardAuthority` هم‌شکل، نه import:** interfaceش در `apps/realtime` است و پکیج اپ را import نمی‌کند؛
   `createAuthCoreBoardAuthority` یک شیءِ **هم‌شکل** می‌سازد و فاز ۷ با `satisfies BoardAuthority` تزریق
   می‌کند + `TokenError` را به کدِ پروتکلی نگاشت می‌دهد (الگوی `StorageSnapshotStore`).

## ساختار

| فایل | چیست | گام |
|---|---|---|
| `src/tokens.ts` | JWT (jose): `signRtToken`/`verifyRtToken` (قفلِ exp) + access | ۴٫۱ |
| `src/roles.ts` | `effectiveBoardRole` (ADR-012، OD-1/OD-3) | ۴٫۲ |
| `src/board-authority.ts` | `AuthCoreBoardAuthority` (verify + currentRole) + `BoardAccessReader` | ۴٫۳ |
| `src/refresh.ts` | refreshِ چرخشی + تشخیصِ استفاده‌ی مجدد (سوزاندنِ خانواده) + `SessionStore` | ۴٫۱ |
| `src/otp.ts` | OTP (hash، rate-limit، ضدِ enumeration، P7) + `SmsProvider`/Mock + `OtpStore` | ۴٫۴ |
| `probe/jose-probe.ts` | ⚠️ probeِ jose (خارج از verify) — رفتارِ exp/alg:none | ۴٫۱ |

## دستورات

```bash
pnpm --filter @hamboom/auth-core typecheck
pnpm --filter @hamboom/auth-core test
node packages/auth-core/probe/jose-probe.ts   # رفتارِ jose
```

## چیزهایی که اینجا انجام نمی‌شوند

جدول‌های `users`/`auth_sessions`/`otp_challenges` و **پیاده‌سازیِ DBِ پورت‌ها** (`BoardAccessReader`،
`SessionStore`، `OtpStore`) — کارِ `apps/api` (فاز ۵)؛ endpointهای HTTP احراز هویت؛ و سوییچِ کاوه‌نگار
(env). ⚠️ **قیدِ فاز ۵:** «یافتن+markUsed»ِ `rotateSession` باید در **یک تراکنشِ DB** اتمی باشد
(`SELECT … FOR UPDATE`)، وگرنه دو درخواستِ همزمانِ سالم هر دو `used=false` می‌بینند. منطق کامل است.
