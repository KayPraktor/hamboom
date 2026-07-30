import type { HbElement } from "@hamboom/shared-types";

import { resolveSeed, type ElementSeedOptions } from "./factory";

/**
 * تکثیرِ عناصرِ انتخاب‌شده — گام ۴٫۳ (کنشِ منوی راست‌کلیک).
 *
 * ── چرا متنِ مقید هم کپی می‌شود ────────────────────────────────────────
 *
 * یک استیکی از دید موتور دو عنصر است: ظرف + متنِ مقید (`containerId`). اگر فقط
 * ظرف کپی شود، کلونْ متن ندارد. پس **متنِ مقیدِ هر عنصرِ انتخاب‌شده هم** کپی و
 * id هایش دوباره‌نگاشت می‌شوند تا پیوندِ ظرف↔متن در کلون سالم بماند.
 *
 * خالص و تزریق‌پذیر (`makeId`/`random`) تا خروجی در تست قطعی باشد.
 */

const MAX_SEED = 2_147_483_647;
const DEFAULT_OFFSET = 16;

export interface DuplicateOptions extends ElementSeedOptions {
  /** آفستِ کلون نسبت به اصل (پیکسلِ صحنه). */
  offset?: number;
}

/**
 * ★ هسته‌ی کلون — **منبعِ واحد** برای تکثیر (منوی راست‌کلیک) و **پیستِ کلیپ‌بورد**
 * (گام ۵٫۳). «کدام عناصر» را صداکننده تعیین می‌کند و همان مجموعه (شاملِ متنِ مقید)
 * را می‌دهد؛ اینجا فقط id تازه + آفست + دوباره‌نگاشتِ پیوندها انجام می‌شود.
 *
 * چون idMap روی **کلِ `source`** ساخته می‌شود، پیوندهای داخلی (ظرف↔متنِ مقید،
 * `containerId`) به id های تازه دوباره‌نگاشت می‌شوند و در کلون سالم می‌مانند.
 */
export function cloneElements(
  source: HbElement[],
  options: DuplicateOptions = {},
): { clones: HbElement[]; newIds: string[] } {
  const seed = resolveSeed(options);
  const offset = options.offset ?? DEFAULT_OFFSET;

  // نگاشتِ id قدیمی → جدید (پیشوندِ نوع حفظ می‌شود: stk_, txt_, …).
  const idMap = new Map<string, string>();
  for (const el of source) {
    const prefix = el.id.includes("_") ? el.id.slice(0, el.id.indexOf("_")) : "el";
    idMap.set(el.id, `${prefix}_${seed.makeId()}`);
  }
  const remapId = (id: string): string => idMap.get(id) ?? id;

  const clones = source.map((el) => {
    const s = el as HbElement & { containerId?: string | null; frameId?: string | null };
    return {
      ...s,
      id: remapId(el.id),
      x: el.x + offset,
      y: el.y + offset,
      version: 1,
      versionNonce: Math.floor(seed.random() * MAX_SEED),
      // پیوندها را به id های تازه دوباره‌نگاشت کن (فقط اگر طرفِ مقابل هم کپی شده).
      boundElements: s.boundElements?.map((b) => ({ ...b, id: remapId(b.id) })) ?? s.boundElements,
      containerId:
        s.containerId != null && idMap.has(s.containerId)
          ? remapId(s.containerId)
          : (s.containerId ?? undefined),
      // کلون عضوِ همان فریمِ اصل باقی می‌ماند مگر بعداً عضویت دوباره حساب شود.
    } as unknown as HbElement;
  });

  return { clones, newIds: clones.map((c) => c.id) };
}

/** عناصری که برای کپی/تکثیر باید برداشته شوند: انتخاب + متنِ مقیدِ آن‌ها. */
export function collectWithBoundText(
  elements: HbElement[],
  selectedIds: ReadonlySet<string>,
): HbElement[] {
  const ids = new Set<string>();
  for (const el of elements) {
    if (!selectedIds.has(el.id) || el.isDeleted) continue;
    ids.add(el.id);
    for (const bound of el.boundElements ?? []) ids.add(bound.id);
  }
  return elements.filter((el) => ids.has(el.id));
}

export function duplicateElements(
  elements: HbElement[],
  selectedIds: ReadonlySet<string>,
  options: DuplicateOptions = {},
): { elements: HbElement[]; newIds: string[] } {
  const source = collectWithBoundText(elements, selectedIds);
  if (source.length === 0) return { elements, newIds: [] };
  const { clones, newIds } = cloneElements(source, options);
  return { elements: [...elements, ...clones], newIds };
}
