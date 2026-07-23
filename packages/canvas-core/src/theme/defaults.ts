import type { HbTextDirection } from "@hamboom/shared-types";

import { defaultTextAlignFor, type TextDirection } from "../text/bidi";
import { HB_LOOK, HB_RADIUS, HB_SIZE, HB_TYPO, HB_UI_COLORS } from "./tokens";

/**
 * پیش‌فرض عناصر هنگام ساخت — استایل میرو، نه دست‌نویس.
 *
 * این فایل «شکل» را به مقادیر واقعی عنصر ترجمه می‌کند. سازنده‌های عنصر در
 * `elements/` از اینجا می‌خوانند تا یک استیکی ساخته‌شده از نوار ابزار و یکی
 * ساخته‌شده از یک قالب، یکسان به‌نظر برسند.
 */

/** فیلدهای ظاهری مشترک همه‌ی عناصر. */
export const HB_ELEMENT_LOOK = {
  fillStyle: HB_LOOK.fillStyle,
  roughness: HB_LOOK.roughness,
  strokeWidth: 1,
  strokeStyle: "solid",
  opacity: 100,
} as const;

/**
 * استیکی‌نوت.
 *
 * `strokeColor: "transparent"` عمدی است — استیکی میرو حاشیه ندارد و همین
 * تفاوت اصلی ظاهری‌اش با یک مستطیل رنگی است.
 */
export const HB_STICKY_DEFAULTS = {
  ...HB_ELEMENT_LOOK,
  width: HB_SIZE.sticky.width,
  height: HB_SIZE.sticky.height,
  strokeColor: "transparent",
  roundness: { type: HB_LOOK.roundnessType, value: HB_RADIUS.sticky },
  autoFit: true,
} as const;

/** شکل — برخلاف استیکی حاشیه دارد و پس‌زمینه‌اش پیش‌فرض شفاف است. */
export const HB_SHAPE_DEFAULTS = {
  ...HB_ELEMENT_LOOK,
  width: HB_SIZE.shape.width,
  height: HB_SIZE.shape.height,
  strokeColor: HB_UI_COLORS.text,
  backgroundColor: "transparent",
  roundness: { type: HB_LOOK.roundnessType, value: HB_RADIUS.shape },
} as const;

/** فریم. */
export const HB_FRAME_DEFAULTS = {
  ...HB_ELEMENT_LOOK,
  width: HB_SIZE.frame.width,
  height: HB_SIZE.frame.height,
  strokeColor: HB_UI_COLORS.borderStrong,
  backgroundColor: HB_UI_COLORS.surface,
  roundness: null,
  color: HB_UI_COLORS.accent,
  collapsed: false,
} as const;

/** کانکتور — پله‌ای پیش‌فرض، مثل میرو. */
export const HB_CONNECTOR_DEFAULTS = {
  ...HB_ELEMENT_LOOK,
  strokeColor: HB_UI_COLORS.text,
  style: "elbow",
  elbowed: true,
  startArrowhead: null,
  endArrowhead: "arrow",
} as const;

/**
 * پیش‌فرض‌های متن، وابسته به جهت.
 *
 * `textAlign` از `defaultTextAlignFor` می‌آید نه یک ثابت — همان منبع واحدی
 * که بوم و ویرایشگر هم از آن می‌خوانند ([ADR-024](../../../../ARCHITECTURE_DECISIONS.md#adr-024)).
 * ثابت‌کردنش اینجا یعنی یک منبع چهارم و همان پرشی که ADR-024 حذفش کرد.
 */
export function hbTextDefaults(direction: TextDirection = "rtl") {
  return {
    fontSize: HB_TYPO.defaultFontSize,
    lineHeight: HB_TYPO.lineHeight,
    textAlign: defaultTextAlignFor(direction),
    verticalAlign: "top",
    direction: "auto" as HbTextDirection,
    autoResize: true,
    strokeColor: HB_UI_COLORS.text,
  } as const;
}

/** متن مقید داخل استیکی — وسط‌چین افقی و عمودی. */
export function hbBoundTextDefaults(direction: TextDirection = "rtl") {
  return {
    ...hbTextDefaults(direction),
    textAlign: "center",
    verticalAlign: "middle",
  } as const;
}
