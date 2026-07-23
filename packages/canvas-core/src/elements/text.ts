import type { HbElement, HbTextDirection } from "@hamboom/shared-types";

import { detectBaseDirection, defaultTextAlignFor, resolveDirection } from "../text/bidi";
import { hbTextDefaults } from "../theme/defaults";
import { HB_FONT_FAMILY, HB_TYPO, HB_UI_COLORS } from "../theme/tokens";
import { buildBaseElement, resolveSeed, type ElementSeedOptions } from "./factory";

/**
 * متن آزاد روی بوم — گام ۳٫۳.
 *
 * ── تفاوت با متن مقید استیکی ──────────────────────────────────────────
 *
 * متن آزاد `containerId: null` دارد، `autoResize: true` است (خودش با محتوا
 * بزرگ می‌شود، نه اینکه در ظرفی جا شود)، و **راست‌چین** است نه وسط‌چین.
 *
 * ── چرا `direction` روی `auto` می‌ماند ولی `textAlign` همین حالا حساب می‌شود ──
 *
 * `direction: "auto"` یعنی «از محتوا استنتاج کن» و در زمان رندر با
 * `detectBaseDirection` حل می‌شود ([ADR-024](../../../../ARCHITECTURE_DECISIONS.md#adr-024)).
 * ولی `textAlign` یک مقدار فیزیکی است که موتور همین حالا لازم دارد، پس از
 * جهت متن اولیه حساب می‌شود تا عنصر از **اولین رندر** درست بنشیند.
 */

export interface CreateTextOptions extends ElementSeedOptions {
  x: number;
  y: number;
  text?: string;
  authorId: string;
  index?: string;
  fontSize?: number;
  color?: string;
  /** جهت صریح. پیش‌فرض `"auto"` — از محتوا استنتاج می‌شود. */
  direction?: HbTextDirection;
}

export function createText(options: CreateTextOptions): HbElement {
  const {
    x,
    y,
    text = "",
    authorId,
    index = "a0",
    fontSize = HB_TYPO.defaultFontSize,
    color = HB_UI_COLORS.text,
    direction = "auto",
    ...seedOptions
  } = options;

  const seed = resolveSeed(seedOptions);
  const resolved = resolveDirection(text, direction);
  const defaults = hbTextDefaults(resolved);

  return {
    ...buildBaseElement({
      id: `txt_${seed.makeId()}`,
      type: "text",
      x,
      y,
      // ارتفاع یک خط؛ موتور با `autoResize` خودش تصحیح می‌کند.
      width: 0,
      height: fontSize * defaults.lineHeight,
      index,
      kind: "text",
      authorId,
      seed,
    }),
    strokeColor: color,
    backgroundColor: "transparent",
    roundness: null,
    containerId: null,
    text,
    originalText: text,
    fontSize,
    fontFamily: HB_FONT_FAMILY,
    textAlign: defaults.textAlign,
    verticalAlign: "top",
    lineHeight: defaults.lineHeight,
    direction,
    autoResize: true,
  } as unknown as HbElement;
}

/**
 * جهت و راست‌چینی یک متن را با محتوای جدیدش هم‌راستا می‌کند.
 *
 * وقتی کاربر متن را عوض می‌کند، ممکن است جهت غالبش هم عوض شود (فارسی →
 * انگلیسی). این تابع همان محاسبه‌ای را می‌کند که بوم و ویرایشگر می‌کنند، از
 * همان منبع واحد — پس هر سه هم‌راستا می‌مانند.
 *
 * عناصری که `direction` صریح دارند دست‌نخورده می‌مانند: انتخاب کاربر بر
 * heuristic مقدم است.
 */
export function realignTextForContent(element: HbElement): HbElement {
  const text = element as unknown as {
    type: string;
    text?: string;
    direction?: HbTextDirection;
    textAlign?: string;
  };

  if (text.type !== "text" || text.direction !== "auto") return element;

  const nextAlign = defaultTextAlignFor(detectBaseDirection(text.text ?? ""));
  if (nextAlign === text.textAlign) return element;

  return {
    ...element,
    textAlign: nextAlign,
    version: element.version + 1,
  } as HbElement;
}
