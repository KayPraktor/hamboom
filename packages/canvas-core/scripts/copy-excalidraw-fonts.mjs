#!/usr/bin/env node
/**
 * کپی فونت‌های Excalidraw به پوشه‌ی استاتیک دمو.
 *
 * **چرا لازم است:** اگر `window.EXCALIDRAW_ASSET_PATH` ست نشود، Excalidraw
 * فونت‌هایش را از `https://esm.sh/@excalidraw/excalidraw@<version>/dist/prod/`
 * دانلود می‌کند. این هم اصل P2 را نقض می‌کند (بدون سرویس خارجی در runtime) و هم
 * از داخل ایران غیرقابل‌اتکاست. پس فونت‌ها باید خودمیزبان شوند.
 *
 * مقصد در `.gitignore` است — این‌ها ۱۴ مگابایت فایل تولیدی‌اند، نه کد.
 *
 * اجرا: خودکار قبل از `dev`, `build:demo` و `test` (هوک‌های pre* در package.json)
 */

import { createRequire } from "node:module";
import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "..");

/** پوشه‌ای که `EXCALIDRAW_ASSET_PATH` به آن اشاره می‌کند (نسبت به ریشه‌ی سرو استاتیک). */
const TARGET = join(PKG_ROOT, "dev", "public", "excalidraw-assets");
const FONTS_TARGET = join(TARGET, "fonts");
const STAMP = join(TARGET, ".version");

function findExcalidrawRoot() {
  // نگاشت exports پکیج، ./package.json را expose نمی‌کند؛ پس از entry اصلی
  // بالا می‌رویم: <root>/dist/prod/index.js → <root>
  const entry = require.resolve("@excalidraw/excalidraw");
  return resolve(dirname(entry), "..", "..");
}

async function main() {
  const root = findExcalidrawRoot();
  const version = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
  const fontsSource = join(root, "dist", "prod", "fonts");

  if (!existsSync(fontsSource)) {
    console.error(`✖ پوشه‌ی فونت Excalidraw پیدا نشد: ${fontsSource}`);
    console.error("  ساختار پکیج بالادست عوض شده — این اسکریپت باید به‌روز شود.");
    process.exit(1);
  }

  // اگر همین نسخه قبلاً کپی شده، دوباره کار نکن.
  if (existsSync(STAMP) && (await readFile(STAMP, "utf8")).trim() === version) {
    return;
  }

  await rm(FONTS_TARGET, { recursive: true, force: true });
  await mkdir(TARGET, { recursive: true });
  await cp(fontsSource, FONTS_TARGET, { recursive: true });
  await writeFile(STAMP, `${version}\n`, "utf8");

  console.log(
    `✔ فونت‌های Excalidraw ${version} خودمیزبان شدند → dev/public/excalidraw-assets/fonts`,
  );
}

await main();
