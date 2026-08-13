import { expect, type Page } from "@playwright/test";

/**
 * ابزارهای مشترکِ دموی جفتی — گام‌های ۳٫۷ (G-1الف) و ۶٫۱ (G-1ب).
 *
 * ⚠️ **عمداً یک نسخه، نه دو.** قلبِ این فایل `handProject` است: اوراکلی که
 * ادعای رندرِ حضور را می‌سنجد. اگر دو کپی داشت، یکی می‌توانست با کدِ محصولی
 * هم‌راستا شود و آن یکی نه — و آن‌وقت دیگر اوراکل نیست، فقط یک آینه.
 * ([ADR-024](../../../ARCHITECTURE_DECISIONS.md#adr-024)، همان قاعده‌ی همیشگی.)
 */

export interface Projection {
  viewport: { scrollX: number; scrollY: number; zoom: number };
  offsetLeft: number;
  offsetTop: number;
  overlay: { left: number; top: number };
}

/** ★ همان فرمول، **دستی** — نه صدا زدنِ `sceneToOverlayPixel`. */
export function handProject(
  scene: { x: number; y: number },
  p: Projection,
): { x: number; y: number } {
  return {
    x: (scene.x + p.viewport.scrollX) * p.viewport.zoom + p.offsetLeft - p.overlay.left,
    y: (scene.y + p.viewport.scrollY) * p.viewport.zoom + p.offsetTop - p.overlay.top,
  };
}

export const projectionOf = (page: Page, pane: "a" | "b"): Promise<Projection> =>
  page.evaluate((name) => window.__hbPair![name]!.projection(), pane) as Promise<Projection>;

/**
 * ★ نما و پیکسلِ رندرشده را در **یک** `evaluate` می‌خواند.
 *
 * ⚠️ لازم است، نه تمیزکاری: اولین نسخه دو رفت‌وبرگشتِ جدا داشت و بینشان یک
 * رندرِ ری‌اکت افتاد — نما را از **قبلِ** `follow` خواند و `transform` را از
 * **بعدش**. تست قرمز شد در حالی که کد درست بود. هر دو باید از **یک فریم** بیایند.
 */
export async function sample(
  page: Page,
  pane: "a" | "b",
  selector: string,
): Promise<{ projection: Projection; translate: { x: number; y: number } }> {
  return page.evaluate(
    ({ name, css }) => {
      const element = document.querySelector(`[data-pane="${name}"] ${css}`)!;
      const matrix = new DOMMatrix(getComputedStyle(element).transform);
      return {
        projection: window.__hbPair![name]!.projection(),
        translate: { x: matrix.m41, y: matrix.m42 },
      };
    },
    { name: pane, css: selector },
  );
}

/**
 * ★ صبر تا نما **آرام بگیرد** — دو خواندنِ پیاپیِ یکسان.
 *
 * ⚠️ یک چرخِ ماوس یک رویداد نیست، یک **رگبار** است. بدونِ این، `follow` وسطِ
 * رگبار اجرا می‌شد و `onScrollChange`ِ بعدی مقدارش را پس می‌گرفت — تست قرمز
 * می‌شد در حالی که کد درست بود. (مهلتِ ثابت راهِ درستش نیست؛ درسِ ثبت‌شده‌ی M1.)
 */
export async function settleViewport(page: Page, pane: "a" | "b"): Promise<void> {
  let previous = JSON.stringify((await projectionOf(page, pane)).viewport);
  await expect
    .poll(async () => {
      const now = JSON.stringify((await projectionOf(page, pane)).viewport);
      const stable = now === previous;
      previous = now;
      return stable;
    })
    .toBe(true);
}

/** مکان‌نمای یک پنل را روی یک نقطه‌ی صحنه بگذار (بدونِ وابستگی به ماوسِ واقعی). */
export async function pointAt(
  page: Page,
  scene: { x: number; y: number },
  pane: "a" | "b" = "a",
): Promise<void> {
  await page.evaluate(
    ({ point, name }) => window.__hbPair![name]!.outbound.emitPointer({ ...point, visible: true }),
    { point: scene, name: pane },
  );
}
