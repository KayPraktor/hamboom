import type { AuditLogEntry } from "@hamboom/shared-types";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { api } from "../api/client.ts";
import { errorMessage } from "../api/error-message.ts";
import { PanelTable, type PanelColumn } from "./PanelTable.tsx";

/**
 * ممیزی — `/panel/audit` (M6 فاز ۴٫۳، [ADR-067](../../../../ARCHITECTURE_DECISIONS.md#adr-067)).
 *
 * ★ **اولین مصرف‌کننده‌ی صفحه‌بندیِ cursor در پنل:** `useInfiniteQuery` با `nextCursor`ِ سرور به‌عنوانِ
 * `pageParam` — دکمه‌ی «بیشتر» صفحه‌ی بعد را به انتها می‌چسبانَد؛ `null` یعنی پایان و دکمه می‌رود. هیچ
 * offset/شماره‌ی صفحه‌ای نیست (keyset)، پس درجِ هم‌زمانِ ردیفِ نو، صفحه‌ها را جابه‌جا نمی‌کند.
 *
 * فیلتر فقط «پیشوندِ عمل» (`staff.`، `user.suspend`) — کلیدِ کوئری با آن عوض می‌شود و صفحه‌ها از نو.
 * `ipMasked` همان‌طور که از سرور می‌آید نمایش داده می‌شود؛ این صفحه IPِ کامل را **نمی‌بیند** (§۳).
 */

const fmtTime = (iso: string): string =>
  new Intl.DateTimeFormat("fa-IR", { dateStyle: "short", timeStyle: "medium" }).format(
    new Date(iso),
  );

const short = (id: string | null): string => (id === null ? "—" : id.slice(0, 8));

const COLUMNS: readonly PanelColumn<AuditLogEntry>[] = [
  { key: "at", header: "زمان", render: (r) => fmtTime(r.createdAt) },
  { key: "action", header: "عمل", render: (r) => r.action, ltr: true },
  {
    key: "actor",
    header: "عامل",
    render: (r) => (r.actorUserId === null ? "سیستم" : short(r.actorUserId)),
    ltr: true,
  },
  {
    key: "target",
    header: "هدف",
    render: (r) => (r.targetType === null ? "—" : `${r.targetType}:${short(r.targetId)}`),
    ltr: true,
  },
  { key: "ip", header: "IP", render: (r) => r.ipMasked ?? "—", ltr: true },
];

const PAGE = 25;

export function PanelAudit() {
  const [actionInput, setActionInput] = useState("");
  const [action, setAction] = useState<string | undefined>(undefined);

  const q = useInfiniteQuery({
    queryKey: ["admin", "audit", { action }],
    queryFn: ({ pageParam }) =>
      api.admin.audit({
        limit: PAGE,
        ...(action !== undefined ? { action } : {}),
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const applyFilter = (e: FormEvent): void => {
    e.preventDefault();
    const v = actionInput.trim();
    setAction(v.length > 0 ? v : undefined);
  };

  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <div className="dashboard__bar">
        <h1>ممیزی</h1>
        <form className="dashboard__actions" onSubmit={applyFilter}>
          <input
            className="input"
            type="search"
            placeholder="پیشوندِ عمل، مثلاً staff."
            value={actionInput}
            onChange={(e) => setActionInput(e.target.value)}
            aria-label="فیلترِ عمل"
            dir="ltr"
          />
          <button type="submit" className="btn btn--ghost btn--sm">
            فیلتر
          </button>
        </form>
      </div>

      {q.isPending ? (
        <div className="loader">در حال بارگذاری…</div>
      ) : q.isError ? (
        <p className="field-error" role="alert">
          {errorMessage(q.error)}
        </p>
      ) : (
        <>
          <PanelTable
            columns={COLUMNS}
            rows={rows}
            rowKey={(r) => String(r.id)}
            caption={`${String(rows.length)} ردیف${q.hasNextPage ? " (ادامه دارد)" : ""}`}
            empty="ردیفی نیست."
          />
          {q.hasNextPage && (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={q.isFetchingNextPage}
              onClick={() => void q.fetchNextPage()}
            >
              {q.isFetchingNextPage ? "در حال بارگذاری…" : "بیشتر"}
            </button>
          )}
        </>
      )}
    </>
  );
}
