import type { HbElement } from "@hamboom/shared-types";

import { bumpVersion } from "./factory";

/**
 * هم‌ترازی و توزیعِ عناصرِ انتخاب‌شده — گام ۵٫۱.
 *
 * ⚠️ **مختصاتِ بوم آینه نمی‌شود** ([ADR-016](../../../../ARCHITECTURE_DECISIONS.md#adr-016)/P6).
 * «چپ» = کمینه‌ی `x`، «راست» = بیشینه‌ی `x` — فارغ از RTL. فقط برچسبِ UI فارسی
 * است، خودِ عملیات روی مختصاتِ فیزیکیِ بوم است. این را با هیچ «اصلاحِ RTL» خراب نکن.
 *
 * خالص‌اند و اگر جابه‌جایی لازم نباشد همان آرایه را برمی‌گردانند. هر جهش از
 * `bumpVersion` رد می‌شود تا موتور برای undo ثبتش کند ([ADR-026](../../../../ARCHITECTURE_DECISIONS.md#adr-026)).
 */

export type AlignEdge = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
export type DistributeAxis = "horizontal" | "vertical";

interface Delta {
  dx: number;
  dy: number;
}

function liveSelected(elements: HbElement[], selectedIds: ReadonlySet<string>): HbElement[] {
  return elements.filter((el) => selectedIds.has(el.id) && !el.isDeleted);
}

/**
 * جابه‌جاییِ عناصر با نگاشتِ delta — و **متنِ مقیدِ** هر عنصرِ جابه‌جاشده با همان
 * delta حرکت می‌کند تا برچسب از ظرفش جدا نیفتد (مثل `moveFrame`).
 */
function moveByDeltas(elements: HbElement[], deltas: Map<string, Delta>): HbElement[] {
  if (deltas.size === 0) return elements;
  const all = new Map(deltas);
  for (const el of elements) {
    const d = deltas.get(el.id);
    if (!d) continue;
    for (const bound of el.boundElements ?? []) {
      if (bound.type === "text" && !all.has(bound.id)) all.set(bound.id, d);
    }
  }
  return elements.map((el) => {
    const d = all.get(el.id);
    return d ? bumpVersion({ ...el, x: el.x + d.dx, y: el.y + d.dy }) : el;
  });
}

/** هم‌ترازیِ عناصرِ انتخاب‌شده به یک لبه/مرکزِ مشترکِ کلِ انتخاب. حداقل ۲ عنصر. */
export function alignElements(
  elements: HbElement[],
  selectedIds: ReadonlySet<string>,
  edge: AlignEdge,
): HbElement[] {
  const sel = liveSelected(elements, selectedIds);
  if (sel.length < 2) return elements;

  const minX = Math.min(...sel.map((e) => e.x));
  const maxX = Math.max(...sel.map((e) => e.x + e.width));
  const minY = Math.min(...sel.map((e) => e.y));
  const maxY = Math.max(...sel.map((e) => e.y + e.height));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const targetX = (e: HbElement): number => {
    if (edge === "left") return minX;
    if (edge === "right") return maxX - e.width;
    if (edge === "hcenter") return cx - e.width / 2;
    return e.x;
  };
  const targetY = (e: HbElement): number => {
    if (edge === "top") return minY;
    if (edge === "bottom") return maxY - e.height;
    if (edge === "vcenter") return cy - e.height / 2;
    return e.y;
  };

  const deltas = new Map<string, Delta>();
  for (const e of sel) {
    const dx = targetX(e) - e.x;
    const dy = targetY(e) - e.y;
    if (dx !== 0 || dy !== 0) deltas.set(e.id, { dx, dy });
  }
  return moveByDeltas(elements, deltas);
}

/**
 * توزیعِ یکنواختِ عناصر در یک محور — **فاصله‌ی لبه‌به‌لبه** برابر می‌شود و دو
 * سرِ بیرونی ثابت می‌مانند. حداقل ۳ عنصر (با ۲ تا توزیع بی‌معناست).
 */
export function distributeElements(
  elements: HbElement[],
  selectedIds: ReadonlySet<string>,
  axis: DistributeAxis,
): HbElement[] {
  const sel = liveSelected(elements, selectedIds);
  if (sel.length < 3) return elements;

  const pos = (e: HbElement) => (axis === "horizontal" ? e.x : e.y);
  const size = (e: HbElement) => (axis === "horizontal" ? e.width : e.height);

  const sorted = [...sel].sort((a, b) => pos(a) - pos(b));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const span = pos(last) + size(last) - pos(first);
  const totalSize = sorted.reduce((s, e) => s + size(e), 0);
  const gap = (span - totalSize) / (sorted.length - 1);

  const deltas = new Map<string, Delta>();
  let cursor = pos(first);
  for (const e of sorted) {
    const target = cursor;
    cursor += size(e) + gap;
    const shift = target - pos(e);
    if (shift === 0) continue;
    deltas.set(e.id, axis === "horizontal" ? { dx: shift, dy: 0 } : { dx: 0, dy: shift });
  }
  return moveByDeltas(elements, deltas);
}
