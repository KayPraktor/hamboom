/**
 * ابزارِ منوی راست‌کلیک — گام ۴٫۳ / preempt کردنِ منوی خودِ موتور.
 *
 * در مرورگر تایید شد (هر دو جهت): رویدادِ `contextmenu`ِ **معتبر** در فاز capture
 * روی `document` می‌رسد؛ گرفتنش با `preventDefault` + `stopImmediatePropagation`
 * منوی موتور را باز نمی‌گذارد. این هم‌کلاسِ drop/paste است، نه محدودیتِ ورود به
 * ویرایش متن (که API عمومی نداشت). رویدادهای مصنوعی را موتور می‌گیرد؛ ولی
 * preemptِ ما به isTrusted کاری ندارد و روی رویدادِ واقعیِ کاربر کار می‌کند.
 */

const CANVAS_ROOT = ".excalidraw";

export interface ContextMenuToolOptions {
  /** ریشه‌ی رویداد. پیش‌فرض `document` (چرایش در `sticky-tool`). */
  root?: Document | HTMLElement;
  /** روی بوم راست‌کلیک شد — مختصاتِ کلاینت (فیزیکی). */
  onOpen: (point: { x: number; y: number }) => void;
}

export interface ContextMenuTool {
  destroy(): void;
}

export function createContextMenuTool(options: ContextMenuToolOptions): ContextMenuTool {
  const { root = typeof document === "undefined" ? undefined : document, onOpen } = options;

  const onContextMenu = (event: MouseEvent) => {
    const target = event.target as Element | null;
    if (!target?.closest?.(CANVAS_ROOT)) return; // بیرون از بوم → منوی مرورگر بماند
    // preempt منوی موتور (تایید مرورگر). باید قبل از هندلرِ React موتور اجرا شود.
    event.preventDefault();
    event.stopImmediatePropagation();
    onOpen({ x: event.clientX, y: event.clientY });
  };

  root?.addEventListener("contextmenu", onContextMenu as EventListener, { capture: true });

  return {
    destroy: () =>
      root?.removeEventListener("contextmenu", onContextMenu as EventListener, { capture: true }),
  };
}
