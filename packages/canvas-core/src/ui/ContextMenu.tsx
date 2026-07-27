import { t } from "@hamboom/i18n";
import { useEffect, useRef } from "react";

import { HB_MENU_ITEMS, isMenuItemEnabled, type MenuActionId } from "./context-menu-items";
import "./context-menu.css";

/**
 * منوی راست‌کلیکِ RTL — گام ۴٫۳.
 *
 * ارائه‌ای: موقعیت و وضعیتِ انتخاب را می‌گیرد و `onAction`/`onDismiss` را صدا
 * می‌زند. preempt کردنِ منوی خودِ موتور کارِ `tools/context-menu-tool.ts` است
 * (در مرورگر تایید شد: contextmenu در فاز capture + stopImmediatePropagation منوی
 * موتور را می‌گیرد — مثل drop/paste، نه محدودیتِ ورود به ویرایش متن).
 *
 * ⚠️ موقعیت با `left`/`top`ِ فیزیکی است، نه logical — منو روی **مختصاتِ نشانگر**
 * می‌نشیند که فیزیکی‌اند و آینه نمی‌شوند (استثنای [ADR-016](../../../../ARCHITECTURE_DECISIONS.md#adr-016)،
 * هم‌کلاسِ مختصاتِ بوم). محتوای منو خودش از `dir`ِ سند RTL می‌شود.
 */

export interface ContextMenuProps {
  x: number;
  y: number;
  hasSelection: boolean;
  onAction: (id: MenuActionId) => void;
  onDismiss: () => void;
}

export function ContextMenu({ x, y, hasSelection, onAction, onDismiss }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, { capture: true });
      document.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [onDismiss]);

  return (
    <div
      ref={ref}
      className="hb-context-menu"
      role="menu"
      style={{
        insetBlockStart: `${y}px`,
        // مختصاتِ نشانگر فیزیکی است و آینه نمی‌شود (استثنای ADR-016، هم‌کلاسِ مختصاتِ بوم؛ P6).
        left: `${x}px`,
      }}
    >
      {HB_MENU_ITEMS.map((item) => {
        const enabled = isMenuItemEnabled(item, hasSelection);
        return (
          <div key={item.id}>
            <button
              type="button"
              role="menuitem"
              className="hb-menu-item"
              disabled={!enabled}
              onClick={() => {
                onAction(item.id);
                onDismiss();
              }}
            >
              <span className="hb-menu-label">
                {t(item.labelKey)}
                {item.comingSoon ? " · به‌زودی" : ""}
              </span>
              {item.shortcut ? <span className="hb-menu-shortcut">{item.shortcut}</span> : null}
            </button>
            {item.dividerAfter ? <div className="hb-menu-divider" role="separator" /> : null}
          </div>
        );
      })}
    </div>
  );
}
