/**
 * قراردادِ DTOهای API — [PLAN §۵٫۱](../../../../PLAN.md)، گام ۲٫۲ی M3.
 *
 * نسخه‌ی **مصرف‌کننده‌دارِ** M3: `User`/`Team`/`Board` + enumها + قالبِ خطا + صفحه‌بندی.
 * `Template`/`Comment`/`Plan`/`Subscription`/`Invoice` و فیلدهای مالیِ `Team` عمداً نیستند
 * (فاز ۱۰/M4) — طبق اصلِ «چیزی بدونِ مصرف‌کننده اضافه نکن».
 */

export {
  boardRoles,
  boardRole,
  assignableBoardRoles,
  assignableBoardRole,
  teamRoles,
  teamRole,
  boardAccessModes,
  boardAccessMode,
} from "./roles.ts";
export type { BoardRole, AssignableBoardRole, TeamRole, BoardAccessMode } from "./roles.ts";

export { isoDateTime, uuid, locale, pageQuery, paginated } from "./primitives.ts";
export type { IsoDateTime, Uuid, Locale, PageQuery } from "./primitives.ts";

export { userPublic, user } from "./user.ts";
export type { UserPublic, User } from "./user.ts";

export { teamMember, team } from "./team.ts";
export type { TeamMember, Team } from "./team.ts";

export { board, boardSummary, boardMember } from "./board.ts";
export type { Board, BoardSummary, BoardMember } from "./board.ts";

export { apiErrorCodes, apiErrorCode, apiError } from "./error.ts";
export type { ApiErrorCode, ApiError } from "./error.ts";

export { rtTokenClaims } from "./rt-token.ts";
export type { RtTokenClaims } from "./rt-token.ts";
