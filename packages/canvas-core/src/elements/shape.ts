import type { HbElement } from "@hamboom/shared-types";

import { detectBaseDirection } from "../text/bidi";
import { hbBoundTextDefaults, HB_SHAPE_DEFAULTS } from "../theme/defaults";
import { HB_FONT_FAMILY, HB_RADIUS, HB_SIZE, HB_TYPO, HB_UI_COLORS } from "../theme/tokens";
import { buildBaseElement, resolveSeed, type ElementSeedOptions } from "./factory";

/**
 * شکل‌های پایه — مستطیل، بیضی، لوزی. گام ۳٫۳.
 *
 * ── تفاوت با استیکی ───────────────────────────────────────────────────
 *
 * از دید موتور، یک شکل مستطیلی و یک استیکی **هر دو `rectangle` اند** و فقط
 * `customData.hb.kind` فرقشان را می‌سازد
 * ([ADR-010](../../../../ARCHITECTURE_DECISIONS.md#adr-010)). تفاوت‌های واقعی:
 *
 * | | استیکی | شکل |
 * |---|---|---|
 * | حاشیه | ندارد (`transparent`) | دارد |
 * | پس‌زمینه | از پالت | شفاف |
 * | متن | همیشه، مقید | اختیاری |
 * | اندازه | ثابت و مربع | آزاد |
 */

export type HbShapeKind = "rectangle" | "ellipse" | "diamond";

export interface CreateShapeOptions extends ElementSeedOptions {
  shape: HbShapeKind;
  x: number;
  y: number;
  width?: number;
  height?: number;
  authorId: string;
  index?: string;
  strokeColor?: string;
  backgroundColor?: string;
  /** اگر داده شود، یک متن مقید داخل شکل ساخته می‌شود. */
  text?: string;
}

export interface ShapeResult {
  shape: HbElement;
  /** فقط اگر `text` داده شده باشد. */
  text: HbElement | null;
  elements: HbElement[];
}

/**
 * ساخت یک شکل، با متن مقید اختیاری.
 *
 * لوزی و بیضی گوشه‌ی گرد نمی‌گیرند — `roundness` روی آن‌ها معنا ندارد و
 * موتور نادیده‌اش می‌گیرد، ولی گذاشتنش عنصر را از schema رد نمی‌کند و بعداً
 * گیج‌کننده می‌شود.
 */
export function createShape(options: CreateShapeOptions): ShapeResult {
  const {
    shape,
    x,
    y,
    width = HB_SIZE.shape.width,
    height = HB_SIZE.shape.height,
    authorId,
    index = "a0",
    strokeColor = HB_SHAPE_DEFAULTS.strokeColor,
    backgroundColor = HB_SHAPE_DEFAULTS.backgroundColor,
    text,
    ...seedOptions
  } = options;

  const seed = resolveSeed(seedOptions);
  const shapeId = `shp_${seed.makeId()}`;
  const hasText = text !== undefined && text !== "";
  const textId = hasText ? `txt_${seed.makeId()}` : null;

  const shapeElement = {
    ...buildBaseElement({
      id: shapeId,
      type: shape,
      x,
      y,
      width,
      height,
      index,
      kind: "shape",
      authorId,
      seed,
    }),
    strokeColor,
    backgroundColor,
    // فقط مستطیل گوشه‌ی گرد می‌گیرد.
    roundness: shape === "rectangle" ? { type: 3, value: HB_RADIUS.shape } : null,
    boundElements: textId ? [{ id: textId, type: "text" }] : null,
  } as unknown as HbElement;

  if (!hasText || !textId) {
    return { shape: shapeElement, text: null, elements: [shapeElement] };
  }

  const defaults = hbBoundTextDefaults(detectBaseDirection(text));

  const textElement = {
    ...buildBaseElement({
      id: textId,
      type: "text",
      x: x + 8,
      y: y + 8,
      width: width - 16,
      height: HB_TYPO.defaultFontSize * defaults.lineHeight,
      index: `${index}V`,
      kind: "text",
      authorId,
      seed,
    }),
    strokeColor: HB_UI_COLORS.text,
    backgroundColor: "transparent",
    roundness: null,
    containerId: shapeId,
    text,
    originalText: text,
    fontSize: HB_TYPO.defaultFontSize,
    fontFamily: HB_FONT_FAMILY,
    textAlign: defaults.textAlign,
    verticalAlign: defaults.verticalAlign,
    lineHeight: defaults.lineHeight,
    direction: defaults.direction,
    autoResize: false,
  } as unknown as HbElement;

  return {
    shape: shapeElement,
    text: textElement,
    elements: [shapeElement, textElement],
  };
}
