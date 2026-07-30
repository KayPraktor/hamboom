import type { HbElement, HbStickyColor } from "@hamboom/shared-types";

import { cloneElements, type DuplicateOptions } from "./duplicate";
import type { ElementSeedOptions } from "./factory";
import { createSticky, nextStickyPosition } from "./sticky";

/**
 * منطقِ کلیپ‌بورد — گام ۵٫۳. خالص و تزریق‌پذیر.
 *
 * ★ **منبعِ واحد** (درسِ قفل/لایه، [ADR-024](../../../../ARCHITECTURE_DECISIONS.md#adr-024)):
 * پیستِ عناصر روی همان `cloneElements`ِ تکثیر سوار است (id تازه + آفست +
 * دوباره‌نگاشتِ پیوند)، و پیستِ متن روی `createSticky`/`nextStickyPosition`. هیچ
 * کلون یا چیدمانِ دوباره‌نوشته‌ای اینجا نیست.
 */

/** پیستِ عناصرِ کپی‌شده به صحنه‌ی فعلی — کلونِ همان `cloneElements`. */
export function pasteElements(
  current: HbElement[],
  clip: HbElement[],
  options: DuplicateOptions = {},
): { elements: HbElement[]; newIds: string[] } {
  if (clip.length === 0) return { elements: current, newIds: [] };
  const { clones, newIds } = cloneElements(clip, options);
  return { elements: [...current, ...clones], newIds };
}

export interface TextToStickyOptions extends ElementSeedOptions {
  authorId: string;
  x: number;
  y: number;
  palette?: HbStickyColor;
  /** جهتِ چیدنِ استیکی‌های چندخطی (RTL → به چپ). */
  textDirection?: "rtl" | "ltr";
}

/**
 * پیستِ متنِ ساده → استیکی(ها) — رفتار میرو. یک خطِ ناتهی = یک استیکی؛ چند خط =
 * چند استیکیِ **کنارِ هم** (با `nextStickyPosition`، جهتِ منطقی). خطوطِ خالی حذف.
 */
export function textToStickies(
  text: string,
  options: TextToStickyOptions,
): { elements: HbElement[]; ids: string[] } {
  const paragraphs = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return { elements: [], ids: [] };

  const elements: HbElement[] = [];
  const ids: string[] = [];
  let prev: { x: number; y: number; width: number; height: number } | null = null;

  for (const para of paragraphs) {
    const pos = prev
      ? nextStickyPosition(prev, "inline", options.textDirection ?? "rtl")
      : { x: options.x, y: options.y };
    const pair = createSticky({
      x: pos.x,
      y: pos.y,
      palette: options.palette,
      text: para,
      authorId: options.authorId,
      makeId: options.makeId,
      random: options.random,
      now: options.now,
    });
    elements.push(...pair.elements);
    ids.push(pair.container.id);
    prev = {
      x: pair.container.x,
      y: pair.container.y,
      width: pair.container.width,
      height: pair.container.height,
    };
  }
  return { elements, ids };
}
