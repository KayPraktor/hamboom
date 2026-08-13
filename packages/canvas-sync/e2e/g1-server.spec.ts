import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import { handProject, pointAt, sample, settleViewport } from "./pair-helpers";

/**
 * ★★★ معیارِ پذیرشِ گام ۶٫۱ — **G-1ب: دو نمونه روی سرورِ واقعی**.
 *
 * «کلِ سناریوی G-1 (sync + حضور + re-project + follow) روی مسیرِ واقعی سبز است؛
 * و بعد از یک قطعیِ ۱۰ثانیه‌ای وسطِ کار، هر دو کلاینت به **یک حالتِ یکسان**
 * می‌رسند (مقایسه‌ی state vector، نه چشمی).»
 *
 * ── ★ همان harness، ترابریِ متفاوت ────────────────────────────────────
 *
 * صفحه، کامپوننت‌ها، اوراکلِ پروجکشن و حتی helperها **همان‌های گام ۳٫۷** اند
 * ([`pair-helpers.ts`](./pair-helpers.ts)). تنها چیزی که عوض می‌شود پارامترهای
 * هش است: هر پنل به‌جای `LocalTransportHub` یک WebSocketِ واقعی می‌گیرد.
 * ★ اگر برای این گام یک harnessِ دوم می‌نوشتیم، سبز شدنش چیزی درباره‌ی مسیرِ
 * واقعی ثابت نمی‌کرد — فقط اینکه harnessِ دوم هم کار می‌کند.
 *
 * ── ⚠️ این تست **داکر لازم دارد**، برخلافِ بقیه ───────────────────────
 *
 * معیار صریحاً «Postgres + Redis بالا» می‌خواهد، و بی‌دلیل نیست: بدونِ Redis دو
 * نود همدیگر را نمی‌بینند و بدونِ Postgres «بعد از قطعی همان حالت برمی‌گردد»
 * چیزی ثابت نمی‌کند. برای همین **از اجرای پیش‌فرضِ E2E جدا است**
 * (`playwright.server.config.ts`) — دقیقاً به همان دلیلی که هفت سنجه‌ی
 * `rt:*` بیرونِ `pnpm verify` اند.
 *
 * ── ★★ یافته‌ی F-2 — این تست یک باگِ واقعیِ خوشه گرفت ────────────────
 *
 * مرحله‌ی ۵ در ابتدا در **۳ اجرا از ۴** قرمز بود، و علتش تست نبود: بینِ مرگِ نودِ
 * صاحب و انقضای اجاره‌ی قفل (تا ۳۰ ثانیه) هیچ نودی صاحب نیست، پس updateِ کلاینت
 * هیچ‌جا پایدار نمی‌شد و نودی که آن پیامِ گذرگاه را نمی‌گرفت **هرگز** به آن
 * نمی‌رسید. رفع در [ADR-041](../../../ARCHITECTURE_DECISIONS.md#adr-041):
 * اتاق هنگام باز شدن حالتِ تازه‌تر را از نودهای دیگر می‌پرسد.
 *
 * ⚠️ **این تست عمداً طوری نوشته نشد که پنجره‌ی بی‌صاحبی را دور بزند.** اگر
 * می‌زد، سبز می‌شد و باگ سرِ جایش می‌مانْد.
 *
 * اجرا:
 *   pnpm db:up && pnpm db:migrate
 *   pnpm --filter @hamboom/canvas-sync test:e2e:server
 */

const NODE_A = 15_340;
const NODE_B = 15_350;
const SERVER = fileURLToPath(new URL("../../../scripts/rt-dev-server.ts", import.meta.url));
/** مهلتِ سخاوتمندانه: قطعیِ ۱۰ثانیه‌ای و backoffِ بعدش وقت می‌خواهد. */
const OUTAGE_MS = 10_000;

test.describe.configure({ timeout: 180_000 });

const nodes = new Map<number, ChildProcess>();

async function startNode(port: number): Promise<void> {
  // ⚠️ `--pg` یعنی همان ترکیبی که `main.ts` می‌سازد؛ `--env-file` هم لازم است
  //    چون پورتِ Postgresِ این ماشین در `.env` است، نه پیش‌فرضِ PLAN.
  const child = spawn(
    process.execPath,
    ["--env-file-if-exists=.env", SERVER, String(port), "--pg"],
    {
      cwd: fileURLToPath(new URL("../../..", import.meta.url)),
      stdio: "pipe",
    },
  );
  nodes.set(port, child);

  const problems: string[] = [];
  child.stderr?.on("data", (chunk: Buffer) => problems.push(chunk.toString()));

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `نودِ ${String(port)} بالا نیامد. آیا \`pnpm db:up\` اجرا شده؟\n${problems.join("")}`,
          ),
        ),
      30_000,
    );
    child.stdout?.on("data", (chunk: Buffer) => {
      if (!chunk.toString().includes("rt-dev-server ws=")) return;
      clearTimeout(timer);
      resolve();
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error(`نودِ ${String(port)} بلافاصله بسته شد.\n${problems.join("")}`));
    });
  });
}

async function stopNode(port: number): Promise<void> {
  const child = nodes.get(port);
  nodes.delete(port);
  if (!child) return;
  const ended = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill();
  await ended;
}

test.afterEach(async () => {
  await Promise.all([...nodes.keys()].map((port) => stopNode(port)));
});

/** ★ دو پنل، **دو نودِ متفاوت** — ادعای خوشه‌ی گام ۴٫۷ روی مسیرِ مرورگر. */
function pairUrl(board: string): string {
  return (
    `/#pair?board=${board}` +
    `&ws=${String(NODE_A)}&token=${String(NODE_A + 1)}` +
    `&ws2=${String(NODE_B)}&token2=${String(NODE_B + 1)}`
  );
}

const stateVector = (page: Page, pane: "a" | "b"): Promise<number[]> =>
  page.evaluate((name) => window.__hbPair![name]!.stateVector(), pane);

const elementIds = (page: Page, pane: "a" | "b"): Promise<string[]> =>
  page.evaluate((name) => [...window.__hbPair![name]!.doc.getMap("elements").keys()].sort(), pane);

async function addSticky(page: Page, pane: "a" | "b"): Promise<void> {
  await page.locator(`[data-pane="${pane}"] [data-action="add"]`).click();
}

test("★★★ G-1ب — کلِ سناریو روی سرورِ واقعی، و همگرایی بعد از قطعیِ ۱۰ثانیه‌ای", async ({
  page,
}) => {
  // ⚠️ **UUIDِ خام، بدونِ پیشوند.** ستونِ `board_id` در Postgres از نوعِ `uuid`
  //    است و هر چیزِ دیگری در همان `onJoin` می‌ترکد — که کلاینت آن را یک
  //    `FORBIDDEN`ِ عادی می‌بیند، نه یک خطای شکل. (نسخه‌ی اولِ همین تست دقیقاً
  //    این‌طور گیج شد: سوکت باز می‌شد و بعد بی‌صدا رد.)
  const board = randomUUID();
  await Promise.all([startNode(NODE_A), startNode(NODE_B)]);

  await page.goto(pairUrl(board));
  await expect(page.locator('[data-pane="a"] [data-action="add"]')).toBeEnabled({
    timeout: 60_000,
  });
  await expect(page.locator('[data-pane="b"] [data-action="add"]')).toBeEnabled({
    timeout: 60_000,
  });
  // ⚠️ **صبر تا هر دو واقعاً وصل شوند.** با ترابریِ واقعی `connect` منتظرِ باز
  //    شدنِ سوکت نمی‌مانَد (ADR-039)، پس بدونِ این، اولین ژست می‌توانست پیش از
  //    دست‌دادن برود.
  for (const pane of ["a", "b"] as const) {
    await expect(page.locator(`[data-pane="${pane}"] [data-role="status"]`)).toHaveText(
      "connected",
      { timeout: 60_000 },
    );
  }

  await test.step("۱) sync از راهِ دو نودِ سرور", async () => {
    await addSticky(page, "a");
    // ★ از نودِ الف → Postgres/Redis → نودِ ب → پنلِ ب.
    await expect.poll(() => elementIds(page, "b"), { timeout: 30_000 }).toHaveLength(2);
    expect(await elementIds(page, "a")).toEqual(await elementIds(page, "b"));
  });

  await test.step("۲) حضور روی مسیرِ واقعی — پیکسل با پروجکشنِ دست‌محاسبه", async () => {
    await pointAt(page, { x: 220, y: 140 });
    const cursor = page.locator('[data-pane="b"] .hb-peer-cursor');
    await expect(cursor).toHaveCount(1, { timeout: 30_000 });

    const { projection, translate } = await sample(page, "b", ".hb-peer-cursor");
    const expected = handProject({ x: 220, y: 140 }, projection);
    expect(translate.x).toBeCloseTo(expected.x, 0);
    expect(translate.y).toBeCloseTo(expected.y, 0);
  });

  await test.step("۳) re-project با panِ خالص — باگِ Q1، این‌بار با سرور", async () => {
    const before = await sample(page, "b", ".hb-peer-cursor");
    // ⚠️ چرخِ **واقعی**، نه `updateScene`ِ برنامه‌ای (تله‌ی ثبت‌شده‌ی ۳٫۷).
    await page.locator('[data-pane="b"] .excalidraw-container').hover({
      position: { x: 150, y: 150 },
    });
    await page.mouse.wheel(60, 90);
    await settleViewport(page, "b");

    const after = await sample(page, "b", ".hb-peer-cursor");
    const expected = handProject({ x: 220, y: 140 }, after.projection);
    expect(after.translate.x).toBeCloseTo(expected.x, 0);
    expect(after.translate.y).toBeCloseTo(expected.y, 0);
    // ★ و واقعاً تکان خورده — لایه‌ی یخ‌زده هم بدونِ این پاس می‌شد.
    expect(Math.abs(after.translate.y - before.translate.y)).toBeGreaterThan(10);
  });

  await test.step("۴) دنبال‌کردن — نمای ب روی مکان‌نمای الف می‌نشیند", async () => {
    const clientId = await page.evaluate(() => window.__hbPair!.b!.peers()[0]!.clientId);
    await page.evaluate((id) => window.__hbPair!.b!.follow(id), clientId);
    await settleViewport(page, "b");

    const { projection } = await sample(page, "b", ".hb-peer-cursor");
    const pixel = handProject({ x: 220, y: 140 }, projection);
    const box = await page.locator('[data-pane="b"] .excalidraw-container').boundingBox();
    // مکان‌نما باید تقریباً وسطِ بومِ ب افتاده باشد.
    expect(pixel.x).toBeCloseTo(box!.width / 2, -2);
    expect(pixel.y).toBeCloseTo(box!.height / 2, -2);
  });

  await test.step("۵) ★★ قطعیِ ۱۰ثانیه‌ای وسطِ کار، و همگرایی", async () => {
    const before = await elementIds(page, "a");

    await Promise.all([stopNode(NODE_A), stopNode(NODE_B)]);
    for (const pane of ["a", "b"] as const) {
      await expect(page.locator(`[data-pane="${pane}"] [data-role="status"]`)).toHaveText(
        "reconnecting",
        { timeout: 30_000 },
      );
    }

    // ★ **هر دو طرف در قطعی کار می‌کنند** — سناریوی واقعیِ ادغام، نه یک‌طرفه.
    await addSticky(page, "a");
    await addSticky(page, "b");
    await page.waitForTimeout(OUTAGE_MS);

    await Promise.all([startNode(NODE_A), startNode(NODE_B)]);
    for (const pane of ["a", "b"] as const) {
      await expect(page.locator(`[data-pane="${pane}"] [data-role="status"]`)).toHaveText(
        "connected",
        { timeout: 90_000 },
      );
    }

    // ★★★ **مقایسه‌ی بردارِ وضعیت، نه چشمی.** برابریِ آن یعنی هر دو سند دقیقاً
    //     همان opها را دیده‌اند — از شمردنِ عنصر خیلی قوی‌تر.
    //
    // ⚠️ **هر دو در یک `evaluate` خوانده می‌شوند.** نسخه‌ی اول یک‌بار بردارِ ب را
    //    می‌گرفت و بعد الف را poll می‌کرد — یعنی هدفِ متحرک را با عکسِ لحظه‌ی صفر
    //    می‌سنجید و هر همگراییِ دیرهنگام را از دست می‌داد. (همان تله‌ی «دو
    //    `evaluate` یک رندر فاصله دارند» از گام ۳٫۷، این‌بار روی زمان.)
    try {
      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                window.__hbPair!.a!.stateVector().join(",") ===
                window.__hbPair!.b!.stateVector().join(","),
            ),
          { timeout: 90_000 },
        )
        .toBe(true);
    } catch (cause) {
      // ★ این تست امروز قرمز است (F-2)، پس شکستش باید **خودش را توضیح بدهد** —
      //   نه اینکه فقط بگوید `false !== true`.
      const [a, b] = await Promise.all([stateVector(page, "a"), stateVector(page, "b")]);
      throw new Error(
        `همگرا نشدند (یافته‌ی F-2 در PROGRESS.md):\n` +
          `  الف: ${a.join(",")}\n  ب:   ${b.join(",")}\n` +
          `  عناصرِ الف: ${(await elementIds(page, "a")).join("|")}\n` +
          `  عناصرِ ب:   ${(await elementIds(page, "b")).join("|")}\n${String(cause)}`,
      );
    }

    // و کارِ هر دو طرف سرِ جایش است: دو استیکیِ تازه (هر کدام ظرف + متن).
    const merged = await elementIds(page, "a");
    expect(merged).toHaveLength(before.length + 4);
    expect(await elementIds(page, "b")).toEqual(merged);
  });
});
