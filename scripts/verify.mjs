#!/usr/bin/env node
/**
 * ★ گیتِ نهایی — **تنها چیزی که «سبز» بودنش قابلِ استناد است.**
 *
 * ── چرا این اسکریپت وجود دارد ─────────────────────────────────────────
 *
 * در گام ۱٫۲ (M2) `pnpm lint` گزارش داد «ESLint: No issues found» با **exit 0**، در
 * حالی که دو خطای واقعیِ لینت وجود داشت — `npx turbo run lint --force` همان لحظه
 * هر دو را پیدا کرد.
 *
 * ⚠️ **علتش ایزوله نشد.** دو فرضیه آزموده شد و هیچ‌کدام تکرار نشد: کشِ کهنه‌ی turbo
 * (فایلِ untracked با خطا را turbo بدونِ `--force` هم می‌گیرد) و فیلترِ پروکسیِ
 * خروجی (`pnpm lint` در سه تلاشِ کنترل‌شده درست exit 1 داد). پس این فایل **ادعا
 * نمی‌کند** که مقصر کدام بود.
 *
 * **چرا با وجودِ نامعلوم بودنِ علت، این گیت درست است:** هر سه لایه‌ی دفاعی را
 * می‌گذارد، پس مستقل از اینکه کدام فرضیه درست بوده کار می‌کند —
 *
 * ۱. اجرا از راهِ `turbo`ِ مستقیم، نه اسکریپت‌های `pnpm`ِ عبوری از پروکسی.
 * ۲. `--force`، پس هیچ نتیجه‌ای از کش نمی‌آید.
 * ۳. ★ تصمیم فقط با **کدِ خروجِ فرایند**، نه با متنِ خروجی.
 *
 * **چرا این از یک باگِ معمولی جدی‌تر است:** هر تاییدی که بر پایه‌ی «گیت‌ها سبز بود»
 * داده شده، ممکن است از همان مسیر آمده باشد. یک گیت که می‌تواند دروغ بگوید، بدتر
 * از نداشتنِ گیت است — چون به آن اعتماد می‌شود.
 *
 * ── ★ چرا `--concurrency=1` (گام ۲٫۳) ─────────────────────────────────
 *
 * turbo پیش‌فرض تا ۱۰ task را **موازی** اجرا می‌کند. هر task یک vitest است و هر
 * vitest چند workerِ Node — یعنی ده‌ها فرایند که هرکدام heapِ V8 خودش را commit
 * می‌کند. روی ویندوز سقفِ commit (RAM + page file) است، نه RAM؛ در گام ۲٫۳ با
 * ۷GB **رمِ آزاد** ولی commit پرِ ۳۴٫۵ از ۴۰٫۶ گیگ، **هر ۸ پکیج** با
 * `FATAL ERROR: ... out of memory` افتادند. سریالی همان لحظه سبز شد.
 *
 * ⚠️ این یک شکستِ **محیطی** بود که شبیهِ شکستِ کد به نظر می‌رسید — همان کلاسی که
 * پورت‌های رزروشده‌ی ویندوز در گام ۱٫۱ ساختند. درسِ آنجا: عددی انتخاب نکن که
 * شیر یا خط است؛ از رژیمِ شکست **خارج شو**. پس `--concurrency=2` هم انتخاب نشد —
 * روی یک ماشینِ شلوغ‌تر باز همان قمار بود.
 *
 * هزینه‌اش ~۱۰ ثانیه (۹s → ۱۹s). گیت **ضعیف نمی‌شود**: همان taskها، همان
 * `--force`، و تصمیم همچنان فقط با کدِ خروج.
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
  // ★ `--concurrency=1` — دلیلش در صدرِ فایل. سریالی، تا سبز/قرمزِ گیت به
  //    فشارِ حافظه‌ی لحظه‌ی اجرا وابسته نباشد.
  { name: "typecheck (پکیج‌ها)", run: "npx turbo run typecheck --force --concurrency=1" },
  { name: "lint", run: "npx turbo run lint --force --concurrency=1" },
  { name: "test", run: "npx turbo run test --force --concurrency=1" },
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
