import type { BoardSummary } from "@hamboom/shared-types";
import { useQuery } from "@tanstack/react-query";

import { api } from "../api/client.ts";
import { useMoveBoard, useTrashBoard } from "./boards-queries.ts";
import { useFolders } from "./folders-queries.ts";

/**
 * منوی یک کارتِ بورد در نمای زنده — انتقال به فولدر و انتقال به سطل.
 *
 * ★ فولدرها per-team اند و `BoardSummary` تیم را ندارد، پس اینجا `boards.get` می‌زنیم تا
 *   `teamId` (+ فولدرِ فعلی) را بگیریم، بعد فولدرهای همان تیم را. فقط وقتی منو **باز** است
 *   mount می‌شود، پس این کوئری تنبل است. جابه‌جاییِ بین‌تیمی ممکن نیست (api رد می‌کند) — این
 *   منو فقط فولدرهای تیمِ خودِ بورد را پیشنهاد می‌دهد.
 */
export function BoardCardMenu({ board, onClose }: { board: BoardSummary; onClose: () => void }) {
  const full = useQuery({ queryKey: ["board", board.id], queryFn: () => api.boards.get(board.id) });
  const teamId = full.data?.teamId;
  const folders = useFolders(teamId ?? "", teamId != null);
  const move = useMoveBoard();
  const trash = useTrashBoard();

  const currentFolderId = full.data?.folderId ?? null;
  const busy = move.isPending || trash.isPending;

  const doMove = (folderId: string | null): void => {
    move.mutate({ id: board.id, folderId }, { onSuccess: onClose });
  };

  return (
    <>
      {/* پس‌زمینه‌ی نامرئی: کلیک بیرون منو را می‌بندد. */}
      <button type="button" className="menu-backdrop" aria-label="بستنِ منو" onClick={onClose} />
      <div className="card-menu" role="menu">
        <p className="card-menu__label">انتقال به فولدر</p>
        {full.isPending ? (
          <p className="card-menu__hint">در حال بارگذاری…</p>
        ) : full.isError ? (
          <p className="card-menu__hint field-error">در دسترس نیست</p>
        ) : (
          <ul className="card-menu__list">
            <li>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={currentFolderId === null}
                className={
                  currentFolderId === null ? "card-menu__item card-menu__item--on" : "card-menu__item"
                }
                disabled={busy}
                onClick={() => doMove(null)}
              >
                خارج از فولدر
              </button>
            </li>
            {(folders.data ?? []).map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={currentFolderId === f.id}
                  className={
                    currentFolderId === f.id ? "card-menu__item card-menu__item--on" : "card-menu__item"
                  }
                  disabled={busy}
                  onClick={() => doMove(f.id)}
                >
                  📁 {f.name}
                </button>
              </li>
            ))}
            {teamId != null && (folders.data?.length ?? 0) === 0 && (
              <li>
                <p className="card-menu__hint">فولدری در این تیم نیست</p>
              </li>
            )}
          </ul>
        )}

        {board.myRole === "owner" && (
          <>
            <div className="card-menu__divider" />
            <button
              type="button"
              role="menuitem"
              className="card-menu__item card-menu__item--danger"
              disabled={busy}
              onClick={() => trash.mutate(board.id, { onSuccess: onClose })}
            >
              🗑 انتقال به سطلِ بازیافت
            </button>
          </>
        )}
      </div>
    </>
  );
}
