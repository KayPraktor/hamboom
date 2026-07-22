#!/usr/bin/env node
/**
 * license-check — دروازه‌ی اصل P1 (PLAN.md بخش ۱).
 *
 * هیچ وابستگی‌ای با لایسنس غیرمجاز نباید وارد پروژه شود. این اسکریپت در CI
 * اجرا می‌شود و در صورت تخلف با کد ۱ خارج می‌شود.
 *
 * اجرا:
 *   node scripts/license-check.ts            # فقط وابستگی‌های production (سخت‌گیرانه)
 *   node scripts/license-check.ts --strict   # وابستگی‌های dev را هم خطا در نظر بگیر
 *   node scripts/license-check.ts --verbose  # فهرست کامل لایسنس‌ها را چاپ کن
 *
 * سه سطح:
 *   ALLOWED  → قبول خودکار
 *   REVIEW   → فقط با ثبت صریح در scripts/license-exceptions.json قبول
 *   بقیه     → رد
 *
 * Node 24 فایل TypeScript را مستقیم اجرا می‌کند (type stripping) — نیازی به build نیست.
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const EXCEPTIONS_PATH = join(HERE, "license-exceptions.json");

/** لایسنس‌های مجاز — بدون قید و شرط. */
const ALLOWED = new Set([
  "MIT",
  "MIT-0",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "Unlicense",
  "CC0-1.0",
  "BlueOak-1.0.0",
  "Zlib",
  "Python-2.0",
  "CC-BY-4.0", // نیازمند ذکر منبع؛ برای مصرف کتابخانه‌ای مشکلی ندارد (مثلاً caniuse-lite)
  // ── فونت‌ها ──────────────────────────────────────────────────────
  // SIL Open Font License: استفاده تجاری، توزیع و تغییر آزاد است؛ تنها شرط
  // عملی، فروش نرفتن فونت به‌تنهایی و حفظ نام رزروشده است. با هدف P1 سازگار
  // است و در ADR-017 صریحاً برای Vazirmatn تایید شده.
  "OFL-1.1",
  "OFL-1.1-RFN",
  "OFL-1.1-no-RFN",
]);

/**
 * لایسنس‌هایی که ذاتاً ممنوع نیستند ولی شرط دارند (مثلاً copyleft سطح فایل).
 * فقط با یک ورودی صریح در license-exceptions.json پذیرفته می‌شوند.
 */
const REVIEW = new Set([
  "MPL-2.0",
  "EPL-2.0",
  "CDDL-1.0",
  "Artistic-2.0",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
]);

interface PnpmLicensePackage {
  name: string;
  versions?: string[];
  paths?: string[];
  license?: string;
  homepage?: string;
  author?: string;
}

interface ExceptionEntry {
  package: string;
  license: string;
  reason: string;
  approvedBy: string;
  approvedAt: string;
}

interface Violation {
  package: string;
  license: string;
  scope: "prod" | "dev";
  level: "denied" | "needs-approval";
  homepage: string | undefined;
}

// ─────────────────────────────────────────────────────────────
// ارزیابی عبارت SPDX
// ─────────────────────────────────────────────────────────────

type Verdict = "allowed" | "review" | "denied";

/** بدترین حالت بین دو نتیجه (برای AND) */
function worse(a: Verdict, b: Verdict): Verdict {
  const rank: Record<Verdict, number> = { allowed: 0, review: 1, denied: 2 };
  return rank[a] >= rank[b] ? a : b;
}

/** بهترین حالت بین دو نتیجه (برای OR) */
function better(a: Verdict, b: Verdict): Verdict {
  const rank: Record<Verdict, number> = { allowed: 0, review: 1, denied: 2 };
  return rank[a] <= rank[b] ? a : b;
}

function classifyId(rawId: string): Verdict {
  // "Apache-2.0 WITH LLVM-exception" → استثنا محدودیت را کم می‌کند، پس بخش چپ ملاک است
  const id =
    rawId
      .split(/\s+WITH\s+/i)[0]
      ?.trim()
      .replace(/\+$/, "") ?? "";
  if (id === "") return "denied";
  if (ALLOWED.has(id)) return "allowed";
  if (REVIEW.has(id)) return "review";
  return "denied";
}

/**
 * ارزیابی یک عبارت SPDX مثل `(MIT OR CC0-1.0)` یا `MIT AND Zlib`.
 * OR = بهترین شاخه کافی است. AND = بدترین شاخه تعیین‌کننده است.
 */
function classifyExpression(expr: string): Verdict {
  const text = expr.trim();
  if (
    text === "" ||
    /^unknown$/i.test(text) ||
    /^SEE LICENSE/i.test(text) ||
    text === "UNLICENSED"
  ) {
    return "denied";
  }

  const tokens = text.match(/\(|\)|[^\s()]+/g);
  if (!tokens) return "denied";

  let pos = 0;
  const peek = (): string | undefined => tokens[pos];
  const next = (): string | undefined => tokens[pos++];

  function parseAtom(): Verdict {
    const token = next();
    if (token === undefined) return "denied";
    if (token === "(") {
      const inner = parseOr();
      if (peek() === ")") pos++;
      return inner;
    }
    return classifyId(token);
  }

  function parseAnd(): Verdict {
    let result = parseAtom();
    while (peek()?.toUpperCase() === "AND") {
      pos++;
      result = worse(result, parseAtom());
    }
    return result;
  }

  function parseOr(): Verdict {
    let result = parseAnd();
    while (peek()?.toUpperCase() === "OR") {
      pos++;
      result = better(result, parseAnd());
    }
    return result;
  }

  return parseOr();
}

// ─────────────────────────────────────────────────────────────
// خواندن داده از pnpm
// ─────────────────────────────────────────────────────────────

function collectLicenses(scope: "prod" | "dev"): Record<string, PnpmLicensePackage[]> {
  // فرمان به‌صورت رشته‌ی ثابت ساخته می‌شود (بدون ورودی کاربر) — روی ویندوز
  // pnpm یک فایل .cmd است و بدون shell قابل اجرا نیست.
  const command = `pnpm licenses list --json --recursive ${scope === "prod" ? "--prod" : "--dev"}`;
  let stdout: string;
  try {
    stdout = execSync(command, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    // وقتی هیچ وابستگی‌ای وجود ندارد pnpm ممکن است با کد غیرصفر خارج شود.
    const out = (err.stdout ?? "").trim();
    if (out === "" || out === "{}") return {};
    if (out.startsWith("{") || out.startsWith("[")) {
      stdout = out;
    } else {
      console.error(`✖ اجرای «${command}» شکست خورد.`);
      console.error(err.stderr ?? err.message ?? String(error));
      process.exit(2);
    }
  }

  const trimmed = stdout.trim();
  if (trimmed === "") return {};

  const parsed: unknown = JSON.parse(trimmed);
  if (Array.isArray(parsed)) {
    // شکل قدیمی: آرایه‌ی تخت از پکیج‌ها
    const grouped: Record<string, PnpmLicensePackage[]> = {};
    for (const item of parsed as PnpmLicensePackage[]) {
      const key = item.license ?? "Unknown";
      (grouped[key] ??= []).push(item);
    }
    return grouped;
  }
  return parsed as Record<string, PnpmLicensePackage[]>;
}

function loadExceptions(): Map<string, ExceptionEntry> {
  const map = new Map<string, ExceptionEntry>();
  if (!existsSync(EXCEPTIONS_PATH)) return map;
  const raw: unknown = JSON.parse(readFileSync(EXCEPTIONS_PATH, "utf8"));
  const entries = (raw as { exceptions?: ExceptionEntry[] }).exceptions ?? [];
  for (const entry of entries) map.set(entry.package, entry);
  return map;
}

// ─────────────────────────────────────────────────────────────
// اجرا
// ─────────────────────────────────────────────────────────────

/**
 * خودآزمایی ارزیاب SPDX. بدون این، گیت لایسنس هرگز ثابت نمی‌کند که واقعاً
 * چیزی را رد می‌کند. با `node scripts/license-check.ts --self-test` اجرا شود.
 */
function selfTest(): void {
  const cases: [string, Verdict][] = [
    ["MIT", "allowed"],
    ["Apache-2.0", "allowed"],
    ["(MIT OR CC0-1.0)", "allowed"],
    ["Apache-2.0 WITH LLVM-exception", "allowed"],
    ["MIT AND Zlib", "allowed"],
    ["BSD-3-Clause OR GPL-2.0", "allowed"], // شاخه‌ی مجاز کافی است
    ["MPL-2.0", "review"],
    ["(MPL-2.0 OR GPL-3.0-only)", "review"],
    ["MIT AND MPL-2.0", "review"], // AND: محدودکننده‌ترین شاخه تعیین می‌کند
    ["GPL-3.0-only", "denied"],
    ["AGPL-3.0-or-later", "denied"],
    ["MIT AND GPL-3.0-only", "denied"],
    ["CC-BY-NC-4.0", "denied"],
    ["UNLICENSED", "denied"],
    ["Unknown", "denied"],
    ["SEE LICENSE IN LICENSE.md", "denied"],
    ["", "denied"],
  ];

  let failed = 0;
  for (const [expr, expected] of cases) {
    const actual = classifyExpression(expr);
    if (actual !== expected) {
      failed++;
      console.error(`  ✖ «${expr}» → ${actual} (انتظار: ${expected})`);
    }
  }

  if (failed > 0) {
    console.error(`\n✖ self-test: ${failed} از ${cases.length} مورد شکست خورد.`);
    process.exit(1);
  }
  console.log(`✔ self-test: هر ${cases.length} مورد ارزیاب SPDX درست است.`);
}

function main(): void {
  const argv = process.argv.slice(2);
  const strictDev = argv.includes("--strict");
  const verbose = argv.includes("--verbose");

  if (argv.includes("--self-test")) {
    selfTest();
    return;
  }

  const exceptions = loadExceptions();
  const violations: Violation[] = [];
  const summary = new Map<string, number>();

  for (const scope of ["prod", "dev"] as const) {
    const grouped = collectLicenses(scope);

    for (const [license, packages] of Object.entries(grouped)) {
      summary.set(license, (summary.get(license) ?? 0) + packages.length);
      const verdict = classifyExpression(license);
      if (verdict === "allowed") continue;

      for (const pkg of packages) {
        const approved = exceptions.get(pkg.name);
        if (approved && classifyExpression(approved.license) !== "denied") continue;

        violations.push({
          package: pkg.versions?.length ? `${pkg.name}@${pkg.versions.join(", ")}` : pkg.name,
          license,
          scope,
          level: verdict === "review" ? "needs-approval" : "denied",
          homepage: pkg.homepage,
        });
      }
    }
  }

  if (verbose) {
    console.log("\nلایسنس‌های موجود در درخت وابستگی:");
    const sorted = [...summary.entries()].sort((a, b) => b[1] - a[1]);
    for (const [license, count] of sorted) {
      const mark = classifyExpression(license) === "allowed" ? "✓" : "!";
      console.log(`  ${mark} ${license.padEnd(40)} ${count}`);
    }
    console.log("");
  }

  const blocking = violations.filter((v) => v.scope === "prod" || strictDev);
  const warnings = violations.filter((v) => v.scope === "dev" && !strictDev);

  for (const v of warnings) {
    console.warn(
      `⚠ [dev] ${v.package} — ${v.license} (${v.level}). ` +
        `با --strict این مورد خطا می‌شود.${v.homepage ? ` ${v.homepage}` : ""}`,
    );
  }

  if (blocking.length === 0) {
    const total = [...summary.values()].reduce((a, b) => a + b, 0);
    console.log(`✔ license-check: ${total} پکیج بررسی شد، همه مجاز. (اصل P1)`);
    if (warnings.length > 0) console.log(`  (${warnings.length} هشدار در وابستگی‌های dev)`);
    return;
  }

  console.error(`\n✖ license-check: ${blocking.length} تخلف لایسنس (اصل P1 — PLAN.md بخش ۱)\n`);
  for (const v of blocking) {
    const label = v.level === "needs-approval" ? "نیازمند تایید صریح" : "ممنوع";
    console.error(`  • ${v.package}`);
    console.error(`      لایسنس: ${v.license}  [${label}, ${v.scope}]`);
    if (v.homepage) console.error(`      ${v.homepage}`);
  }
  console.error(
    `\nراه‌حل: یا این وابستگی را حذف/جایگزین کن، یا اگر لایسنسش واقعاً قابل‌قبول است` +
      `\nیک ورودی در ${EXCEPTIONS_PATH} با دلیل و تایید مالک اضافه کن.\n`,
  );
  process.exit(1);
}

main();
