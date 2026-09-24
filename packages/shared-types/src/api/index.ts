/**
 * قراردادِ DTOهای API — [PLAN §۵٫۱](../../../../PLAN.md)، گام ۲٫۲ی M3 + فاز ۲ی M4.
 *
 * `User`/`Team`/`Board` + enumها + قالبِ خطا + صفحه‌بندی (M3)، و
 * `Plan`/`Subscription`/`Invoice` + primitiveِ `rial` (M4،
 * [ADR-054](../../../../ARCHITECTURE_DECISIONS.md#adr-054)).
 *
 * ⚠️ سه چیز عمداً هنوز نیستند: `Template`/`Comment` (فاز ۱۰ی M3، به تعویق) · `Coupon`
 * (M4-D2b) · و **فیلدهای مالیِ `Team`** — که مصرف‌کننده‌شان هست ولی **منبعِ داده‌شان نیست**
 * تا seedِ پلن‌ها در فاز ۴ی M4 بیاید؛ پس گام ۲٫۴ به فاز ۵ موکول شد.
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

export { isoDateTime, uuid, locale, rial, pageQuery, paginated } from "./primitives.ts";
export type { IsoDateTime, Uuid, Locale, Rial, PageQuery } from "./primitives.ts";

export { userPublic, user } from "./user.ts";
export type { UserPublic, User } from "./user.ts";

export { teamMember, team } from "./team.ts";
export type { TeamMember, Team } from "./team.ts";

export { board, boardSummary, boardMember } from "./board.ts";
export type { Board, BoardSummary, BoardMember } from "./board.ts";

export { folder } from "./folder.ts";
export type { Folder } from "./folder.ts";

export {
  subscriptionStatuses,
  subscriptionStatus,
  teamSubscriptionStatuses,
  teamSubscriptionStatus,
  billingPeriods,
  billingPeriod,
  invoiceStatuses,
  invoiceStatus,
  planLimit,
  planLimits,
  planUsage,
  plan,
  subscription,
  invoiceLineItem,
  invoice,
} from "./billing.ts";
export type {
  SubscriptionStatus,
  TeamSubscriptionStatus,
  BillingPeriod,
  InvoiceStatus,
  PlanLimit,
  PlanLimits,
  PlanUsage,
  Plan,
  Subscription,
  InvoiceLineItem,
  Invoice,
} from "./billing.ts";

export { apiErrorCodes, apiErrorCode, apiError } from "./error.ts";
export type { ApiErrorCode, ApiError } from "./error.ts";

// M6 (admin) — ADR-065/066/067؛ عمداً فقط آنچه فازِ جاری مصرف می‌کند (D12: هر فاز با تاییدِ مالک).
export {
  adminMe,
  stepUpVerifyRequest,
  auditLogEntry,
  auditLogQuery,
  userStatus,
  adminSearchQuery,
  adminUserSummary,
  adminTeamSummary,
  adminSearchResult,
  adminUserDetail,
  adminTeamDetail,
  phoneRevealResult,
  suspendRequest,
  adminUserBoard,
  // فاز ۶ — پرداخت‌ها و استرداد (ADR-068)
  paymentStatus,
  adminPaymentQuery,
  adminPaymentSummary,
  adminPaymentDetail,
  paymentActionResult,
  expireRequest,
  refundRequest,
  refundResult,
  reconcileRequest,
  reconcileReport,
} from "./admin.ts";
export type {
  AdminMe,
  StepUpVerifyRequest,
  AuditLogEntry,
  AuditLogQuery,
  UserStatus,
  AdminSearchQuery,
  AdminUserSummary,
  AdminTeamSummary,
  AdminSearchResult,
  AdminUserDetail,
  AdminTeamDetail,
  PhoneRevealResult,
  SuspendRequest,
  AdminUserBoard,
  PaymentStatus,
  AdminPaymentQuery,
  AdminPaymentSummary,
  AdminPaymentDetail,
  PaymentActionResult,
  ExpireRequest,
  RefundRequest,
  RefundResult,
  ReconcileRequest,
  ReconcileReport,
} from "./admin.ts";

export { rtTokenClaims } from "./rt-token.ts";
export type { RtTokenClaims } from "./rt-token.ts";

export { assetPresignRequest, assetPresignResponse } from "./asset.ts";
export type { AssetPresignRequest, AssetPresignResponse } from "./asset.ts";

export {
  otpRequestBody,
  otpVerifyBody,
  patchMeBody,
  createTeamBody,
  patchTeamBody,
  patchMemberRoleBody,
  createInviteBody,
  createFolderBody,
  patchFolderBody,
  createBoardBody,
  patchBoardBody,
  putAccessBody,
  resolveLinkBody,
  addBoardMemberBody,
  patchBoardMemberRoleBody,
  checkoutBody,
  zarinpalCallbackQuery,
} from "./requests.ts";
export type {
  OtpRequestBody,
  OtpVerifyBody,
  PatchMeBody,
  CreateTeamBody,
  PatchTeamBody,
  PatchMemberRoleBody,
  CreateInviteBody,
  CreateFolderBody,
  PatchFolderBody,
  CreateBoardBody,
  PatchBoardBody,
  PutAccessBody,
  ResolveLinkBody,
  AddBoardMemberBody,
  PatchBoardMemberRoleBody,
  CheckoutBody,
  ZarinpalCallbackQuery,
} from "./requests.ts";
