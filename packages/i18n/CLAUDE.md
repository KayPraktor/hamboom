# CLAUDE.md — `@hamboom/i18n`

لایه‌ی نمایشِ فارسی/RTL. رشته‌ها، اعداد فارسی، تاریخ جلالی.

**قبل از کار بخوان:** [ADR-016](../../ARCHITECTURE_DECISIONS.md#adr-016) (RTL)،
[ADR-018](../../ARCHITECTURE_DECISIONS.md#adr-018) (تاریخ). اصل **P6**.

## خط قرمزها

1. **فارسی native است، نه ترجمه.** رشته‌ها مستقیم فارسی نوشته می‌شوند.
2. **بدون کتابخانه‌ی تاریخ/عدد.** فقط `Intl` بومی — کلندرِ `persian` و locale
   `fa-IR`. `moment-jalaali` و مشابه ممنوع (حجم + P2).
3. **تبدیل فقط در نمایش.** تاریخ در ذخیره‌سازی UTC است، پول ریالِ صحیح (P5).
   `formatToman` تنها جای تقسیم بر ۱۰ است.
4. **بدون وابستگی به پکیج هم‌بومِ دیگر.** ESLint هر `@hamboom/*` را خطا می‌کند.
5. **بدون کد مخصوص یک محیط.** در Node و مرورگر هر دو اجرا می‌شود.

## ساختار

| مسیر | چیست |
|---|---|
| `src/t.ts` | `t(key, params)` + locale — درجِ عددِ فارسی خودکار |
| `src/numbers.ts` | ارقام فارسی، `formatNumber`، پول (ریال/تومان) |
| `src/dates.ts` | تاریخ جلالی با `Intl` (کلندر persian، تهران) |
| `src/strings/fa.ts` | کاتالوگِ رشته‌ها — تنها زبانِ فاز ۱ (Q7) |

## دستورات

```bash
pnpm --filter @hamboom/i18n test
pnpm --filter @hamboom/i18n typecheck
```
