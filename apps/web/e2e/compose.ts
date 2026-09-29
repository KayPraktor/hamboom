import { execFileSync } from "node:child_process";

/**
 * کمک‌کننده‌های استکِ **productionِ محلی** — مشترکِ ردیف‌های ۸٫۳ و ۸٫۵.
 *
 * ⚠️⚠️ **این فایل برای استکی است که از قبل بالاست** و خودش هیچ‌چیز بالا نمی‌آورد؛
 * نبودنش یعنی **شکست**، نه skipِ خاموش (همان قاعده‌ی `playwright.server.config.ts`ِ canvas-sync).
 */

const PROJECT = process.env.E2E_COMPOSE_PROJECT ?? "hamboom-p2";
// ⚠️ `compose run` هم `--env-file` می‌خواهد، نه فقط `up` — وگرنه همه‌ی متغیرها خالی می‌روند
//    و اسکریپت با یک خطای مبهم می‌افتد (دیده شد).
const ENV_FILE = process.env.E2E_COMPOSE_ENV_FILE;
const ARGS = [
  "-f",
  "infra/docker/docker-compose.prod.yml",
  ...(ENV_FILE === undefined ? [] : ["--env-file", ENV_FILE]),
  "-p",
  PROJECT,
];
const ROOT = new URL("../../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

export const compose = (...args: string[]): string =>
  execFileSync("docker", ["compose", ...ARGS, ...args], { cwd: ROOT, encoding: "utf8" });

/**
 * ★★ کدِ ورود از **لاگِ providerِ mock** خوانده می‌شود، نه از `OTP_DEV_FIXED_CODE`.
 *
 * ⚠️ دلیلش یک واقعیتِ ثبت‌شده است: compose متغیرهای **dev-only** را به کانتینر نمی‌دهد و
 * گاردِ بوتِ production هم وجودشان را تخلف می‌شمارد (M5 فاز ۴). پس در یک استکِ production-mode
 * کدِ ثابت وجود ندارد — و چاپِ کد در لاگ **فقط** خاصیتِ `mock` است (P7)، همان چیزی که
 * `SMS_PROVIDER=smsir` آن را هم می‌بندد.
 */
export const codeFromLog = (): string => {
  const log = compose("logs", "--tail=80", "api");
  const hits = [...log.matchAll(/کدِ ورود (\d{6})/g)];
  const last = hits.at(-1);
  if (last === undefined) throw new Error("کدِ mock در لاگِ api پیدا نشد");
  return last[1]!;
};
