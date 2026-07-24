import type { HbElement } from "@hamboom/shared-types";

import { HB_FRAME_DEFAULTS } from "../theme/defaults";
import { HB_SIZE } from "../theme/tokens";
import { buildBaseElement, bumpVersion, resolveSeed, type ElementSeedOptions } from "./factory";
import { getKind } from "./mapping";

/**
 * فریم (سکشن) — گام ۳٫۵.
 *
 * ── مدل عضویت ─────────────────────────────────────────────────────────
 *
 * عضویت با `frameId` روی **فرزند** اعلام می‌شود، نه با فهرستی روی فریم. دلیل:
 * یک عنصر همیشه می‌داند عضو کدام فریم است (یک فیلد)، ولی اگر عضویت فهرستی روی
 * فریم بود، هر جابه‌جایی عنصر باید دو جا را هماهنگ نگه می‌داشت. با `frameId`،
 * حرکت یک عنصر به داخل/بیرون فریم فقط یک فیلد را عوض می‌کند
 * ([PLAN بخش ۷٫۳](../../../../PLAN.md)).
 *
 * ── حرکت و undo ───────────────────────────────────────────────────────
 *
 * حرکت فریم = حرکت فریم + همه‌ی فرزندانش. این توابع فقط عناصر جدید را می‌سازند
 * (خالص)؛ نوشتن به صحنه در **یک** `updateScene(IMMEDIATELY)` وظیفه‌ی مصرف‌کننده
 * است تا کل ژست یک ورودی undo شود ([ADR-026](../../../../ARCHITECTURE_DECISIONS.md#adr-026)).
 */

export interface CreateFrameOptions extends ElementSeedOptions {
  x: number;
  y: number;
  width?: number;
  height?: number;
  name?: string;
  authorId: string;
  index?: string;
  color?: string;
}

export function createFrame(options: CreateFrameOptions): HbElement {
  const {
    x,
    y,
    width = HB_SIZE.frame.width,
    height = HB_SIZE.frame.height,
    name = "فریم بدون عنوان",
    authorId,
    index = "a0",
    color = HB_FRAME_DEFAULTS.color,
    ...seedOptions
  } = options;

  const seed = resolveSeed(seedOptions);

  return {
    ...buildBaseElement({
      id: `frm_${seed.makeId()}`,
      type: "frame",
      x,
      y,
      width,
      height,
      index,
      kind: "frame",
      authorId,
      seed,
      hbExtra: { frame: { collapsed: HB_FRAME_DEFAULTS.collapsed, color } },
    }),
    strokeColor: HB_FRAME_DEFAULTS.strokeColor,
    backgroundColor: HB_FRAME_DEFAULTS.backgroundColor,
    roundness: null,
    name,
  } as unknown as HbElement;
}

// ─────────────────────────────────────────────────────────────
// عضویت
// ─────────────────────────────────────────────────────────────

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function contains(frame: Bounds, child: Bounds): boolean {
  return (
    child.x >= frame.x &&
    child.y >= frame.y &&
    child.x + child.width <= frame.x + frame.width &&
    child.y + child.height <= frame.y + frame.height
  );
}

/** آیا این عنصر می‌تواند عضو یک فریم باشد؟ فریم داخل فریم نه، متن مقید نه. */
function isFrameable(element: HbElement): boolean {
  if (getKind(element) === "frame") return false;
  // متن مقید عضویتش را از ظرفش می‌گیرد، نه مستقل.
  const containerId = (element as { containerId?: string | null }).containerId;
  return containerId === null || containerId === undefined;
}

/**
 * `frameId` هر عنصر را بر اساس اینکه داخل مرز کدام فریم است، دوباره حساب می‌کند.
 *
 * عنصری که کاملاً داخل یک فریم بیفتد، عضو آن می‌شود؛ عنصری که بیرون برود،
 * `frameId` اش پاک می‌شود. اگر داخل چند فریم تودرتو باشد، **بالاترین در z**
 * (بزرگ‌ترین `index`) برنده است.
 *
 * خالص است و اگر عضویتی عوض نشود همان آرایه را برمی‌گرداند.
 */
export function recomputeFrameMembership(elements: HbElement[]): HbElement[] {
  const frames = elements.filter((el) => getKind(el) === "frame" && !el.isDeleted);
  if (frames.length === 0) {
    // هیچ فریمی نیست — هر frameId باقی‌مانده باید پاک شود.
    let touched = false;
    const cleared = elements.map((el) => {
      if (el.frameId === null) return el;
      touched = true;
      return bumpVersion({ ...el, frameId: null }) as HbElement;
    });
    return touched ? cleared : elements;
  }

  // فریم‌ها به ترتیب نزولی z تا اولین شاملْ برنده باشد.
  const framesByZ = [...frames].sort((a, b) => (a.index < b.index ? 1 : -1));

  let changed = false;
  const next = elements.map((element) => {
    if (element.isDeleted || !isFrameable(element)) return element;

    const owner = framesByZ.find((frame) => contains(frame, element));
    const nextFrameId = owner ? owner.id : null;

    if (element.frameId === nextFrameId) return element;
    changed = true;
    return bumpVersion({ ...element, frameId: nextFrameId }) as HbElement;
  });

  return changed ? next : elements;
}

// ─────────────────────────────────────────────────────────────
// حرکت
// ─────────────────────────────────────────────────────────────

/** شناسه‌ی فرزندان یک فریم — عناصری که `frameId` شان برابر آن است. */
export function frameChildren(elements: HbElement[], frameId: string): HbElement[] {
  return elements.filter((el) => el.frameId === frameId && !el.isDeleted);
}

/**
 * حرکت یک فریم و همه‌ی فرزندانش با یک جابه‌جایی.
 *
 * ⚠️ متن مقیدِ فرزندان هم باید حرکت کند — یک استیکیِ داخل فریم دو عنصر است
 * (ظرف + متن) و متن `frameId` ندارد ولی `containerId` دارد. پس علاوه بر
 * فرزندان مستقیم، متن‌های مقید آن‌ها هم جابه‌جا می‌شوند.
 *
 * خالص: عناصر جدید را برمی‌گرداند. مصرف‌کننده همه را در یک
 * `updateScene(IMMEDIATELY)` می‌نویسد تا یک ورودی undo شود (ADR-026).
 */
export function moveFrame(
  elements: HbElement[],
  frameId: string,
  dx: number,
  dy: number,
): HbElement[] {
  if (dx === 0 && dy === 0) return elements;

  // شناسه‌ی همه‌ی چیزهایی که باید حرکت کنند: خود فریم، فرزندان، و متن مقید فرزندان.
  const toMove = new Set<string>([frameId]);
  for (const element of elements) {
    if (element.frameId === frameId) {
      toMove.add(element.id);
      for (const bound of element.boundElements ?? []) toMove.add(bound.id);
    }
  }

  return elements.map((element) => {
    if (!toMove.has(element.id)) return element;
    return bumpVersion({ ...element, x: element.x + dx, y: element.y + dy }) as HbElement;
  });
}

/**
 * حذف یک فریم. فرزندان **پاک نمی‌شوند** — فقط از فریم آزاد می‌شوند.
 *
 * این رفتار میرو است: حذف فریم، محتوایش را روی بوم رها می‌کند، نه اینکه
 * نابودش کند. حذف همراه با محتوا یک عملیات جداست.
 */
export function deleteFrameKeepChildren(elements: HbElement[], frameId: string): HbElement[] {
  return elements.map((element) => {
    if (element.id === frameId) {
      return bumpVersion({ ...element, isDeleted: true }) as HbElement;
    }
    if (element.frameId === frameId) {
      return bumpVersion({ ...element, frameId: null }) as HbElement;
    }
    return element;
  });
}
