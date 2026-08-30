import type { TeamRole } from "@hamboom/shared-types";

/** نقشِ قابلِ‌تخصیص در تیم — نه `owner` (مالک با انتقالِ مالکیت عوض می‌شود، نه اینجا). */
export type AssignableTeamRole = "admin" | "member" | "guest";

export const ASSIGNABLE_TEAM_ROLES: readonly AssignableTeamRole[] = ["admin", "member", "guest"];

export const TEAM_ROLE_FA: Record<TeamRole, string> = {
  owner: "مالک",
  admin: "مدیر",
  member: "عضو",
  guest: "مهمان",
};
