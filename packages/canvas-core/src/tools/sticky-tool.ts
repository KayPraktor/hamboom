import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { HbStickyColor } from "@hamboom/shared-types";

import { createSticky, nextStickyPosition, type StickyPair } from "../elements/sticky";
import { viewportCoordsToSceneCoords } from "../engine/coords";
import { toExcalidraw } from "../elements/mapping";
import { HB_STICKY_DEFAULT } from "../theme/sticky-palette";

/**
 * ابزار استیکی‌نوت — گام ۳٫۲.
 *
 * ── چرا listener مستقیم روی DOM ───────────────────────────────────────
 *
 * موتور API عمومی برای «ابزار سفارشی» ندارد. `onPointerDown` فقط اطلاع
 * می‌دهد، جلوی رفتار ابزار فعال را نمی‌گیرد. پس وقتی ابزار ما فعال است،
 * رویداد واقعی را در فاز capture می‌گیریم و خودمان عنصر می‌سازیم.
 *
 * ── ⚠️ آنچه با API عمومی ممکن نشد ─────────────────────────────────────
 *
 * **ورود خودکار به حالت ویرایش متن.** `ExcalidrawImperativeAPI` هیچ متدی
 * برای آن ندارد و `editingTextElement` بخشی از یک view مشتق‌شده است، نه
 * چیزی که `updateScene` بپذیرد؛ ویرایشگر با side-effect ساخته می‌شود نه از
 * روی state. استیکی تازه **انتخاب‌شده** ساخته می‌شود تا کاربر با `Enter`
 * (میانبر خود موتور) وارد ویرایش شود. حل کامل با نوار ابزار خودمان در
 * گام ۴٫۲ می‌آید.
 */

/** انتخابگر ریشه‌ی بوم — موتور همیشه این کلاس را می‌گذارد. */
const CANVAS_ROOT = ".excalidraw";

export interface StickyToolOptions {
  api: ExcalidrawImperativeAPI;
  /**
   * ریشه‌ی رویدادها. پیش‌فرض `document` است و رویداد در لحظه با
   * `closest(".excalidraw")` فیلتر می‌شود.
   *
   * ⚠️ عمداً به عنصر بوم گره نمی‌خورد: `excalidrawAPI` **قبل از** اینکه
   * `.excalidraw` وارد DOM شود صدا زده می‌شود، پس گرفتن ارجاع در آن لحظه
   * `null` می‌دهد و ابزار بی‌صدا هرگز ساخته نمی‌شود — همان چیزی که در
   * اولین سیم‌کشی گام ۳٫۲ اتفاق افتاد و در مرورگر گرفته شد.
   */
  root?: Document | HTMLElement;
  authorId: string;
  /** رنگ استیکی بعدی. تابع است تا تغییر رنگ در پنل بلافاصله اثر کند. */
  getPalette?: () => HbStickyColor;
  onCreated?: (pair: StickyPair) => void;
}

export interface StickyTool {
  activate(): void;
  deactivate(): void;
  toggle(): void;
  isActive(): boolean;
  /** ساخت استیکی بعدی در امتداد آخری — رفتار `Tab`. */
  createNext(): StickyPair | null;
  destroy(): void;
}

export function createStickyTool(options: StickyToolOptions): StickyTool {
  const {
    api,
    root = typeof document === "undefined" ? undefined : document,
    authorId,
    getPalette = () => HB_STICKY_DEFAULT,
    onCreated,
  } = options;

  let active = false;
  let last: StickyPair | null = null;

  const insert = (sceneX: number, sceneY: number): StickyPair => {
    const pair = createSticky({
      // کلیک وسط استیکی بنشیند، نه گوشه‌اش.
      x: sceneX - 110,
      y: sceneY - 110,
      palette: getPalette(),
      authorId,
    });

    api.updateScene({
      elements: [...api.getSceneElements(), ...pair.elements.map(toExcalidraw)] as never,
      appState: { selectedElementIds: { [pair.container.id]: true } } as never,
    });

    last = pair;
    onCreated?.(pair);
    return pair;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!active || event.button !== 0) return;
    // فقط کلیک روی خودِ بوم، نه روی نوار ابزار یا پنل‌ها.
    const target = event.target as Element | null;
    if (!target?.closest?.(CANVAS_ROOT)) return;

    // جلوی رفتار ابزار فعال موتور را می‌گیریم.
    event.preventDefault();
    event.stopPropagation();

    const { x, y } = viewportCoordsToSceneCoords(
      { clientX: event.clientX, clientY: event.clientY },
      api.getAppState(),
    );
    insert(x, y);
    deactivate();
  };

  const activate = () => {
    active = true;
    api.setActiveTool({ type: "selection" });
    api.setCursor("crosshair");
  };

  const deactivate = () => {
    active = false;
    api.resetCursor();
  };

  root?.addEventListener("pointerdown", onPointerDown as EventListener, { capture: true });

  return {
    activate,
    deactivate,
    toggle: () => (active ? deactivate() : activate()),
    isActive: () => active,
    createNext: () => {
      if (!last) return null;
      const { x, y } = nextStickyPosition(
        last.container as unknown as { x: number; y: number; width: number; height: number },
        "inline",
        "rtl",
      );
      return insert(x + 110, y + 110);
    },
    destroy: () => {
      deactivate();
      root?.removeEventListener("pointerdown", onPointerDown as EventListener, { capture: true });
    },
  };
}
