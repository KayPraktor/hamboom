import { formatJalaliShort } from "@hamboom/i18n";
import type { BoardSummary } from "@hamboom/shared-types";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { errorMessage } from "../api/error-message.ts";
import { useSession } from "../auth/session-context.ts";
import type { BoardsFilter } from "./boards-queries.ts";
import { useBoards, useCreateBoard, useToggleFavorite } from "./boards-queries.ts";

/**
 * داشبورد — فهرستِ بوردهای کاربر (روی همه‌ی تیم‌ها)، ساخت، جستجو، و نشان‌کردن.
 * فولدر/سطلِ بازیافت/اعضا در گام‌های بعدیِ ۸٫۳ می‌آیند.
 */
export function DashboardPage() {
  const [q, setQ] = useState("");
  const [favOnly, setFavOnly] = useState(false);

  const filter: BoardsFilter = {
    ...(q.trim().length > 0 ? { q: q.trim() } : {}),
    ...(favOnly ? { favorite: true } : {}),
  };

  const { teams } = useSession();
  const boards = useBoards(filter);
  const createBoard = useCreateBoard();
  const toggleFavorite = useToggleFavorite();

  return (
    <div className="dashboard">
      {teams.length > 0 && (
        <nav className="teams-strip" aria-label="تیم‌ها">
          <span className="teams-strip__label">تیم‌ها:</span>
          {teams.map((team) => (
            <Link
              key={team.id}
              to="/team/$teamId"
              params={{ teamId: team.id }}
              className="chip"
            >
              {team.name}
            </Link>
          ))}
        </nav>
      )}
      <div className="dashboard__bar">
        <h1>بوردهای من</h1>
        <div className="dashboard__actions">
          <input
            className="input"
            type="search"
            placeholder="جستجوی بورد…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="جستجوی بورد"
          />
          <button
            type="button"
            className={favOnly ? "chip chip--on" : "chip"}
            aria-pressed={favOnly}
            onClick={() => setFavOnly((v) => !v)}
          >
            ★ نشان‌شده‌ها
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={createBoard.isPending}
            onClick={() => createBoard.mutate(undefined)}
          >
            {createBoard.isPending ? "در حال ساخت…" : "بوردِ جدید"}
          </button>
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
        <EmptyState favOnly={favOnly} searching={q.trim().length > 0} />
      ) : (
        <ul className="board-grid">
          {boards.data.map((board) => (
            <BoardCard
              key={board.id}
              board={board}
              busy={toggleFavorite.isPending}
              onToggleFavorite={() =>
                toggleFavorite.mutate({ id: board.id, isFavorite: board.isFavorite })
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function BoardCard({
  board,
  busy,
  onToggleFavorite,
}: {
  board: BoardSummary;
  busy: boolean;
  onToggleFavorite: () => void;
}) {
  return (
    <li className="board-card">
      {/* بازکردنِ بورد کارِ ۸٫۴ است؛ فعلاً فقط اطلاعات. */}
      <div className="board-card__thumb" aria-hidden="true">
        {board.title.trim().slice(0, 1) || "ب"}
      </div>
      <div className="board-card__body">
        <span className="board-card__title">{board.title || "بدونِ عنوان"}</span>
        <span className="board-card__meta">
          آخرین فعالیت: {formatJalaliShort(new Date(board.lastActivityAt))}
        </span>
      </div>
      <button
        type="button"
        className={board.isFavorite ? "star star--on" : "star"}
        disabled={busy}
        aria-label={board.isFavorite ? "برداشتن نشان" : "نشان‌کردن"}
        aria-pressed={board.isFavorite}
        onClick={onToggleFavorite}
      >
        {board.isFavorite ? "★" : "☆"}
      </button>
    </li>
  );
}

function EmptyState({ favOnly, searching }: { favOnly: boolean; searching: boolean }) {
  const message = searching
    ? "بوردی با این جستجو پیدا نشد."
    : favOnly
      ? "هنوز بوردی را نشان نکرده‌اید."
      : "هنوز بوردی نساخته‌اید. با «بوردِ جدید» شروع کنید.";
  return <div className="empty-state">{message}</div>;
}
