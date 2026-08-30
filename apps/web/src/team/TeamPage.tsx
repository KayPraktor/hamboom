import { formatJalaliShort } from "@hamboom/i18n";
import type { TeamMember } from "@hamboom/shared-types";
import { Link, useParams } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { errorMessage } from "../api/error-message.ts";
import { useSession } from "../auth/session-context.ts";
import { normalizePhone } from "../auth/validate.ts";
import {
  ASSIGNABLE_TEAM_ROLES,
  TEAM_ROLE_FA,
  type AssignableTeamRole,
} from "./role-labels.ts";
import {
  useCreateInvite,
  useMembers,
  useRemoveMember,
  useSetMemberRole,
  useTeam,
} from "./team-queries.ts";

/**
 * صفحه‌ی تیم — اعضا، تغییرِ نقش، حذف، و دعوت. مدیریت فقط برای owner/admin دیده
 * می‌شود؛ **گیتِ واقعی سرور است** (این‌ها راحتیِ UI اند).
 */
export function TeamPage() {
  const { teamId } = useParams({ from: "/team/$teamId" });
  const { user } = useSession();
  const team = useTeam(teamId);
  const members = useMembers(teamId);

  if (team.isPending || members.isPending) {
    return <div className="loader">در حال بارگذاری…</div>;
  }
  if (team.isError) {
    return (
      <p className="field-error" role="alert">
        {errorMessage(team.error)}
      </p>
    );
  }

  const canManage = team.data.myRole === "owner" || team.data.myRole === "admin";

  return (
    <div className="team-page">
      <div className="dashboard__bar">
        <div>
          <Link to="/dashboard" className="back-link">
            ← داشبورد
          </Link>
          <h1>{team.data.name}</h1>
        </div>
      </div>

      {canManage && <InviteForm teamId={teamId} />}

      <section className="members">
        <h2>اعضا</h2>
        {members.isError ? (
          <p className="field-error" role="alert">
            {errorMessage(members.error)}
          </p>
        ) : (
          <ul className="member-list">
            {members.data.map((member) => (
              <MemberRow
                key={member.user.id}
                teamId={teamId}
                member={member}
                canManage={canManage}
                isSelf={member.user.id === user?.id}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MemberRow({
  teamId,
  member,
  canManage,
  isSelf,
}: {
  teamId: string;
  member: TeamMember;
  canManage: boolean;
  isSelf: boolean;
}) {
  const setRole = useSetMemberRole(teamId);
  const removeMember = useRemoveMember(teamId);

  // مالک و خودِ کاربر ویرایش نمی‌شوند؛ owner نقشِ قابلِ‌تخصیص هم نیست.
  const editable = canManage && !isSelf && member.role !== "owner";

  return (
    <li className="member-row">
      <div className="member-row__id">
        <span className="member-row__name">{member.user.displayName}</span>
        <span className="board-card__meta">عضویت: {formatJalaliShort(new Date(member.joinedAt))}</span>
      </div>
      {editable ? (
        <div className="member-row__controls">
          <select
            className="input select"
            aria-label={`نقشِ ${member.user.displayName}`}
            value={member.role === "owner" ? "admin" : member.role}
            disabled={setRole.isPending}
            onChange={(e) =>
              setRole.mutate({ userId: member.user.id, role: e.target.value as AssignableTeamRole })
            }
          >
            {ASSIGNABLE_TEAM_ROLES.map((role) => (
              <option key={role} value={role}>
                {TEAM_ROLE_FA[role]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={removeMember.isPending}
            onClick={() => removeMember.mutate(member.user.id)}
          >
            حذف
          </button>
        </div>
      ) : (
        <span className={member.role === "owner" ? "role-badge role-badge--owner" : "role-badge"}>
          {TEAM_ROLE_FA[member.role]}
          {isSelf && " (شما)"}
        </span>
      )}
    </li>
  );
}

function InviteForm({ teamId }: { teamId: string }) {
  const createInvite = useCreateInvite(teamId);
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<AssignableTeamRole>("member");
  const [error, setError] = useState<string | null>(null);

  function submit(ev: FormEvent): void {
    ev.preventDefault();
    setError(null);
    const normalized = normalizePhone(phone);
    if (normalized === null) {
      setError("شماره‌ی موبایل باید ۱۱ رقم و با ۰۹ آغاز شود.");
      return;
    }
    createInvite.mutate(
      { phone: normalized, role },
      {
        onSuccess: () => setPhone(""),
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <section className="invite">
      <h2>دعوتِ عضو</h2>
      <form className="invite__form" onSubmit={submit} noValidate>
        <input
          className="input"
          inputMode="numeric"
          placeholder="۰۹۱۲۳۴۵۶۷۸۹"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={createInvite.isPending}
          aria-label="شماره‌ی موبایلِ دعوت‌شونده"
        />
        <select
          className="input select"
          value={role}
          disabled={createInvite.isPending}
          onChange={(e) => setRole(e.target.value as AssignableTeamRole)}
          aria-label="نقش"
        >
          {ASSIGNABLE_TEAM_ROLES.map((r) => (
            <option key={r} value={r}>
              {TEAM_ROLE_FA[r]}
            </option>
          ))}
        </select>
        <button className="btn btn--primary" type="submit" disabled={createInvite.isPending}>
          {createInvite.isPending ? "…" : "دعوت"}
        </button>
      </form>
      {error !== null && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {createInvite.data?.token !== undefined && (
        <p className="invite__link">
          لینکِ دعوت (فقط dev): <code>/invite/{createInvite.data.token}</code>
        </p>
      )}
    </section>
  );
}
