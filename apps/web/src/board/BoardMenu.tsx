import type { ReactNode } from "react";

/**
 * منوی سه‌نقطه‌ی بورد — فقط امکاناتی که **پشتشان کارِ واقعی هست** (تاییدِ مالک ۱۴۰۵/۰۶/۱۲):
 *
 * - **نمایش (محلی، با همتاها هم‌گام نمی‌شود — مثلِ منوی View میرو):** شبکه (`gridModeEnabled`)،
 *   چسبیدن/هم‌ترازی (`objectsSnapModeEnabled`)، مکان‌نمای همکاران (گیتِ رندرِ `PeerCursors`).
 * - **ویرایش (ویرایشگر+):** واگرد/ازنو روی همان `UndoScope`ِ Yjs که `Ctrl+Z` می‌زند (ADR-035).
 * - **بورد:** تغییرِ نام (`PATCH /boards/:id`، ویرایشگر+) و حذف به سطلِ بازیافت (`DELETE /boards/:id`، فقط owner).
 *
 * ⛔ خروجی/تاریخچه/قالب/کامنت (فاز ۱۰) و تکثیر (متادیتاییِ بی‌محتوا) عمداً نیستند — نه حتی «به‌زودی».
 *
 * استایل از `.card-menu`ِ موجود reuse می‌شود (ADR-024)، مثلِ `BoardCardMenu`.
 */
export interface BoardMenuProps {
  canEdit: boolean;
  isOwner: boolean;
  showGrid: boolean;
  snapEnabled: boolean;
  showPeerCursors: boolean;
  onToggleGrid: () => void;
  onToggleSnap: () => void;
  onToggleCursors: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function BoardMenu({
  canEdit,
  isOwner,
  showGrid,
  snapEnabled,
  showPeerCursors,
  onToggleGrid,
  onToggleSnap,
  onToggleCursors,
  onUndo,
  onRedo,
  onRename,
  onDelete,
  onClose,
}: BoardMenuProps) {
  return (
    <>
      {/* پس‌زمینه‌ی نامرئی: کلیک بیرون منو را می‌بندد (همان الگوی BoardCardMenu). */}
      <button type="button" className="menu-backdrop" aria-label="بستنِ منو" onClick={onClose} />
      <div className="card-menu board-menu" role="menu">
        <p className="card-menu__label">نمایش</p>
        <ToggleItem checked={showGrid} onClick={onToggleGrid}>
          شبکه
        </ToggleItem>
        <ToggleItem checked={snapEnabled} onClick={onToggleSnap}>
          چسبیدن و هم‌ترازی
        </ToggleItem>
        <ToggleItem checked={showPeerCursors} onClick={onToggleCursors}>
          مکان‌نمای همکاران
        </ToggleItem>

        {canEdit && (
          <>
            <div className="card-menu__divider" />
            <p className="card-menu__label">ویرایش</p>
            <button type="button" role="menuitem" className="card-menu__item board-menu__item" onClick={onUndo}>
              <span className="board-menu__icon" aria-hidden="true">
                ↶
              </span>
              واگرد
            </button>
            <button type="button" role="menuitem" className="card-menu__item board-menu__item" onClick={onRedo}>
              <span className="board-menu__icon" aria-hidden="true">
                ↷
              </span>
              ازنو
            </button>
          </>
        )}

        {(canEdit || isOwner) && <div className="card-menu__divider" />}
        {canEdit && (
          <button
            type="button"
            role="menuitem"
            className="card-menu__item board-menu__item"
            onClick={() => {
              onClose();
              onRename();
            }}
          >
            <span className="board-menu__icon" aria-hidden="true">
              ✎
            </span>
            تغییرِ نامِ بورد
          </button>
        )}
        {isOwner && (
          <button
            type="button"
            role="menuitem"
            className="card-menu__item board-menu__item card-menu__item--danger"
            onClick={() => {
              onClose();
              onDelete();
            }}
          >
            <span className="board-menu__icon" aria-hidden="true">
              🗑
            </span>
            حذفِ بورد
          </button>
        )}
      </div>
    </>
  );
}

/** آیتمِ تیک‌دار (روشن/خاموش) — نقشِ `menuitemcheckbox`، تیکِ ✓ وقتی فعال است. */
function ToggleItem({
  checked,
  onClick,
  children,
}: {
  checked: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      className={
        checked
          ? "card-menu__item board-menu__item card-menu__item--on"
          : "card-menu__item board-menu__item"
      }
      onClick={onClick}
    >
      <span className="board-menu__icon" aria-hidden="true">
        {checked ? "✓" : ""}
      </span>
      {children}
    </button>
  );
}
