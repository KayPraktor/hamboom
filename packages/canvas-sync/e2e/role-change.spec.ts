import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

/**
 * ★★ معیارِ پذیرشِ گام ۵٫۳ — **تغییرِ نقش وسطِ session و نسخه‌ی ناسازگار**.
 *
 * «تغییرِ نقش از `editor` به `viewer` **بدون رفرش** ابزارهای ویرایش را می‌بندد و
 * updateهای بعدی رد می‌شوند؛ کلاینتِ با schemaِ قدیمی پیامِ فارسی می‌گیرد نه crash.»
 *
 * ── چرا مرورگر ─────────────────────────────────────────────────────────
 *
 * نیمه‌ی اولش را فقط اینجا می‌شود ثابت کرد: «ابزارها بسته می‌شوند» یعنی
 * `viewModeEnabled` را **خودِ موتور** اعمال کرده باشد، و در jsdom موتوری نیست.
 * پس ادعا از `getAppState()`ِ خودِ Excalidraw خوانده می‌شود، نه از stateِ ری‌اکتِ
 * دمو — وگرنه فقط ادعای خودمان را با ادعای خودمان می‌سنجیدیم.
 *
 * ★ نیمه‌ی دومش (`CLIENT_TOO_OLD`) هم اینجاست چون «crash نمی‌کند» فقط در یک
 * مرورگرِ واقعی معنا دارد؛ تستِ واحد فقط می‌تواند بگوید تابع throw نکرد.
 */

const WS_PORT = 15_330;
const TOKEN_PORT = WS_PORT + 1;
const SERVER = fileURLToPath(new URL("../../../scripts/rt-dev-server.ts", import.meta.url));

let server: ChildProcess | null = null;

test.beforeEach(async () => {
  const child = spawn(process.execPath, [SERVER, String(WS_PORT)], { stdio: "pipe" });
  server = child;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("سرورِ dev بالا نیامد")), 30_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (!chunk.toString().includes("rt-dev-server ws=")) return;
      clearTimeout(timer);
      resolve();
    });
    child.once("error", reject);
  });
});

test.afterEach(async () => {
  const child = server;
  server = null;
  if (!child) return;
  const ended = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill();
  await ended;
});

function url(client: string, board: string, extra = ""): string {
  return `/#offline?board=${board}&client=${client}&local=0&ws=${String(WS_PORT)}&token=${String(TOKEN_PORT)}${extra}`;
}

async function open(page: Page, client: string, board: string, extra = ""): Promise<void> {
  await page.goto(url(client, board, extra));
  await expect(page.locator('[data-role="ready"]')).toHaveText("ready", { timeout: 30_000 });
}

const stickyIds = async (page: Page): Promise<string[]> =>
  (await page.evaluate(() => window.__hbOffline?.docIds() ?? []))
    .filter((id) => id.startsWith("stk_"))
    .sort();

test("★★ تنزلِ نقش وسطِ کار، بدونِ رفرش، بوم را فقط-خواندنی می‌کند", async ({ context }) => {
  const board = `brd-${String(Date.now())}`;

  const editor = await context.newPage();
  await open(editor, "a", board);
  await expect(editor.locator('[data-role="connection"]')).toHaveText("connected", {
    timeout: 30_000,
  });

  // ── ۱) به‌عنوانِ `editor` می‌نویسد و کارش می‌نشیند ────────────────────
  await editor.evaluate(() => window.__hbOffline?.addSticky("قبل از تنزل"));
  await expect
    .poll(() => editor.evaluate(() => window.__hbOffline?.save()?.status), { timeout: 30_000 })
    .toBe("saved");
  expect(await editor.evaluate(() => window.__hbOffline?.viewMode())).toBe(false);

  // ── ۲) ★★ نقش **از بیرون** عوض می‌شود — همان کاری که M3 خواهد کرد ─────
  const changed = await fetch(
    `http://127.0.0.1:${String(TOKEN_PORT)}/dev-role?board=${board}&sub=usr_a&role=viewer`,
  );
  expect(await changed.text()).toBe("1");

  // ── ۳) ★★ **بدونِ رفرش** — همین تب، همین سوکت ─────────────────────────
  await expect(editor.locator('[data-role="can-edit"]')).toHaveText("readonly", {
    timeout: 15_000,
  });
  // ★ و ادعای واقعی: **خودِ موتور** در حالتِ فقط-خواندنی است.
  await expect
    .poll(() => editor.evaluate(() => window.__hbOffline?.viewMode()), { timeout: 15_000 })
    .toBe(true);
  // ⚠️ و اتصال **باز مانده** (ADR-038): تماشاگر حقِ دیدن دارد.
  await expect(editor.locator('[data-role="connection"]')).toHaveText("connected");

  // ── ۴) ★★ و updateِ بعدی رد می‌شود ───────────────────────────────────
  //
  // ⚠️ دمو عمداً هنوز اجازه‌ی صدا زدنِ `addSticky` را می‌دهد: می‌خواهیم ببینیم
  //    **سرور** چه می‌کند، نه اینکه رابط جلویش را گرفته باشد.
  await editor.evaluate(() => window.__hbOffline?.addSticky("بعد از تنزل"));
  await expect
    .poll(() => editor.evaluate(() => window.__hbOffline?.lastError()?.code), { timeout: 15_000 })
    .toBe("FORBIDDEN");

  // و روی کلاینتِ دیگر فقط استیکیِ **اول** دیده می‌شود.
  const other = await context.newPage();
  await open(other, "b", board);
  await expect.poll(() => stickyIds(other), { timeout: 30_000 }).toHaveLength(1);

  await editor.close();
  await other.close();
});

test("★★ کلاینتِ عقب‌تر پیامِ فارسی می‌گیرد، نه crash", async ({ context }) => {
  const board = `brd-${String(Date.now())}`;
  const errors: string[] = [];

  // ⚠️ اول یک کلاینتِ سالم بورد را می‌سازد تا `meta.schemaVersion` رویش بنشیند.
  const current = await context.newPage();
  await open(current, "a", board);
  await expect(current.locator('[data-role="connection"]')).toHaveText("connected", {
    timeout: 30_000,
  });
  await current.evaluate(() => window.__hbOffline?.addSticky("سندِ امروز"));
  await expect
    .poll(() => current.evaluate(() => window.__hbOffline?.save()?.status), { timeout: 30_000 })
    .toBe("saved");
  await current.close();

  // ── ★ و حالا یک کلاینت که فقط نسخه‌ی ۰ را می‌فهمد ────────────────────
  const stale = await context.newPage();
  stale.on("pageerror", (error) => errors.push(error.message));
  await open(stale, "b", board, "&schema=0");

  await expect
    .poll(() => stale.evaluate(() => window.__hbOffline?.connection()?.status), { timeout: 30_000 })
    .toBe("error");

  const state = await stale.evaluate(() => window.__hbOffline?.connection());
  expect(state).toMatchObject({ status: "error", code: "CLIENT_TOO_OLD" });
  if (state?.status === "error") {
    // ★ پیامِ فارسی، و صریح درباره‌ی کاری که کاربر باید بکند.
    expect(state.message).toContain("صفحه را تازه کنید");
  }

  // ★★ و بوم قفل شده — کلاینتی که سند را نمی‌فهمد **نباید بنویسد**.
  expect(await stale.evaluate(() => window.__hbOffline?.viewMode())).toBe(true);
  // ⚠️ «نه crash» یعنی هیچ خطای مدیریت‌نشده‌ای در صفحه نیفتاده باشد.
  expect(errors).toEqual([]);

  await stale.close();
});
