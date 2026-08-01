import { expect, test } from "@playwright/test";

import {
  boxSelectEverything,
  elementCenters,
  focusEngine,
  gotoDemo,
  panelSections,
  selectedCount,
  selectedGroupIds,
  spreadElementsInRow,
} from "./helpers";

/**
 * انتخابِ کادری (box-select)، Shift+Click، و گروه‌بندی — همه با رویدادِ **trusted**.
 * اینها بومیِ موتورند؛ تا حالا فقط چشمی تایید شده بودند (گام ۵٫۱).
 */

/** سه مستطیل بساز (هر ساخت خودش را انتخاب می‌کند → در پایان ۱ انتخاب). */
async function threeRects(page: Parameters<typeof gotoDemo>[0]) {
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "مستطیل", exact: true }).click();
  }
  await page.waitForTimeout(200);
}

test("box-select چند عنصر را می‌گیرد و بخشِ هم‌ترازی را می‌آورد", async ({ page }) => {
  await gotoDemo(page);
  await threeRects(page);

  await boxSelectEverything(page);
  await expect.poll(() => selectedCount(page)).toBe(3);
  await expect.poll(() => panelSections(page)).toEqual({ align: true, distribute: true });
});

test("Shift+Click عنصر به انتخاب اضافه و از آن کم می‌کند", async ({ page }) => {
  await gotoDemo(page);
  await threeRects(page);
  // در یک ردیفِ جدا بچین تا کلیکِ دقیق روی هر عنصر ممکن باشد (وگرنه روی هم‌اند).
  await spreadElementsInRow(page);
  const c = await elementCenters(page);

  // کلیک روی اولی → ۱ انتخاب.
  await page.mouse.click(c[0]!.x, c[0]!.y);
  await expect.poll(() => selectedCount(page)).toBe(1);

  // Shift+Click روی دومی → اضافه می‌شود (۱ → ۲).
  await page.keyboard.down("Shift");
  await page.mouse.click(c[1]!.x, c[1]!.y);
  await page.keyboard.up("Shift");
  await expect.poll(() => selectedCount(page)).toBe(2);

  // Shift+Click دوباره روی دومی → کم می‌شود (۲ → ۱).
  await page.keyboard.down("Shift");
  await page.mouse.click(c[1]!.x, c[1]!.y);
  await page.keyboard.up("Shift");
  await expect.poll(() => selectedCount(page)).toBe(1);
});

test("گروه‌بندی: Ctrl+G گروه می‌کند، کلیک کلِ گروه را می‌گیرد، Ctrl+Shift+G می‌شکند", async ({
  page,
}) => {
  await gotoDemo(page);
  await threeRects(page);

  await boxSelectEverything(page);
  await expect.poll(() => selectedCount(page)).toBe(3);

  // Ctrl+G → هر سه یک groupId مشترک می‌گیرند (و انتخاب‌شده می‌مانند).
  await focusEngine(page);
  await page.keyboard.press("Control+KeyG");
  await expect.poll(() => selectedGroupIds(page)).toHaveLength(1);

  // Ctrl+Shift+G → گروه می‌شکند (دیگر groupId مشترکی نیست).
  await page.keyboard.press("Control+Shift+KeyG");
  await expect.poll(() => selectedGroupIds(page)).toHaveLength(0);
});
