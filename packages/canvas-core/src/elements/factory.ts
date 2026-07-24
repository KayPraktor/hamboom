import type { HbCustomData, HbElement, HbKind } from "@hamboom/shared-types";

import { HB_ELEMENT_LOOK } from "../theme/defaults";

/**
 * سازنده‌ی پایه‌ی عنصر — مشترک بین استیکی، شکل، متن و بقیه.
 *
 * ── چرا استخراج شد ────────────────────────────────────────────────────
 *
 * هر عنصر حدود ۲۵ فیلد دارد که بیشترشان متادیتای موتورند و هیچ ربطی به
 * منطق محصول ندارند (`seed`, `versionNonce`, `isDeleted`, …). تکرارشان در
 * هر سازنده یعنی یک فیلد فراموش‌شده = عنصری که رندر نمی‌شود، و بدتر: سه جای
 * مختلف که باید هم‌زمان به‌روز بمانند.
 *
 * ── چرا منابع ناتعین تزریق‌پذیرند ──────────────────────────────────────
 *
 * `makeId`، `random` و `now` پارامترند تا خروجی سازنده‌ها در تست قطعی باشد.
 * بدون آن هر تست snapshot و round-trip به `Math.random` وابسته می‌شد.
 */

/** منابع ناتعین — یکجا، تا هر سازنده مجبور نباشد جدا تزریقشان کند. */
export interface ElementSeedOptions {
  now?: number;
  makeId?: () => string;
  random?: () => number;
}

export interface ElementSeed {
  now: number;
  makeId: () => string;
  random: () => number;
}

const MAX_SEED = 2_147_483_647;

/**
 * نسخه‌ی یک عنصر تغییریافته را بالا می‌برد — **هم `version` هم `versionNonce`**.
 *
 * ⚠️ **هر دو لازم‌اند.** یک باگ واقعی که در مرورگر گرفته شد: اگر فقط `version`
 * بالا برود و `versionNonce` ثابت بماند، موتور تغییر را برای undo **ثبت
 * نمی‌کند** — چون `versionNonce` را برای تشخیص increment می‌خواند. نتیجه:
 * حرکت یا تغییر رنگ، ورودی undo جدا نمی‌سازد و یک `Ctrl+Z` مستقیماً کل
 * عملیات قبلی را برمی‌گرداند.
 *
 * `versionNonce` قطعی بالا می‌رود (`+1`) تا helper ها خالص و تست‌پذیر بمانند —
 * برای تشخیص increment فقط کافی است از مقدار **قبلی** فرق کند، که `+1` تضمین
 * می‌کند. مقدار همیشه زیر `MAX_SEED` می‌ماند (پیمایش دایره‌ای).
 *
 * هر helper ای که property یک عنصر را عوض می‌کند باید از این استفاده کند، نه
 * دستی `version: v + 1`.
 */
export function bumpVersion<T extends { version: number; versionNonce: number }>(element: T): T {
  return {
    ...element,
    version: element.version + 1,
    versionNonce: (element.versionNonce + 1) % MAX_SEED,
  };
}

export function resolveSeed(options: ElementSeedOptions = {}): ElementSeed {
  return {
    now: options.now ?? Date.now(),
    makeId: options.makeId ?? (() => Math.random().toString(36).slice(2, 12)),
    random: options.random ?? Math.random,
  };
}

export interface BaseElementInput {
  id: string;
  type: HbElement["type"];
  x: number;
  y: number;
  width: number;
  height: number;
  index: string;
  kind: HbKind;
  authorId: string;
  seed: ElementSeed;
  /** بخش‌های اختصاصی `customData.hb` — `sticky`, `connector`, `frame`, … */
  hbExtra?: Partial<HbCustomData["hb"]>;
}

/**
 * فیلدهای مشترک هر عنصر، با پیش‌فرض‌های میرو-استایل.
 *
 * خروجی عمداً `Record` است نه `HbElement`: هر نوع عنصر فیلدهای خودش را
 * اضافه می‌کند و تبدیل نهایی در سازنده‌ی همان نوع انجام می‌شود.
 */
export function buildBaseElement(input: BaseElementInput): Record<string, unknown> {
  const { id, type, x, y, width, height, index, kind, authorId, seed, hbExtra } = input;

  return {
    id,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    index,
    frameId: null,
    groupIds: [],
    locked: false,
    fillStyle: HB_ELEMENT_LOOK.fillStyle,
    strokeWidth: HB_ELEMENT_LOOK.strokeWidth,
    strokeStyle: HB_ELEMENT_LOOK.strokeStyle,
    roughness: HB_ELEMENT_LOOK.roughness,
    opacity: HB_ELEMENT_LOOK.opacity,
    seed: Math.floor(seed.random() * MAX_SEED),
    version: 1,
    versionNonce: Math.floor(seed.random() * MAX_SEED),
    updated: seed.now,
    isDeleted: false,
    boundElements: null,
    link: null,
    customData: {
      hb: {
        schema: 1,
        kind,
        createdBy: authorId,
        lastEditedBy: authorId,
        createdAt: seed.now,
        ...hbExtra,
      },
    },
  };
}
