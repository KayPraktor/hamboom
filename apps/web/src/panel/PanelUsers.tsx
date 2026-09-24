import type { AdminTeamSummary, AdminUserSummary } from "@hamboom/shared-types";
import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { errorMessage } from "../api/error-message.ts";
import { PanelTable, type PanelColumn } from "./PanelTable.tsx";
import { useAdminSearch } from "./panel-queries.ts";
import { STATUS_FA } from "./status-fa.ts";

/**
 * کاربران و تیم‌ها — جست‌وجو (`/panel/users?q=`) — M6 فاز ۵٫۱
 * ([ADR-066](../../../../ARCHITECTURE_DECISIONS.md#adr-066)).
 *
 * یک ورودی، سه معنا (سرور تشخیص می‌دهد): شماره‌ی **کاملِ** «۰۹…» (ارقامِ فارسی هم)، UUID، یا متن
 * (نام/نامِ تیم/slug). شماره‌ها **ماسک** می‌آیند؛ نمایشِ کامل فقط در صفحه‌ی کاربر و ممیزی‌شده.
 * ★ عبارت **در URL نیست** و درخواست POST است (یافته‌ی ۵٫۵): شماره‌ی یک شخص نباید در تاریخچه‌ی مرورگر، لاگِ
 * nginx/api یا لینکِ اشتراکی بنشیند. هر جست‌وجو یک ردیفِ `user.search` (بدونِ عبارت). فرم دکمه‌ی submitِ صریح دارد (درسِ ۸٫۳).
 */

const USER_COLUMNS: readonly PanelColumn<AdminUserSummary>[] = [
  {
    key: "name",
    header: "نام",
    render: (u) => (
      <Link to="/panel/users/$userId" params={{ userId: u.id }}>
        {u.displayName}
      </Link>
    ),
  },
  { key: "phone", header: "شماره", render: (u) => u.phoneMasked ?? "—", ltr: true },
  { key: "status", header: "وضعیت", render: (u) => STATUS_FA[u.status] },
  { key: "staff", header: "staff", render: (u) => (u.isStaff ? "✓" : "") },
  { key: "id", header: "شناسه", render: (u) => u.id.slice(0, 8), ltr: true },
];

const TEAM_COLUMNS: readonly PanelColumn<AdminTeamSummary>[] = [
  {
    key: "name",
    header: "تیم",
    render: (t) => (
      <Link to="/panel/teams/$teamId" params={{ teamId: t.id }}>
        {t.name}
      </Link>
    ),
  },
  { key: "slug", header: "slug", render: (t) => t.slug, ltr: true },
  { key: "members", header: "اعضا", render: (t) => String(t.memberCount) },
  { key: "boards", header: "بوردها", render: (t) => String(t.boardCount) },
  {
    key: "plan",
    header: "پلن",
    render: (t) => `${t.planCode} / ${t.subscriptionStatus}`,
    ltr: true,
  },
];

export function PanelUsers() {
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const result = useAdminSearch(q);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    setQ(input.trim());
  };

  return (
    <>
      <div className="dashboard__bar">
        <h1>کاربران و تیم‌ها</h1>
        <form className="dashboard__actions" onSubmit={submit}>
          <input
            className="input"
            type="search"
            placeholder="شماره‌ی کاملِ ۰۹…، شناسه، یا نام"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-label="جست‌وجو"
          />
          <button type="submit" className="btn btn--ghost btn--sm">
            جست‌وجو
          </button>
        </form>
      </div>

      {q.trim().length === 0 ? (
        <p className="field-hint">شماره، شناسه یا نام را وارد کن.</p>
      ) : result.isPending ? (
        <div className="loader">در حال جست‌وجو…</div>
      ) : result.isError ? (
        <p className="field-error" role="alert">
          {errorMessage(result.error)}
        </p>
      ) : (
        <>
          <PanelTable
            columns={USER_COLUMNS}
            rows={result.data.users}
            rowKey={(u) => u.id}
            caption={`کاربران — ${String(result.data.users.length)}`}
            empty="کاربری پیدا نشد."
          />
          <PanelTable
            columns={TEAM_COLUMNS}
            rows={result.data.teams}
            rowKey={(t) => t.id}
            caption={`تیم‌ها — ${String(result.data.teams.length)}`}
            empty="تیمی پیدا نشد."
          />
        </>
      )}
    </>
  );
}
