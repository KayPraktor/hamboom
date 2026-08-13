import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

/**
 * ★★ معیارِ پذیرشِ گام ۵٫۲ — **صفِ آفلاین**.
 *
 * «کلاینت آفلاین می‌شود، سه استیکی می‌سازد، تب **بسته و باز** می‌شود (اثباتِ
 * IndexedDB)، آنلاین می‌شود → هر سه استیکی روی سرور و در کلاینتِ دیگر ظاهر
 * می‌شوند و هیچ‌کدام تکراری نیست.»
 *
 * ── چرا این تست فقط اینجا ممکن است ────────────────────────────────────
 *
 * IndexedDB **فقط در مرورگر** وجود دارد، و «تب بسته و باز شد» را هیچ تستِ
 * واحدی نمی‌تواند ادعا کند. تستِ واحد (`src/offline.test.ts`) ترتیبِ بازیابی و
 * شمارش را می‌سنجد؛ اینکه بایت‌ها **واقعاً روی دیسکِ مرورگر می‌نشینند** فقط
 * اینجا آزمودنی است.
 *
 * ── ⚠️ سرور در حافظه است، و این عمداً به نفعِ تست است ──────────────────
 *
 * [`scripts/rt-dev-server.ts`](../../../scripts/rt-dev-server.ts) همان سرور و
 * همان اتاق و همان مجوزِ محصولی است، فقط انبارش در حافظه — پس E2E به داکر
 * وابسته نمی‌شود. ★ و چون با هر ری‌استارت **خالی** بالا می‌آید، دیدنِ استیکی‌ها
 * روی کلاینتِ دوم تنها یک توضیح دارد: کلاینتِ اول آن‌ها را بعد از بازگشت
 * فرستاده.
 */

const WS_PORT = 15_320;
const TOKEN_PORT = WS_PORT + 1;
const SERVER = fileURLToPath(new URL("../../../scripts/rt-dev-server.ts", import.meta.url));

let server: ChildProcess | null = null;

/** بالا آوردنِ سرور و صبر تا خطِ آمادگی‌اش. */
async function startServer(): Promise<void> {
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
}

/**
 * ⚠️ **کشتنِ ناگهانی، نه خاموشیِ مودبانه.** روی ویندوز `kill` هرچه بفرستی
 * فرایند را بی‌درنگ می‌کشد (درسِ گام ۴٫۸) — و اینجا دقیقاً همان را می‌خواهیم:
 * کلاینت باید یک قطعیِ **واقعی** ببیند، نه یک خداحافظیِ مرتب.
 */
async function stopServer(): Promise<void> {
  const child = server;
  server = null;
  if (!child) return;
  const ended = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill();
  await ended;
}

test.afterEach(async () => {
  await stopServer();
});

function url(client: string, board: string, options: { local?: boolean } = {}): string {
  const local = options.local === false ? "0" : "1";
  return `/#offline?board=${board}&client=${client}&local=${local}&ws=${String(WS_PORT)}&token=${String(TOKEN_PORT)}`;
}

/** صبر تا وقتی binder سوار شد و وضعیت مقدارِ خواسته‌شده را گرفت. */
async function waitForConnection(page: Page, status: string): Promise<void> {
  await expect(page.locator('[data-role="ready"]')).toHaveText("ready", { timeout: 30_000 });
  await expect(page.locator('[data-role="connection"]')).toHaveText(status, { timeout: 30_000 });
}

const docIds = (page: Page): Promise<string[]> =>
  page.evaluate(() => window.__hbOffline?.docIds() ?? []);

/** فقط ظرفِ استیکی — هر استیکی یک `stk_` و یک `txt_` می‌سازد. */
const stickyIds = async (page: Page): Promise<string[]> =>
  (await docIds(page)).filter((id) => id.startsWith("stk_")).sort();

test("★★ کارِ آفلاین از بستنِ تب جان به در می‌برد و بعد از بازگشت به همتا می‌رسد", async ({
  context,
}) => {
  const board = `brd-${String(Date.now())}`;
  await startServer();

  // ── ۱) آنلاین، و یک استیکیِ تاییدشده ────────────────────────────────
  const first = await context.newPage();
  await first.goto(url("a", board));
  await waitForConnection(first, "connected");
  await first.evaluate(() => window.__hbOffline?.addSticky("آنلاین"));
  await expect.poll(() => first.evaluate(() => window.__hbOffline?.save()?.status)).toBe("saved");

  // ── ۲) سرور می‌رود؛ کاربر به کارش ادامه می‌دهد ───────────────────────
  await stopServer();
  await expect(first.locator('[data-role="connection"]')).toHaveText("reconnecting", {
    timeout: 15_000,
  });

  // ★★ **قبل از هر ویرایشی** سنجیده می‌شود، و این عمدی است: اگر بعد از ساختنِ
  //    استیکی‌ها می‌آمد، شمارنده‌ی تغییرات هم `unsaved` را می‌گفت و این ادعا
  //    دیگر چیزی درباره‌ی **خودِ قطعِ سیم** ثابت نمی‌کرد. سرور نیست، پس هیچ‌کس
  //    نمی‌تواند «ذخیره شد» را تایید کند — حتی وقتی هیچ کارِ تازه‌ای نشده.
  expect(await first.evaluate(() => window.__hbOffline?.save()?.status)).toBe("unsaved");

  for (const text of ["آفلاین ۱", "آفلاین ۲", "آفلاین ۳"]) {
    await first.evaluate((value) => window.__hbOffline?.addSticky(value), text);
  }
  expect(await stickyIds(first)).toHaveLength(4);
  expect(await first.evaluate(() => window.__hbOffline?.save()?.status)).toBe("unsaved");

  // ── ۳) ★★ تب **بسته و باز** می‌شود — اثباتِ IndexedDB ────────────────
  const savedIds = await stickyIds(first);
  const savedVersion = await first.evaluate(() => window.__hbOffline?.schemaVersion());
  await first.close();

  const reopened = await context.newPage();
  await reopened.goto(url("a", board));
  // ⚠️ سرور هنوز پایین است: هرچه اینجا دیده شود **فقط** از IndexedDB آمده.
  await expect(reopened.locator('[data-role="ready"]')).toHaveText("ready", { timeout: 30_000 });
  await expect.poll(() => stickyIds(reopened)).toEqual(savedIds);
  // ★ و نسخه‌ی schema هم سالم مانده — همان چیزی که در گام ۴٫۶ بی‌صدا گم می‌شد.
  expect(await reopened.evaluate(() => window.__hbOffline?.schemaVersion())).toBe(savedVersion);

  // ── ۴) سرور برمی‌گردد — **بدونِ رفرش** ───────────────────────────────
  await startServer();
  await waitForConnection(reopened, "connected");
  await expect
    .poll(() => reopened.evaluate(() => window.__hbOffline?.save()?.status), { timeout: 30_000 })
    .toBe("saved");

  // ── ۵) ★★ کلاینتِ دوم همه را می‌بیند، و هیچ‌کدام تکراری نیست ──────────
  //
  // ⚠️ `local=0` یعنی این کلاینت **انبارِ محلی ندارد**. بدونِ آن، IndexedDBِ
  //    مشترکِ همان مرورگر جوابِ تست را از پیش می‌داد و چیزی درباره‌ی سرور
  //    ثابت نمی‌شد.
  const second = await context.newPage();
  await second.goto(url("b", board, { local: false }));
  await waitForConnection(second, "connected");

  await expect.poll(() => stickyIds(second), { timeout: 30_000 }).toEqual(savedIds);
  expect(await stickyIds(second)).toHaveLength(4);
  await second.close();
});
