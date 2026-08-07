import { expect, test, type Page } from "@playwright/test";

/**
 * ★★ گام ۳٫۵ در **مرورگرِ واقعی** — کانالِ حضور زیر StrictMode.
 *
 * ── چرا این سه تست در jsdom کافی نبودند ───────────────────────────────
 *
 * تستِ واحد چرخه‌ی connect/disconnect/connect را **شبیه‌سازی** می‌کند؛ اینجا
 * خودِ ری‌اکت آن را می‌سازد. و باگی که در همین گام پیدا شد دقیقاً از همان جنس
 * بود: `Awareness`ِ تازه شمارنده را از صفر شروع می‌کرد و همتای **وصل‌شده‌ی
 * دوباره** تا ابد نامرئی می‌مانْد. زیر StrictMode این حالتِ **عادی** است، نه
 * استثنا — پس نگهبانش باید همان‌جا باشد.
 *
 * ⚠️ **رندرِ** حضور (مکان‌نما، هاله، آواتار) اینجا نیست — گام ۳٫۷ (G-1الف).
 */

const PAIR = "/#pair";

async function peersOf(page: Page, pane: "a" | "b"): Promise<unknown[]> {
  return page.evaluate((name) => window.__hbPair?.[name]?.peers() ?? [], pane);
}

test.beforeEach(async ({ page }) => {
  await page.goto(PAIR);
  await expect(page.locator('[data-pane="a"] [data-action="add"]')).toBeEnabled();
  await expect(page.locator('[data-pane="b"] [data-action="add"]')).toBeEnabled();
});

test("★★ هر دو پنل همدیگر را می‌بینند — بعد از mountِ دوبارِ StrictMode", async ({ page }) => {
  // ★ همین ادعا بود که باگِ شمارنده را بیرون کشید: زیر StrictMode هر پنل
  //   یک‌بار وصل، قطع، و دوباره وصل می‌شود.
  await expect(page.locator('[data-pane="a"] [data-role="peers"]')).toHaveText("1");
  await expect(page.locator('[data-pane="b"] [data-role="peers"]')).toHaveText("1");

  const seen = (await peersOf(page, "a")) as { user: { id: string } }[];
  expect(seen.map((peer) => peer.user.id)).toEqual(["u_b"]);
});

test("مکان‌نما و انتخابِ الف روی پنلِ ب می‌نشیند", async ({ page }) => {
  await page.evaluate(() => {
    const pane = window.__hbPair!.a!;
    pane.outbound.emitSelection(["stk_1"]);
    pane.outbound.emitPointer({ x: 320, y: 180, visible: true });
  });

  await expect
    .poll(async () => {
      const peers = (await peersOf(page, "b")) as { pointer: unknown; selectedIds: string[] }[];
      return peers[0];
    })
    .toMatchObject({
      pointer: { x: 320, y: 180, visible: true },
      selectedIds: ["stk_1"],
    });
});

test("★★ استروکِ ۲۰۰نقطه‌ای می‌رسد و **سند یک بایت هم بزرگ نمی‌شود**", async ({ page }) => {
  const before = await page.evaluate(() => ({
    a: window.__hbPair!.a!.docBytes(),
    b: window.__hbPair!.b!.docBytes(),
  }));

  await page.evaluate(() => {
    const points = Array.from({ length: 200 }, (_, i) => [i * 1.5, Math.sin(i) * 40]);
    window.__hbPair!.a!.outbound.emitEphemeral({
      kind: "draw-stroke",
      points: points as [number, number][],
      color: "#1a1a1a",
      width: 2,
    });
  });

  await expect
    .poll(async () => {
      const peers = (await peersOf(page, "b")) as { ephemeral: { points: unknown[] } | null }[];
      return peers[0]?.ephemeral?.points.length ?? 0;
    })
    .toBe(200);

  // ★★ ادعای مرکزیِ ADR-022 — روی **هر دو** سند.
  expect(
    await page.evaluate(() => ({
      a: window.__hbPair!.a!.docBytes(),
      b: window.__hbPair!.b!.docBytes(),
    })),
  ).toEqual(before);
});
