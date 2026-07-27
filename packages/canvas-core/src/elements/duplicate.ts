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

export function duplicateElements(
  elements: HbElement[],
  selectedIds: ReadonlySet<string>,
  options: DuplicateOptions = {},
): { elements: HbElement[]; newIds: string[] } {
  const seed = resolveSeed(options);
  const offset = options.offset ?? DEFAULT_OFFSET;

  // id هایی که کپی می‌شوند: انتخاب + متنِ مقیدِ آن‌ها.
  const toCopy = new Set<string>();
  for (const el of elements) {
    if (!selectedIds.has(el.id) || el.isDeleted) continue;
    toCopy.add(el.id);
    for (const bound of el.boundElements ?? []) toCopy.add(bound.id);
  }
  if (toCopy.size === 0) return { elements, newIds: [] };

  // نگاشتِ id قدیمی → جدید (پیشوندِ نوع حفظ می‌شود: stk_, txt_, …).
  const idMap = new Map<string, string>();
  for (const el of elements) {
    if (!toCopy.has(el.id)) continue;
    const prefix = el.id.includes("_") ? el.id.slice(0, el.id.indexOf("_")) : "el";
    idMap.set(el.id, `${prefix}_${seed.makeId()}`);
  }

  const remapId = (id: string): string => idMap.get(id) ?? id;

  const clones: HbElement[] = [];
  for (const el of elements) {
    if (!toCopy.has(el.id)) continue;
    const source = el as HbElement & {
      containerId?: string | null;
      frameId?: string | null;
    };
    const clone = {
      ...source,
      id: remapId(el.id),
      x: el.x + offset,
      y: el.y + offset,
      version: 1,
      versionNonce: Math.floor(seed.random() * MAX_SEED),
      // پیوندها را به id های تازه دوباره‌نگاشت کن (فقط اگر طرفِ مقابل هم کپی شده).
      boundElements:
        source.boundElements?.map((b) => ({ ...b, id: remapId(b.id) })) ?? source.boundElements,
      containerId:
        source.containerId != null && idMap.has(source.containerId)
          ? remapId(source.containerId)
          : (source.containerId ?? undefined),
      // کلون عضوِ همان فریمِ اصل باقی می‌ماند مگر بعداً عضویت دوباره حساب شود.
    } as unknown as HbElement;
    clones.push(clone);
  }

  return {
    elements: [...elements, ...clones],
    newIds: clones.map((c) => c.id),
  };
}
