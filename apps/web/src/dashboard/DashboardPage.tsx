import { formatJalaliShort } from "@hamboom/i18n";
import type { BoardSummary } from "@hamboom/shared-types";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { errorMessage } from "../api/error-message.ts";
import { BoardCardMenu } from "./BoardCardMenu.tsx";
import type { BoardsFilter } from "./boards-queries.ts";
import { useBoards, useCreateBoard, useRestoreBoard, useToggleFavorite } from "./boards-queries.ts";
import { FolderNav } from "./FolderNav.tsx";
import {
  filterForSelection,
  headingForSelection,
  isTrashView,
  type Selection,
} from "./selection.ts";

/**
 * داشبورد — ریلِ پیمایش (همه/نشان‌شده/سطل + فولدرهای هر تیم) کنارِ فهرستِ بورد.
 * انتخاب → فیلترِ `GET /boards`؛ نمای سطل کارت‌ها را «بازیابی» می‌کند، بقیه منوی جابه‌جایی/حذف دارند.
 */
export function DashboardPage() {
  const [selection, setSelection] = useState<Selection>({ kind: "all" });
  const [q, setQ] = useState("");

  const trash = isTrashView(selection);
  const filter: BoardsFilter = {
    ...filterForSelection(selection),
    ...(q.trim().length > 0 ? { q: q.trim() } : {}),
  };

  const boards = useBoards(filter);
  const createBoard = useCreateBoard();

  return (
    <div className="dashboard-layout">
      <FolderNav selection={selection} onSelect={setSelection} />

      <div className="dashboard">
        <div className="dashboard__bar">
          <h1>{headingForSelection(selection)}</h1>
          <div className="dashboard__actions">
            <input
              className="input"
              type="search"
              placeholder="جستجوی بورد…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="جستجوی بورد"
            />
            {!trash && (
              <button
                type="button"
                className="btn btn--primary"
                disabled={createBoard.isPending}
                onClick={() =>
                  createBoard.mutate(undefined, { onSuccess: () => setSelection({ kind: "all" }) })
                }
              >
                {createBoard.isPending ? "در حال ساخت…" : "بوردِ جدید"}
              </button>
            )}
          </div>
        </div>

        {createBoard.isError && (
          <p className="field-error" role="alert">
            {errorMessage(createBoard.error)}
          </p>
        )}

        {boards.isPending ? (
          <div className="loader">در حال بارگذاری…</div>
        ) : boards.isError ? (
          <p className="field-error" role="alert">
            {errorMessage(boards.error)}
          </p>
        ) : boards.data.length === 0 ? (
          <EmptyState selection={selection} searching={q.trim().length > 0} />
        ) : (
          <ul className="board-grid">
            {boards.data.map((board) =>
              trash ? (
                <TrashCard key={board.id} board={board} />
              ) : (
                <BoardCard key={board.id} board={board} />
              ),
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function BoardCard({ board }: { board: BoardSummary }) {
  const toggleFavorite = useToggleFavorite();
  const [menuOpen, setMenuOpen] = useState(false);
  // فقط editor+ می‌تواند جابه‌جا/حذف کند — برای viewer/commenter منو خالی است، پس دکمه هم نه.
  const canManage = board.myRole === "owner" || board.myRole === "editor";

  return (
    <li className="board-card">
      <Link to="/b/$boardId" params={{ boardId: board.id }} className="board-card__open">
        <div className="board-card__thumb" aria-hidden="true">
          {board.title.trim().slice(0, 1) || "ب"}
        </div>
        <div className="board-card__body">
          <span className="board-card__title">{board.title || "بدونِ عنوان"}</span>
          <span className="board-card__meta">
            آخرین فعالیت: {formatJalaliShort(new Date(board.lastActivityAt))}
          </span>
        </div>
      </Link>
      <button
        type="button"
        className={board.isFavorite ? "star star--on" : "star"}
        disabled={toggleFavorite.isPending}
        aria-label={board.isFavorite ? "برداشتن نشان" : "نشان‌کردن"}
        aria-pressed={board.isFavorite}
        onClick={() => toggleFavorite.mutate({ id: board.id, isFavorite: board.isFavorite })}
      >
        {board.isFavorite ? "★" : "☆"}
      </button>
      {canManage && (
        <div className="board-card__menu-wrap">
          <button
            type="button"
            className="board-card__menu-btn"
            aria-label="گزینه‌های بورد"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            ⋯
          </button>
          {menuOpen && <BoardCardMenu board={board} onClose={() => setMenuOpen(false)} />}
        </div>
      )}
    </li>
  );
}

function TrashCard({ board }: { board: BoardSummary }) {
  const restore = useRestoreBoard();
  return (
    <li className="board-card board-card--trashed">
      <div className="board-card__thumb board-card__thumb--muted" aria-hidden="true">
        {board.title.trim().slice(0, 1) || "ب"}
      </div>
      <div className="board-card__body">
        <span className="board-card__title">{board.title || "بدونِ عنوان"}</span>
        <span className="board-card__meta">حذف‌شده</span>
      </div>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        disabled={restore.isPending}
        onClick={() => restore.mutate(board.id)}
      >
        {restore.isPending ? "…" : "بازیابی"}
      </button>
    </li>
  );
}

function EmptyState({ selection, searching }: { selection: Selection; searching: boolean }) {
  if (searching) return <div className="empty-state">بوردی با این جستجو پیدا نشد.</div>;
  const message =
    selection.kind === "favorites"
      ? "هنوز بوردی را نشان نکرده‌اید."
      : selection.kind === "trash"
        ? "سطلِ بازیافت خالی است."
        : selection.kind === "folder"
          ? "این فولدر خالی است. با منوی «⋯» یک بورد را به این‌جا بیاورید."
          : "هنوز بوردی نساخته‌اید. با «بوردِ جدید» شروع کنید.";
  return <div className="empty-state">{message}</div>;
}
