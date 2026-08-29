# CLAUDE.md — `@hamboom/board-access-db`

پیاده‌سازیِ pgِ پورتِ `BoardAccessReader` (auth-core). **افزوده‌ی M3 فاز ۷ — منبعِ واحد برای `apps/api`
و `apps/realtime`.**

★ **چرا یک پکیجِ جدا:** این کوئری داده‌ای می‌دهد که `effectiveBoardRole` روی آن **تصمیمِ دسترسی** می‌گیرد.
اگر api و realtime دو کپیِ واگرا داشتند، یکی می‌گفت `viewer` و دیگری `editor` — همان ناسازگاریِ امنیتیِ
[ADR-012](../../ARCHITECTURE_DECISIONS.md#adr-012). یک تعریف، دو مصرف‌کننده، دریفتِ غیرممکن ([ADR-046](../../ARCHITECTURE_DECISIONS.md#adr-046)).

## خط قرمزها

1. ★ **این فقط یک کوئری است، نه لایه‌ی سرور.** `pg` مجاز؛ ولی UI، بوم/Yjs، `sdk`، `storage`، و شبکه/بروکرِ
   دیگر (`ws`/`ioredis`/`@aws-sdk`) ممنوع (گیتِ `boardAccessDbBoundaries`، خودآزمونِ سه‌لایه).
2. ★ **`Queryable` تزریق می‌شود** — پکیج خودش pool نمی‌سازد و `process.env` نمی‌خواند؛ اپ نمونه‌اش (`Pool`
   یا `PoolClient`ِ تراکنش) را می‌دهد.
3. ★★ **DP-4 در همین کوئری است:** `hasValidLink` فقط وقتی true است که گرنتِ کاربر با `link_token_hash`ِ
   **فعلیِ** بورد بخواند (ابطالِ خودکار). اگر این را دست زدی، هم api هم realtime را با هم می‌سنجی.

## دستورات

```bash
pnpm --filter @hamboom/board-access-db typecheck
pnpm --filter @hamboom/board-access-db lint
```

★ تستِ رفتاریِ کوئری روی Postgresِ زنده است (`pnpm db:fk-test` غیرمستقیم، و سنجه‌های `rt:*`ِ فاز ۷ + curlِ
api آن را زنده اجرا می‌کنند)؛ اینجا unit ندارد چون منطقش SQL است، نه شاخه‌ی درون‌حافظه‌ای.

## چیزهایی که اینجا انجام نمی‌شوند

منطقِ `effectiveBoardRole` (کارِ [`auth-core`](../auth-core/) — این فقط **داده** می‌دهد)، ساختِ pool
(کارِ اپ)، و هر endpoint یا سیاستِ دسترسی.
