#!/usr/bin/env node
/**
 * ★ گیتِ نهایی — **تنها چیزی که «سبز» بودنش قابلِ استناد است.**
 *
 * ── چرا این اسکریپت وجود دارد ─────────────────────────────────────────
 *
 * در گام ۱٫۲ کشف شد که `pnpm lint` می‌تواند **سبز گزارش کند در حالی که واقعاً
 * می‌افتد**. علت — که با آزمایش پیدا شد، نه حدس — کشِ turbo **نبود**: یک پروکسیِ
 * بهینه‌سازِ خروجی (`rtk`) که در محیطِ توسعه روی دستورهای شناخته‌شده‌ی pnpm سوار
 * می‌شود، خروجی را خلاصه می‌کرد و اجرای شکست‌خورده را به
 * «ESLint: No issues found» با **exit 0** تبدیل می‌کرد.
 *
 * بازتولیدِ قطعی (با یک فایلِ عمداً خراب در `packages/ydoc-schema/src/`):
 *
 *     pnpm lint            → «No issues found»، exit 0   ❌ سبزِ دروغین
 *     npx turbo run lint   → خطای واقعی، exit 1          ✅
 *     rtk proxy pnpm lint  → خطای واقعی                  ✅
 *
 * **چرا این از یک باگِ معمولی بدتر است:** هر تاییدی که بر پایه‌ی «گیت‌ها سبز بود»
 * داده شده، ممکن است از همین مسیر آمده باشد. یک گیت که می‌تواند دروغ بگوید،
 * بدتر از نداشتنِ گیت است — چون به آن اعتماد می‌شود.
 *
 * ── راه‌حل ─────────────────────────────────────────────────────────────
 *
 * ۱. **دور زدنِ لایه‌ی فیلتر:** همه‌چیز از راهِ `turbo`ِ مستقیم اجرا می‌شود، نه
 *    اسکریپت‌های `pnpm`ِ بازنویسی‌شده. (`node scripts/*` فیلتر نمی‌شود.)
 * ۲. **اعتماد نکردن به متنِ خروجی:** تصمیم فقط بر اساسِ **کدِ خروجِ فرایند** است.
 * ۳. `--force` روی taskهای turbo — نه به‌خاطرِ آن باگ، بلکه چون گیتِ نهایی باید
 *    ثابت کند دستورها **اجرا شدند**، نه اینکه روزی پاس شده بودند.
 *
 * اجرا: `pnpm verify` — قبل از تیک‌زدنِ هر گام و قبل از هر کامیت.
 */
import { spawnSync } from "node:child_process";

/**
 * دستورها به‌صورت **رشته‌ی کامل** اجرا می‌شوند (نه command+args با `shell: true`)،
 * چون Node برای آن ترکیب هشدارِ منسوخ‌شدگی می‌دهد و هشدار در خروجیِ گیت نویز است.
 * ورودی‌ها ثابت و درون‌کدند، پس رشته بودنشان سطحِ حمله‌ای اضافه نمی‌کند.
 *
 * @type {{ name: string, run: string }[]}
 */
const GATES = [
  // ریشه جدا از turbo است: `scripts/**` را هیچ پکیجی پوشش نمی‌دهد.
  { name: "typecheck (ریشه)", run: "npx tsc -p tsconfig.json" },
  { name: "typecheck (پکیج‌ها)", run: "npx turbo run typecheck --force" },
  { name: "lint", run: "npx turbo run lint --force" },
  { name: "test", run: "npx turbo run test --force" },
  // گیتِ اصل P1 — شاملِ self-testِ ارزیابِ SPDX.
  { name: "license", run: "node scripts/license-check.ts --self-test" },
  { name: "license (درخت)", run: "node scripts/license-check.ts" },
];

const results = [];
let failed = false;

for (const gate of GATES) {
  process.stdout.write(`\n▶ ${gate.name}\n`);
  const result = spawnSync(gate.run, { stdio: "inherit", shell: true });

  // ★ تصمیم فقط با کدِ خروج — متنِ خروجی می‌تواند دروغ بگوید.
  const ok = result.status === 0;
  results.push({ name: gate.name, ok, status: result.status });
  if (!ok) failed = true;
}

process.stdout.write("\n" + "─".repeat(52) + "\n");
for (const { name, ok, status } of results) {
  process.stdout.write(`${ok ? "✔" : "✖"} ${name}${ok ? "" : `  (exit ${status})`}\n`);
}
process.stdout.write("─".repeat(52) + "\n");

if (failed) {
  process.stdout.write("\n✖ گیت قرمز است. تیک نزن، کامیت نکن.\n\n");
  process.exit(1);
}
process.stdout.write("\n✔ همه‌ی گیت‌ها واقعاً اجرا شدند و سبزند.\n\n");
