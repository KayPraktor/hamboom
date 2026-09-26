import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import { FIXTURES_PATH, readFixtures } from "./fixtures.ts";

/**
 * پاک‌سازیِ فیکسچرها — M6 ردیفِ ۸٫۱.
 *
 * ★★ **این فایل اختیاری نیست.** دو گیتِ دیگرِ همین فاز امروز نشان دادند که تستی که حالتِ
 * مشترک را برنگردانَد، **اجرای بعدیِ خودش** را می‌شکند (و در یک مورد، چهار چکِ بی‌ربط را).
 *
 * ⊕ خودِ حذف در [`e2e-panel-cleanup.ts`](../../../scripts/e2e-panel-cleanup.ts) است، نه این‌جا:
 * ترتیبِ FKها یک دانشِ **دیتابیسی** است و جایش کنارِ بقیه‌ی اسکریپت‌های عملیاتی است، نه داخلِ
 * پیکربندیِ playwright.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..");

export default function globalTeardown(): void {
  if (!existsSync(FIXTURES_PATH)) return;
  const f = readFixtures();
  execFileSync(
    "node",
    [
      "--env-file-if-exists=.env",
      join("scripts", "e2e-panel-cleanup.ts"),
      `--users=${[f.staffUserId, f.targetUserId, f.plainUserId].join(",")}`,
      `--phones=${[f.staffPhone, f.targetPhone, f.plainPhone].join(",")}`,
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  rmSync(FIXTURES_PATH, { force: true });
}
