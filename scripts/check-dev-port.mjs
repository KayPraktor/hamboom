#!/usr/bin/env node
/**
 * پیش‌بررسیِ پورتِ سرورِ dev — تبدیلِ یک خطای گنگِ محیطی به یک پیامِ صریح.
 *
 * ── چرا لازم شد ───────────────────────────────────────────────────────
 *
 * روی ویندوز، Hyper-V/WSL محدوده‌هایی از **بازه‌ی dynamic port** را برای خودش
 * رزرو می‌کند و `bind` روی آن‌ها `EACCES` می‌دهد. این محدوده‌ها **با هر بوت عوض
 * می‌شوند**، پس یک روز سرورِ dev بالا می‌آید و روزِ بعد نه — بدونِ اینکه یک خط کد
 * عوض شده باشد. خروجیِ خامش هم گمراه‌کننده است:
 *
 *     Error: listen EACCES: permission denied 127.0.0.1:5181
 *
 * که خیلی راحت با «مشکل دسترسی/فایروال/پورت اشغال» اشتباه گرفته می‌شود. اگر یک
 * روز تست‌های E2E قرمز شوند، باید **فوراً** معلوم باشد که تقصیرِ کد نیست.
 *
 * ── چرا فقط «پورت را عوض کن» کافی نبود ────────────────────────────────
 *
 * چون محدوده‌ها تصادفی‌اند، جابه‌جا کردن به یک پورتِ آزادِ دیگر فقط شیر یا خط است.
 * راهِ درست بیرون‌رفتن از **کلِ بازه‌ی dynamic** است — کاری که پورت‌های ۱۵۱۸۰/۱۵۲۸۰
 * می‌کنند. این اسکریپت شبکه‌ی ایمنیِ آن تصمیم است، نه جایگزینش.
 *
 * اجرا: `node scripts/check-dev-port.mjs <port>` — در هوکِ `predev` هر پکیج.
 */
import { createServer } from "node:net";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0) {
  console.error("استفاده: node scripts/check-dev-port.mjs <port>");
  process.exit(2);
}

/** آیا می‌شود روی این پورت گوش داد؟ */
function probe(candidate) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", (error) => resolve(error.code ?? "UNKNOWN"));
    server.once("listening", () => server.close(() => resolve(null)));
    server.listen(candidate, "127.0.0.1");
  });
}

const code = await probe(port);
if (code === null) process.exit(0);

if (code === "EADDRINUSE") {
  console.error(
    `\n‏[hamboom] پورت ${port} همین حالا اشغال است — احتمالاً یک سرورِ dev دیگر بالاست.\n` +
      "‏اگر عمدی است مشکلی نیست (Playwright از همان استفاده می‌کند)؛ وگرنه ببندش.\n",
  );
  // اشغال بودن لزوماً خطا نیست: `reuseExistingServer` در Playwright همین را می‌خواهد.
  process.exit(0);
}

if (code === "EACCES") {
  console.error(
    [
      "",
      `‏[hamboom] پورت ${port} توسطِ ویندوز رزرو شده است — این یک مشکلِ محیطی است، نه باگِ کد.`,
      "",
      "‏Hyper-V/WSL محدوده‌هایی از بازه‌ی dynamic port را برای خودش برمی‌دارد و",
      "‏این محدوده‌ها **با هر بوت عوض می‌شوند**. برای دیدنشان:",
      "",
      "‏  netsh interface ipv4 show excludedportrange protocol=tcp",
      "‏  netsh int ipv4 show dynamicport tcp",
      "",
      "‏پورت‌های dev این ریپو (۱۵۱۸۰ و ۱۵۲۸۰) عمداً **بیرونِ** بازه‌ی dynamic انتخاب",
      "‏شده‌اند تا این اتفاق نیفتد. اگر باز هم دیدی‌اش، یعنی بازه‌ی dynamic این ماشین",
      "‏غیرعادی پهن است؛ یک پورتِ بالاتر انتخاب کن و در `vite.config.ts` و",
      "‏`playwright.config.ts` همان پکیج عوضش کن.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

console.error(`\n‏[hamboom] پورت ${port} قابلِ استفاده نیست (کدِ خطا: ${code}).\n`);
process.exit(1);
