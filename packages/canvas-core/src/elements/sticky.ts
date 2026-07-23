import type { HbElement, HbStickyColor, HbTextElement } from "@hamboom/shared-types";

import { detectBaseDirection } from "../text/bidi";
import { hbBoundTextDefaults, HB_STICKY_DEFAULTS } from "../theme/defaults";
import { getStickySwatch, HB_STICKY_DEFAULT } from "../theme/sticky-palette";
import { HB_FONT_FAMILY, HB_STICKY_GAP, HB_TYPO } from "../theme/tokens";
import { getKind } from "./mapping";

/**
 * استیکی‌نوت — گام ۳٫۲.
 *
 * ── چرا دو عنصر، نه یکی ───────────────────────────────────────────────
 *
 * یک استیکی از ظرف مستطیلی + متن مقید ساخته می‌شود، چون همین الگو بومی موتور
 * است و با آن ویرایش متن، wrap و تغییر اندازه‌ی خودکار **رایگان** به دست
 * می‌آید. ساختن یک عنصر سفارشی یعنی بازنویسی همه‌ی این‌ها
 * ([ADR-010](../../../../ARCHITECTURE_DECISIONS.md#adr-010)).
 *
 * ── چرا همه‌چیز تزریق‌پذیر است ─────────────────────────────────────────
 *
 * `makeId`، `random` و `now` پارامترند تا خروجی در تست قطعی باشد. بدون آن،
 * هر تست snapshot و round-trip به `Math.random` وابسته می‌شد.
 */

/** فاصله‌ی داخلی متن از لبه‌ی استیکی. */
const STICKY_PADDING = 12;

export interface CreateStickyOptions {
  x: number;
  y: number;
  palette?: HbStickyColor;
  text?: string;
  authorId: string;
  /** ایندکس لایه — تولید واقعی fractional index کار گام ۵٫۱ است. */
  index?: string;
  now?: number;
  makeId?: () => string;
  random?: () => number;
  /**
   * اگر داده شود، اندازه‌ی فونت با `fitStickyFontSize` از طول متن حساب می‌شود.
   *
   * تزریق‌پذیر است چون `createSticky` باید خالص بماند — اندازه‌گیری واقعی به
   * canvas نیاز دارد و در تست node وجود ندارد.
   */
  measure?: MeasureLine;
}

export interface StickyPair {
  container: HbElement;
  text: HbElement;
  /** به ترتیب z: ظرف پایین، متن رویش. */
  elements: [HbElement, HbElement];
}

function defaultMakeId(): string {
  return Math.random().toString(36).slice(2, 12);
}

/**
 * ساخت یک استیکی‌نوت.
 *
 * `direction` عنصر متن روی `"auto"` می‌ماند تا از محتوا استنتاج شود
 * ([ADR-024](../../../../ARCHITECTURE_DECISIONS.md#adr-024))، ولی `textAlign`
 * همان لحظه از جهت متن اولیه حساب می‌شود تا استیکی از اولین رندر درست بنشیند.
 */
export function createSticky(options: CreateStickyOptions): StickyPair {
  const {
    x,
    y,
    palette = HB_STICKY_DEFAULT,
    text = "",
    authorId,
    index = "a0",
    now = Date.now(),
    makeId = defaultMakeId,
    random = Math.random,
    measure,
  } = options;

  const swatch = getStickySwatch(palette);
  const containerId = `stk_${makeId()}`;
  const textId = `txt_${makeId()}`;
  const direction = detectBaseDirection(text);
  const textDefaults = hbBoundTextDefaults(direction);

  // متن اولیه ممکن است بلند باشد (پیست، قالب) — همان‌جا اندازه را جا بینداز.
  const box = stickyInnerBox();
  const fontSize =
    measure && text !== ""
      ? fitStickyFontSize({ text, ...box, measure, lineHeight: textDefaults.lineHeight })
      : textDefaults.fontSize;

  const hb = {
    schema: 1 as const,
    kind: "sticky" as const,
    createdBy: authorId,
    lastEditedBy: authorId,
    createdAt: now,
  };

  const container = {
    id: containerId,
    type: "rectangle" as const,
    x,
    y,
    width: HB_STICKY_DEFAULTS.width,
    height: HB_STICKY_DEFAULTS.height,
    angle: 0,
    index,
    frameId: null,
    groupIds: [],
    locked: false,
    strokeColor: HB_STICKY_DEFAULTS.strokeColor,
    backgroundColor: swatch.bg,
    fillStyle: HB_STICKY_DEFAULTS.fillStyle,
    strokeWidth: HB_STICKY_DEFAULTS.strokeWidth,
    strokeStyle: HB_STICKY_DEFAULTS.strokeStyle,
    roughness: HB_STICKY_DEFAULTS.roughness,
    opacity: HB_STICKY_DEFAULTS.opacity,
    roundness: { ...HB_STICKY_DEFAULTS.roundness },
    seed: Math.floor(random() * 2_147_483_647),
    version: 1,
    versionNonce: Math.floor(random() * 2_147_483_647),
    updated: now,
    isDeleted: false,
    boundElements: [{ id: textId, type: "text" as const }],
    link: null,
    customData: { hb: { ...hb, sticky: { palette, autoFit: HB_STICKY_DEFAULTS.autoFit } } },
  } as unknown as HbElement;

  const textElement = {
    id: textId,
    type: "text" as const,
    x: x + STICKY_PADDING,
    y: y + STICKY_PADDING,
    width: HB_STICKY_DEFAULTS.width - STICKY_PADDING * 2,
    height: fontSize * textDefaults.lineHeight,
    angle: 0,
    index: `${index}V`,
    frameId: null,
    groupIds: [],
    locked: false,
    strokeColor: swatch.text,
    backgroundColor: "transparent",
    fillStyle: HB_STICKY_DEFAULTS.fillStyle,
    strokeWidth: HB_STICKY_DEFAULTS.strokeWidth,
    strokeStyle: HB_STICKY_DEFAULTS.strokeStyle,
    roughness: HB_STICKY_DEFAULTS.roughness,
    opacity: HB_STICKY_DEFAULTS.opacity,
    roundness: null,
    seed: Math.floor(random() * 2_147_483_647),
    version: 1,
    versionNonce: Math.floor(random() * 2_147_483_647),
    updated: now,
    isDeleted: false,
    boundElements: null,
    link: null,
    containerId,
    text,
    originalText: text,
    fontSize,
    fontFamily: HB_FONT_FAMILY,
    textAlign: textDefaults.textAlign,
    verticalAlign: textDefaults.verticalAlign,
    lineHeight: textDefaults.lineHeight,
    direction: textDefaults.direction,
    autoResize: false,
    customData: { hb: { ...hb, kind: "text" as const } },
  } as unknown as HbElement;

  return { container, text: textElement, elements: [container, textElement] };
}

// ─────────────────────────────────────────────────────────────
// autoFit — اندازه‌ی فونت با طول متن
// ─────────────────────────────────────────────────────────────

/** تابع اندازه‌گیری عرض یک خط در یک اندازه‌ی فونت مشخص. */
export type MeasureLine = (text: string, fontSize: number) => number;

/**
 * شکست خط حریصانه — همان الگویی که موتور استفاده می‌کند.
 *
 * کلمه‌ای که از عرض ظرف پهن‌تر باشد، اجباری وسط شکسته می‌شود. spike گام ۱٫۳
 * نشان داد این کار در فارسی اتصال حروف را پاره می‌کند، ولی چون فقط برای
 * تک‌کلمه‌های غیرعادی رخ می‌دهد به‌عنوان محدودیت شناخته‌شده پذیرفته شد.
 */
export function wrapTextGreedy(
  text: string,
  maxWidth: number,
  fontSize: number,
  measure: MeasureLine,
): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split("\n")) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }

    let current = "";
    for (const word of paragraph.split(" ")) {
      const candidate = current === "" ? word : `${current} ${word}`;
      if (measure(candidate, fontSize) <= maxWidth || current === "") {
        // کلمه‌ای که خودش از ظرف پهن‌تر است باید اجباری شکسته شود.
        if (current === "" && measure(word, fontSize) > maxWidth) {
          let chunk = "";
          for (const char of word) {
            if (chunk !== "" && measure(chunk + char, fontSize) > maxWidth) {
              lines.push(chunk);
              chunk = char;
            } else {
              chunk += char;
            }
          }
          current = chunk;
          continue;
        }
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }

  return lines;
}

export interface FitStickyFontOptions {
  text: string;
  /** عرض قابل استفاده — یعنی عرض استیکی منهای padding. */
  innerWidth: number;
  innerHeight: number;
  measure: MeasureLine;
  lineHeight?: number;
  /** اندازه‌های کاندید. ترتیب مهم نیست؛ نزولی مرتب می‌شود. */
  sizes?: readonly number[];
}

/**
 * بزرگ‌ترین اندازه‌ی فونتی که متن در آن جا می‌شود.
 *
 * اگر هیچ اندازه‌ای جا نشود، کوچک‌ترین را برمی‌گرداند — متن سرریز می‌کند ولی
 * استیکی خالی نمی‌ماند. جایگزینش (برگرداندن `null`) یعنی مصرف‌کننده باید
 * حالت خطا داشته باشد، که برای یک استیکی بیش از حد است.
 */
export function fitStickyFontSize(options: FitStickyFontOptions): number {
  const {
    text,
    innerWidth,
    innerHeight,
    measure,
    lineHeight = HB_TYPO.lineHeight,
    sizes = HB_TYPO.fontSizes,
  } = options;

  const candidates = [...sizes]
    .filter((s) => s >= HB_TYPO.stickyFontRange.min && s <= HB_TYPO.stickyFontRange.max)
    .sort((a, b) => b - a);

  const smallest = candidates.at(-1) ?? HB_TYPO.stickyFontRange.min;
  if (text.trim() === "") return candidates[0] ?? smallest;

  for (const size of candidates) {
    const lines = wrapTextGreedy(text, innerWidth, size, measure);
    const height = lines.length * size * lineHeight;
    const widest = Math.max(...lines.map((line) => measure(line, size)));
    if (height <= innerHeight && widest <= innerWidth) return size;
  }

  return smallest;
}

/** عرض و ارتفاع قابل استفاده‌ی داخل یک استیکی. */
export function stickyInnerBox(
  width = HB_STICKY_DEFAULTS.width,
  height = HB_STICKY_DEFAULTS.height,
) {
  return {
    innerWidth: width - STICKY_PADDING * 2,
    innerHeight: height - STICKY_PADDING * 2,
  };
}

// ─────────────────────────────────────────────────────────────
// عملیات روی انتخاب
// ─────────────────────────────────────────────────────────────

/**
 * تغییر رنگ همه‌ی استیکی‌های یک انتخاب.
 *
 * عناصر غیر استیکی دست‌نخورده رد می‌شوند — پس می‌شود کل انتخاب را داد و
 * لازم نیست مصرف‌کننده خودش فیلتر کند (و روی `type` شرط بگذارد، که ADR-010
 * ممنوعش کرده).
 *
 * متن مقید هر استیکی هم رنگش عوض می‌شود، وگرنه روی پس‌زمینه‌ی جدید ناخوانا
 * می‌شود — دقیقاً همان چیزی که گیت کنتراست گام ۳٫۱ جلویش را می‌گیرد.
 */
export function applyStickyPalette(elements: HbElement[], palette: HbStickyColor): HbElement[] {
  const swatch = getStickySwatch(palette);
  const stickyIds = new Set(elements.filter((el) => getKind(el) === "sticky").map((el) => el.id));

  if (stickyIds.size === 0) return elements;

  return elements.map((element) => {
    if (stickyIds.has(element.id)) {
      return {
        ...element,
        backgroundColor: swatch.bg,
        version: element.version + 1,
        customData: {
          ...element.customData,
          hb: {
            ...element.customData.hb,
            sticky: { ...element.customData.hb.sticky, palette, autoFit: true },
          },
        },
      } as HbElement;
    }

    const containerId = (element as HbTextElement).containerId;
    if (element.type === "text" && containerId !== null && stickyIds.has(containerId)) {
      return { ...element, strokeColor: swatch.text, version: element.version + 1 } as HbElement;
    }

    return element;
  });
}

/**
 * موقعیت استیکی بعدی در چیدمان پشت‌سرهم — رفتار `Tab`.
 *
 * جهت پیش‌فرض `"inline"` است که در RTL یعنی سمت چپ. عمداً از مفهوم منطقی
 * استفاده می‌کند نه فیزیکی، چون چیدمان استیکی‌ها باید جهت خواندن کاربر را
 * دنبال کند ([ADR-016](../../../../ARCHITECTURE_DECISIONS.md#adr-016))
 * — برخلاف خودِ مختصات بوم که هرگز آینه نمی‌شود.
 */
export function nextStickyPosition(
  previous: { x: number; y: number; width: number; height: number },
  direction: "inline" | "block" = "inline",
  textDirection: "rtl" | "ltr" = "rtl",
): { x: number; y: number } {
  if (direction === "block") {
    return { x: previous.x, y: previous.y + previous.height + HB_STICKY_GAP };
  }

  const step = previous.width + HB_STICKY_GAP;
  return { x: textDirection === "rtl" ? previous.x - step : previous.x + step, y: previous.y };
}
