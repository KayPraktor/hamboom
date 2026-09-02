import type { Team } from "@hamboom/shared-types";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";

import { useSession } from "../auth/session-context.ts";
import { useCreateFolder, useDeleteFolder, useFolders, useRenameFolder } from "./folders-queries.ts";
import type { Selection } from "./selection.ts";

/**
 * آیکون‌های خطیِ سایدبار — تک‌رنگ (`currentColor`، پس با حالتِ فعال/هاور هم‌رنگ می‌شوند)،
 * به‌جای ایموجیِ درون‌متن تا در یک ستون تراز شوند (نظمِ سبکِ میرو). فقط تزئینی (`aria-hidden`).
 */
const IconBoards = (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);
const IconStar = (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3.5l2.5 5.2 5.7.5-4.3 3.8 1.3 5.6L12 15.9 6.8 18.6l1.3-5.6-4.3-3.8 5.7-.5z" />
  </svg>
);
const IconTrash = (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 12.5h9L17.5 7" />
  </svg>
);
const IconFolder = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
    <path d="M3.5 7a2 2 0 012-2H9l2 2h7.5a2 2 0 012 2v7.5a2 2 0 01-2 2h-13a2 2 0 01-2-2z" />
  </svg>
);

/**
 * ریلِ پیمایشِ داشبورد — دسته‌های سراسری (همه/نشان‌شده/سطل) + فولدرهای **هر تیم**.
 * فولدرها per-team اند، پس برای هر تیمِ کاربر یک `TeamFolders` (که hookِ فولدرِ خودش را دارد —
 * hook در حلقه ممنوع است، پس فرزندِ جدا).
 */
export function FolderNav({
  selection,
  onSelect,
}: {
  selection: Selection;
  onSelect: (s: Selection) => void;
}) {
  const { teams } = useSession();
  return (
    <aside className="folder-nav" aria-label="پیمایشِ بوردها">
      <nav className="folder-nav__group">
        <NavItem icon={IconBoards} active={selection.kind === "all"} onClick={() => onSelect({ kind: "all" })}>
          همه‌ی بوردها
        </NavItem>
        <NavItem
          icon={IconStar}
          active={selection.kind === "favorites"}
          onClick={() => onSelect({ kind: "favorites" })}
        >
          نشان‌شده‌ها
        </NavItem>
        <NavItem icon={IconTrash} active={selection.kind === "trash"} onClick={() => onSelect({ kind: "trash" })}>
          سطلِ بازیافت
        </NavItem>
      </nav>
      {teams.length > 0 && (
        <div className="folder-nav__section">
          <p className="folder-nav__section-label">فضاها</p>
          {teams.map((team) => (
            <TeamFolders key={team.id} team={team} selection={selection} onSelect={onSelect} />
          ))}
        </div>
      )}
    </aside>
  );
}

function NavItem({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={active ? "nav-item nav-item--on" : "nav-item"}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      {icon && (
        <span className="nav-item__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="nav-item__label">{children}</span>
    </button>
  );
}

function TeamFolders({
  team,
  selection,
  onSelect,
}: {
  team: Team;
  selection: Selection;
  onSelect: (s: Selection) => void;
}) {
  const folders = useFolders(team.id);
  const createFolder = useCreateFolder(team.id);
  const renameFolder = useRenameFolder(team.id);
  const deleteFolder = useDeleteFolder(team.id);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const submitNew = (): void => {
    const name = newName.trim();
    if (name.length === 0) return;
    createFolder.mutate(name, {
      onSuccess: () => {
        setNewName("");
        setAdding(false);
      },
    });
  };

  const submitRename = (id: string): void => {
    const name = editName.trim();
    if (name.length === 0) {
      setEditingId(null);
      return;
    }
    renameFolder.mutate({ id, name }, { onSuccess: () => setEditingId(null) });
  };

  const remove = (id: string, name: string): void => {
    if (!window.confirm(`فولدرِ «${name}» حذف شود؟ بوردهای داخلش پاک نمی‌شوند و به «همه‌ی بوردها» می‌روند.`)) {
      return;
    }
    deleteFolder.mutate(id, {
      onSuccess: () => {
        if (selection.kind === "folder" && selection.folderId === id) onSelect({ kind: "all" });
      },
    });
  };

  return (
    <div className="folder-nav__team">
      <div className="folder-nav__team-head">
        <Link to="/team/$teamId" params={{ teamId: team.id }} className="folder-nav__team-name">
          {team.name}
        </Link>
        <button
          type="button"
          className="folder-nav__add"
          aria-label={`فولدرِ نو در ${team.name}`}
          onClick={() => setAdding((v) => !v)}
        >
          +
        </button>
      </div>

      {adding && (
        <form
          className="folder-nav__new"
          onSubmit={(e) => {
            e.preventDefault();
            submitNew();
          }}
        >
          <input
            className="input input--sm"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="نامِ فولدر"
            aria-label="نامِ فولدرِ نو"
            autoFocus
          />
          <button
            type="submit"
            className="folder-nav__new-ok"
            aria-label="افزودنِ فولدر"
            disabled={createFolder.isPending || newName.trim().length === 0}
          >
            ✓
          </button>
        </form>
      )}

      {folders.data && folders.data.length > 0 && (
        <ul className="folder-nav__folders">
          {folders.data.map((f) =>
            editingId === f.id ? (
              <li key={f.id} className="folder-nav__folder">
                <form
                  className="folder-nav__new"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitRename(f.id);
                  }}
                >
                  <input
                    className="input input--sm"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => submitRename(f.id)}
                    aria-label="نامِ فولدر"
                    autoFocus
                  />
                </form>
              </li>
            ) : (
              <li key={f.id} className="folder-nav__folder">
                <button
                  type="button"
                  className={
                    selection.kind === "folder" && selection.folderId === f.id
                      ? "nav-item nav-item--on folder-nav__folder-btn"
                      : "nav-item folder-nav__folder-btn"
                  }
                  onClick={() =>
                    onSelect({
                      kind: "folder",
                      folderId: f.id,
                      folderName: f.name,
                      teamId: team.id,
                    })
                  }
                >
                  <span className="nav-item__icon" aria-hidden="true">
                    {IconFolder}
                  </span>
                  <span className="nav-item__label">{f.name}</span>
                </button>
                <span className="folder-nav__folder-actions">
                  <button
                    type="button"
                    aria-label={`تغییرِ نامِ ${f.name}`}
                    onClick={() => {
                      setEditingId(f.id);
                      setEditName(f.name);
                    }}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    aria-label={`حذفِ ${f.name}`}
                    onClick={() => remove(f.id, f.name)}
                  >
                    🗑
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
