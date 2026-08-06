import { expect, test, type Page } from "@playwright/test";

/**
 * ★★ معیارِ پذیرشِ گام ۳٫۴ — **دو کلاینت، دو ژست هرکدام.**
 *
 * «`Ctrl+Z`ِ الف فقط ژست‌های الف را به ترتیبِ معکوس برمی‌گرداند و **هیچ‌وقت** به
 * کارِ ب نمی‌رسد — حتی وقتی ژست‌ها روی **یک عنصر** باشند.»
 *
 * ── چرا مرورگر و نه تستِ واحد ─────────────────────────────────────────
 *
 * تستِ واحد ([`src/undo.test.ts`](../src/undo.test.ts)) `UndoManager` را مستقیم
 * صدا می‌زند. چیزی که **فقط اینجا** دیده می‌شود این است که `Ctrl+Z`ِ واقعی به
 * `UndoManager` می‌رسد و **نه** به تاریخچه‌ی خودِ موتور — یعنی دو سدِ همزمان
 * وجود ندارد و یک `Ctrl+Z` دو کار نمی‌کند
 * ([ADR-035](../../../ARCHITECTURE_DECISIONS.md#adr-035)).
 */

const PAIR = "/#pair";

/** یک ژستِ محلی روی یک عنصرِ موجود — همان کاری که ابزارِ محصولی می‌کند. */
async function mutate(page: Page, pane: "a" | "b", patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    ({ name, changes }) => {
      const target = window.__hbPair![name]!;
      const box = target.api.getSceneElements().find((element) => element.type === "rectangle")!;
      target.commitLocal([{ ...box, ...changes } as never]);
    },
    { name: pane, changes: patch },
  );
}

async function boxOf(page: Page, pane: "a" | "b"): Promise<{ x: number; color: string }> {
  return page.evaluate((name) => {
    const box = window
      .__hbPair![name]!.api.getSceneElements()
      .find((element) => element.type === "rectangle") as { x: number; backgroundColor: string };
    return { x: box.x, color: box.backgroundColor };
  }, pane);
}

async function pressUndo(page: Page, pane: "a" | "b", times = 1): Promise<void> {
  const container = page.locator(`[data-pane="${pane}"] .excalidraw-container`);
  await container.click({ position: { x: 20, y: 20 } });
  await container.focus();
  for (let i = 0; i < times; i++) await page.keyboard.press("Control+KeyZ");
  await page.waitForTimeout(200);
}

test.beforeEach(async ({ page }) => {
  await page.goto(PAIR);
  await expect(page.locator('[data-pane="a"] [data-action="add"]')).toBeEnabled();
  await expect(page.locator('[data-pane="b"] [data-action="add"]')).toBeEnabled();

  // یک استیکیِ مشترک که هر دو رویش کار کنند.
  await page.locator('[data-pane="a"] [data-action="add"]').click();
  await expect
    .poll(() => page.evaluate(() => window.__hbPair?.b?.api.getSceneElements().length ?? 0))
    .toBe(2);
});

test("★★ دو ژستِ الف روی همان عنصری که ب هم دست زده، به ترتیبِ معکوس برمی‌گردند", async ({
  page,
}) => {
  // ژستِ ۱ الف: جابه‌جایی
  await mutate(page, "a", { x: 300 });
  await expect.poll(async () => (await boxOf(page, "b")).x).toBe(300);

  // ژستِ ب: **رنگ** — روی همان عنصر، ولی propertyِ دیگر.
  await mutate(page, "b", { backgroundColor: "#D0C6F5" });
  await expect.poll(async () => (await boxOf(page, "a")).color).toBe("#D0C6F5");

  // ژستِ ۲ الف: جابه‌جاییِ دوم
  await mutate(page, "a", { x: 600 });
  await expect.poll(async () => (await boxOf(page, "b")).x).toBe(600);

  // ── undoِ اول در الف → فقط ژستِ دومِ خودش ─────────────────────────
  await pressUndo(page, "a");
  expect(await boxOf(page, "a")).toEqual({ x: 300, color: "#D0C6F5" });
  await expect.poll(async () => (await boxOf(page, "b")).x).toBe(300);

  // ── undoِ دوم → ژستِ اولِ خودش ────────────────────────────────────
  await pressUndo(page, "a");
  const afterSecond = await boxOf(page, "a");
  expect(afterSecond.x).toBe(60); // مختصاتِ اولیه‌ی استیکی در دمو
  // ★★ ادعای مرکزی: رنگِ ب **دست‌نخورده** مانده — undo هرگز به کارِ او نرسید.
  expect(afterSecond.color).toBe("#D0C6F5");

  // ── undoِ سوم → ژستِ **ساخت** (که آن هم مالِ الف بود) ──────────────
  //
  // ⚠️ اولین نسخه‌ی این تست انتظار داشت اینجا «هیچ اتفاقی نیفتد». غلط بود:
  // استیکی را هم خودِ الف ساخته، پس پشته‌اش سه ژست دارد نه دو. رفتارِ درست
  // همین است — و ادعای قوی‌تری هم هست، چون کلِ پشته را به ترتیبِ معکوس نشان
  // می‌دهد.
  await pressUndo(page, "a");
  await expect
    .poll(() => page.evaluate(() => window.__hbPair!.a!.api.getSceneElements().length))
    .toBe(0);
  // و ب هم همان را می‌بیند — همگرایی حفظ شده.
  await expect
    .poll(() => page.evaluate(() => window.__hbPair!.b!.api.getSceneElements().length))
    .toBe(0);
});

test("★ undoِ الف به بومِ ب هم می‌رسد — دو سند همگرا می‌مانند", async ({ page }) => {
  await mutate(page, "a", { x: 400 });
  await expect.poll(async () => (await boxOf(page, "b")).x).toBe(400);

  await pressUndo(page, "a");

  const a = await boxOf(page, "a");
  await expect.poll(async () => (await boxOf(page, "b")).x).toBe(a.x);
});

test("★★ `Ctrl+Z`ِ ب کارِ الف را برنمی‌گرداند — حتی وقتی ب چیزی برای undo ندارد", async ({
  page,
}) => {
  // ب هیچ ژستی نزده. اگر `trackedOrigins` جا افتاده بود یا تاریخچه‌ی موتور هم
  // فعال مانده بود، این `Ctrl+Z` استیکیِ الف را پاک می‌کرد.
  await mutate(page, "a", { x: 250 });
  await expect.poll(async () => (await boxOf(page, "b")).x).toBe(250);

  await pressUndo(page, "b", 3);

  expect(await boxOf(page, "b")).toEqual({ x: 250, color: "#FFF9B1" });
  expect(await boxOf(page, "a")).toEqual({ x: 250, color: "#FFF9B1" });
});
