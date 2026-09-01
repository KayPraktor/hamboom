import type { Team } from "@hamboom/shared-types";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";

import { useSession } from "../auth/session-context.ts";
import { useCreateFolder, useDeleteFolder, useFolders, useRenameFolder } from "./folders-queries.ts";
import type { Selection } from "./selection.ts";

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
        <NavItem active={selection.kind === "all"} onClick={() => onSelect({ kind: "all" })}>
          همه‌ی بوردها
        </NavItem>
        <NavItem
          active={selection.kind === "favorites"}
          onClick={() => onSelect({ kind: "favorites" })}
        >
          ★ نشان‌شده‌ها
        </NavItem>
        <NavItem active={selection.kind === "trash"} onClick={() => onSelect({ kind: "trash" })}>
          🗑 سطلِ بازیافت
        </NavItem>
      </nav>
      {teams.map((team) => (
        <TeamFolders key={team.id} team={team} selection={selection} onSelect={onSelect} />
      ))}
    </aside>
  );
}

function NavItem({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={active ? "nav-item nav-item--on" : "nav-item"}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      {children}
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
                  📁 {f.name}
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
