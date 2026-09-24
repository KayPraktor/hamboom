import type { AdminUserBoard, AdminUserDetail } from "@hamboom/shared-types";
import { Link, useParams } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";

import { errorMessage } from "../api/error-message.ts";
import { PanelTable, type PanelColumn } from "./PanelTable.tsx";
import {
  useAdminUser,
  useAdminUserBoards,
  useRevealPhone,
  useSuspend,
  useUnsuspend,
} from "./panel-queries.ts";
import { STATUS_FA } from "./status-fa.ts";
import { isStepUpRequired } from "./step-up.ts";
import { StepUpForm } from "./StepUpForm.tsx";

/**
 * صفحه‌ی یک کاربر — `/panel/users/$userId` — M6 فاز ۵ ([ADR-066](../../../../ARCHITECTURE_DECISIONS.md#adr-066)).
 *
 * ★ **تعلیق (۵٫۲) اولین عملِ مخربِ پنل است**، پس اولین مصرف‌کننده‌ی دو الگو: (۱) تاییدِ مخرب با
 * `window.confirm` (الگوی موجودِ اپ) + دلیلِ اجباری که در `metadata`ی audit می‌نشیند؛ (۲) **۴۲۸ در جا**:
 * اگر step-up کهنه باشد سرور `STEP_UP_REQUIRED` می‌دهد و همان فرمِ خانه این‌جا باز می‌شود؛ بعد از تایید،
 * عمل **دوباره** زده می‌شود (نه خودکار — staff دوباره تصمیم می‌گیرد).
 *
 * شماره ماسک است؛ «نمایشِ کامل» یک POSTِ ممیزی‌شده است (`user.phone.reveal`) و هر کلیک یک ردیف.
 * نمای پشتیبانی (۵٫۴): بوردهای کاربر با نقشِ **خودش**؛ «بازکردن» همان `/b/:id` است — staff با توکنِ
 * خودش و نقشِ viewer وارد می‌شود (سرور `support.board.view` می‌نویسد)، هیچ توکنی برای کاربر ساخته نمی‌شود.
 */

const fmtTime = (iso: string | null): string =>
  iso === null
    ? "—"
    : new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(iso),
      );

interface InfoRow {
  key: string;
  label: string;
  value: ReactNode;
}
const INFO_COLUMNS: readonly PanelColumn<InfoRow>[] = [
  { key: "label", header: "چه", render: (r) => r.label },
  { key: "value", header: "مقدار", render: (r) => r.value },
];

const TEAM_COLUMNS: readonly PanelColumn<AdminUserDetail["teams"][number]>[] = [
  {
    key: "name",
    header: "تیم",
    render: (t) => (
      <Link to="/panel/teams/$teamId" params={{ teamId: t.teamId }}>
        {t.isPersonal ? "فضای شخصی" : t.name}
      </Link>
    ),
  },
  { key: "role", header: "نقش", render: (t) => t.role, ltr: true },
  { key: "plan", header: "پلن", render: (t) => t.planCode, ltr: true },
  { key: "joined", header: "عضویت", render: (t) => fmtTime(t.joinedAt) },
];

const BOARD_COLUMNS: readonly PanelColumn<AdminUserBoard>[] = [
  { key: "title", header: "بورد", render: (b) => b.title },
  { key: "team", header: "تیم", render: (b) => b.teamName },
  { key: "role", header: "نقشِ کاربر", render: (b) => b.role, ltr: true },
  { key: "mode", header: "دسترسی", render: (b) => b.accessMode, ltr: true },
  { key: "at", header: "آخرین فعالیت", render: (b) => fmtTime(b.lastActivityAt) },
  {
    key: "open",
    header: "",
    render: (b) =>
      b.deletedAt === null ? (
        <Link to="/b/$boardId" params={{ boardId: b.id }} className="btn btn--ghost btn--sm">
          بازکردن (فقط‌خواندنی)
        </Link>
      ) : (
        <span className="field-hint">در سطل</span>
      ),
  },
];

export function PanelUser() {
  const { userId } = useParams({ from: "/panel/users/$userId" });
  const user = useAdminUser(userId);
  const boards = useAdminUserBoards(userId);
  const reveal = useRevealPhone(userId);
  const suspend = useSuspend(userId);
  const unsuspend = useUnsuspend(userId);
  const [reason, setReason] = useState("");

  if (user.isPending) return <div className="loader">در حال بارگذاری…</div>;
  if (user.isError) {
    return (
      <p className="field-error" role="alert">
        {errorMessage(user.error)}
      </p>
    );
  }
  const u = user.data;

  const doSuspend = (e: FormEvent): void => {
    e.preventDefault();
    const r = reason.trim();
    if (r.length < 3) return;
    if (
      !window.confirm(
        `«${u.displayName}» معلق شود؟ همه‌ی نشست‌هایش قطع می‌شود و نمی‌تواند وارد شود.`,
      )
    )
      return;
    suspend.mutate(r, { onSuccess: () => setReason("") });
  };
  const doUnsuspend = (): void => {
    if (!window.confirm(`تعلیقِ «${u.displayName}» برداشته شود؟ باید دوباره با پیامک وارد شود.`))
      return;
    unsuspend.mutate();
  };

  const actionError = suspend.error ?? unsuspend.error;
  const needsStepUp = isStepUpRequired(actionError);

  const rows: InfoRow[] = [
    { key: "id", label: "شناسه", value: <span className="panel-table__ltr">{u.id}</span> },
    {
      key: "phone",
      label: "شماره",
      value: (
        <span className="panel-table__ltr">
          {reveal.data?.phone ?? u.phoneMasked ?? "—"}
          {u.phoneMasked !== null && reveal.data === undefined && (
            <>
              {" "}
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={reveal.isPending}
                onClick={() => reveal.mutate()}
              >
                نمایشِ کامل
              </button>
            </>
          )}
        </span>
      ),
    },
    { key: "status", label: "وضعیت", value: STATUS_FA[u.status] },
    { key: "staff", label: "staff", value: u.isStaff ? "بله" : "خیر" },
    { key: "created", label: "ثبت‌نام", value: fmtTime(u.createdAt) },
    { key: "seen", label: "آخرین بازدید", value: fmtTime(u.lastSeenAt) },
    { key: "boards", label: "بوردهای ساخته‌شده", value: String(u.boardCount) },
    { key: "sessions", label: "نشست‌های زنده", value: String(u.activeSessions) },
  ];

  return (
    <>
      <div className="dashboard__bar">
        <h1>{u.displayName}</h1>
        <Link to="/panel/users" className="btn btn--ghost btn--sm">
          ← جست‌وجو
        </Link>
      </div>
      {reveal.isError && (
        <p className="field-error" role="alert">
          {errorMessage(reveal.error)}
        </p>
      )}
      <PanelTable columns={INFO_COLUMNS} rows={rows} rowKey={(r) => r.key} caption="کاربر" />

      <section className="card panel-stepup" aria-labelledby="suspend-title">
        <h2 id="suspend-title">{u.status === "suspended" ? "رفعِ تعلیق" : "تعلیق"}</h2>
        {u.isStaff ? (
          <p className="field-hint">
            حسابِ staff از پنل معلق نمی‌شود — اول با `admin-grant-staff --revoke` سلب کن.
          </p>
        ) : u.status === "suspended" ? (
          <button
            type="button"
            className="btn btn--primary"
            disabled={unsuspend.isPending}
            onClick={doUnsuspend}
          >
            {unsuspend.isPending ? "در حال اجرا…" : "برداشتنِ تعلیق"}
          </button>
        ) : (
          <form onSubmit={doSuspend} noValidate>
            <label className="field">
              <span>دلیل (در ممیزی ثبت می‌شود)</span>
              <input
                className="input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                minLength={3}
                maxLength={200}
                disabled={suspend.isPending}
              />
            </label>
            <button
              type="submit"
              className="btn btn--danger"
              disabled={suspend.isPending || reason.trim().length < 3}
            >
              {suspend.isPending ? "در حال اجرا…" : "تعلیقِ حساب"}
            </button>
          </form>
        )}
        {actionError !== null && !needsStepUp && (
          <p className="field-error" role="alert">
            {errorMessage(actionError)}
          </p>
        )}
        {needsStepUp && (
          <div className="panel-stepup__inline">
            <p className="field-hint" role="alert">
              این عمل تاییدِ دوباره می‌خواهد: کد بگیر، تایید کن، بعد دوباره بزن.
            </p>
            <StepUpForm
              onVerified={() => {
                suspend.reset();
                unsuspend.reset();
              }}
            />
          </div>
        )}
      </section>

      <PanelTable
        columns={TEAM_COLUMNS}
        rows={u.teams}
        rowKey={(t) => t.teamId}
        caption={`تیم‌ها — ${String(u.teams.length)}`}
        empty="عضوِ هیچ تیمی نیست."
      />

      {boards.isPending ? (
        <div className="loader">در حال بارگذاری…</div>
      ) : boards.isError ? (
        <p className="field-error" role="alert">
          {errorMessage(boards.error)}
        </p>
      ) : (
        <PanelTable
          columns={BOARD_COLUMNS}
          rows={boards.data.items}
          rowKey={(b) => b.id}
          caption={`بوردها (نمای پشتیبانی) — ${String(boards.data.items.length)}`}
          empty="بوردی ندارد."
        />
      )}
    </>
  );
}
