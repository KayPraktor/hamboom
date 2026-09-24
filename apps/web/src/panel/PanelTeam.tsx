import type { AdminTeamDetail } from "@hamboom/shared-types";
import { Link, useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { errorMessage } from "../api/error-message.ts";
import { PanelTable, type PanelColumn } from "./PanelTable.tsx";
import { useAdminTeam } from "./panel-queries.ts";
import { STATUS_FA } from "./status-fa.ts";

/**
 * صفحه‌ی یک تیم — `/panel/teams/$teamId` — M6 فاز ۵٫۱. فقط‌خواندنی.
 *
 * سقف و مصرف همان ستون‌های گیتِ ظرفیت‌اند (`TEAM_BILLING_COLUMNS`، ADR-053) — پنل همان عددی را می‌بیند
 * که کاربر با آن بلوکه می‌شود، نه یک کشِ نمایش. `-1` = نامحدود.
 */

const fmtTime = (iso: string | null): string =>
  iso === null
    ? "—"
    : new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(iso),
      );
const limit = (n: number): string => (n === -1 ? "نامحدود" : String(n));
const mb = (bytes: number): string => `${(bytes / 1_048_576).toFixed(1)} MB`;

interface InfoRow {
  key: string;
  label: string;
  value: ReactNode;
}
const INFO_COLUMNS: readonly PanelColumn<InfoRow>[] = [
  { key: "label", header: "چه", render: (r) => r.label },
  { key: "value", header: "مقدار", render: (r) => r.value },
];

const MEMBER_COLUMNS: readonly PanelColumn<AdminTeamDetail["members"][number]>[] = [
  {
    key: "name",
    header: "عضو",
    render: (m) => (
      <Link to="/panel/users/$userId" params={{ userId: m.userId }}>
        {m.displayName}
      </Link>
    ),
  },
  { key: "role", header: "نقش", render: (m) => m.role, ltr: true },
  { key: "status", header: "وضعیت", render: (m) => STATUS_FA[m.status] },
  { key: "joined", header: "عضویت", render: (m) => fmtTime(m.joinedAt) },
];

export function PanelTeam() {
  const { teamId } = useParams({ from: "/panel/teams/$teamId" });
  const team = useAdminTeam(teamId);

  if (team.isPending) return <div className="loader">در حال بارگذاری…</div>;
  if (team.isError) {
    return (
      <p className="field-error" role="alert">
        {errorMessage(team.error)}
      </p>
    );
  }
  const t = team.data;
  const s = t.subscription;

  const rows: InfoRow[] = [
    { key: "id", label: "شناسه", value: <span className="panel-table__ltr">{t.id}</span> },
    { key: "slug", label: "slug", value: <span className="panel-table__ltr">{t.slug}</span> },
    { key: "kind", label: "نوع", value: t.isPersonal ? "فضای شخصی" : "تیم" },
    {
      key: "owner",
      label: "مالک",
      value: (
        <Link to="/panel/users/$userId" params={{ userId: t.ownerUserId }}>
          <span className="panel-table__ltr">{t.ownerUserId.slice(0, 8)}</span>
        </Link>
      ),
    },
    {
      key: "plan",
      label: "پلن / اشتراک",
      value: <span className="panel-table__ltr">{`${t.planCode} / ${t.subscriptionStatus}`}</span>,
    },
    {
      key: "sub",
      label: "دوره‌ی اشتراک",
      value:
        s === null
          ? "—"
          : `${s.period} · ${fmtTime(s.currentPeriodStart)} → ${fmtTime(s.currentPeriodEnd)}${s.cancelAtPeriodEnd ? " · لغو در پایانِ دوره" : ""}`,
    },
    {
      key: "members",
      label: "اعضا",
      value: `${String(t.usage.members)} از ${limit(t.limits.maxMembers)}`,
    },
    {
      key: "boards",
      label: "بوردها",
      value: `${String(t.usage.boards)} از ${limit(t.limits.maxBoards)}`,
    },
    {
      key: "storage",
      label: "فضا",
      value: `${mb(t.usage.storageBytes)} از ${t.limits.maxStorageBytes === -1 ? "نامحدود" : mb(t.limits.maxStorageBytes)}`,
    },
    { key: "created", label: "ساخت", value: fmtTime(t.createdAt) },
  ];

  return (
    <>
      <div className="dashboard__bar">
        <h1>{t.isPersonal ? "فضای شخصی" : t.name}</h1>
        <Link to="/panel/users" className="btn btn--ghost btn--sm">
          ← جست‌وجو
        </Link>
      </div>
      <PanelTable columns={INFO_COLUMNS} rows={rows} rowKey={(r) => r.key} caption="تیم" />
      <PanelTable
        columns={MEMBER_COLUMNS}
        rows={t.members}
        rowKey={(m) => m.userId}
        caption={`اعضا — ${String(t.members.length)}`}
        empty="عضوی ندارد."
      />
    </>
  );
}
