#!/usr/bin/env node
/**
 * کپیِ فونت‌های Excalidraw به `public/excalidraw-assets/` — همان کاری که دموی
 * `canvas-core` می‌کند، این‌بار برای اپِ واقعی.
 *
 * **چرا لازم است:** اگر `window.EXCALIDRAW_ASSET_PATH` ست نشود، Excalidraw فونتش
 * را از `https://esm.sh/@excalidraw/...` می‌گیرد — نقضِ P2 (سرویسِ خارجی در
 * runtime) و از داخلِ ایران غیرقابل‌اتکا. پس فونت‌ها خودمیزبان می‌شوند.
 *
 * مقصد در `.gitignore` است — ۱۴ مگابایت فایلِ تولیدی، نه کد. خودکار در predev/prebuild.
 */

import { createRequire } from "node:module";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "..");

/** پوشه‌ای که `EXCALIDRAW_ASSET_PATH` (=`/excalidraw-assets/`) به آن اشاره می‌کند. */
const TARGET = join(PKG_ROOT, "public", "excalidraw-assets");
const FONTS_TARGET = join(TARGET, "fonts");
const STAMP = join(TARGET, ".version");

function findExcalidrawRoot() {
  const entry = require.resolve("@excalidraw/excalidraw");
  return resolve(dirname(entry), "..", "..");
}

async function main() {
  const root = findExcalidrawRoot();
  const version = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
  const fontsSource = join(root, "dist", "prod", "fonts");

  if (!existsSync(fontsSource)) {
    console.error(`✖ پوشه‌ی فونتِ Excalidraw پیدا نشد: ${fontsSource}`);
    process.exit(1);
  }

  if (existsSync(STAMP) && (await readFile(STAMP, "utf8")).trim() === version) {
    return;
  }

  await rm(FONTS_TARGET, { recursive: true, force: true });
  await mkdir(TARGET, { recursive: true });
  await cp(fontsSource, FONTS_TARGET, { recursive: true });
  await writeFile(STAMP, `${version}\n`, "utf8");

  console.log(`✔ فونت‌های Excalidraw ${version} خودمیزبان شدند → public/excalidraw-assets/fonts`);
}

await main();
