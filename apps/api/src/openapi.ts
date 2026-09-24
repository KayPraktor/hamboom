import {
  adminMe,
  adminPaymentDetail,
  adminPaymentQuery,
  adminPaymentSummary,
  expireRequest,
  paymentActionResult,
  reconcileReport,
  reconcileRequest,
  refundRequest,
  refundResult,
  adminSearchQuery,
  adminSearchResult,
  adminTeamDetail,
  adminUserBoard,
  adminUserDetail,
  adminUserSummary,
  phoneRevealResult,
  suspendRequest,
  apiError,
  auditLogEntry,
  auditLogQuery,
  assetPresignRequest,
  assetPresignResponse,
  board,
  boardMember,
  boardSummary,
  folder,
  invoice,
  plan,
  subscription,
  paginated,
  rtTokenClaims,
  stepUpVerifyRequest,
  team,
  teamMember,
  user,
  userPublic,
} from "@hamboom/shared-types";
import { z } from "zod";

import {
  addBoardMemberBody,
  checkoutBody,
  createBoardBody,
  createFolderBody,
  createInviteBody,
  createTeamBody,
  otpRequestBody,
  otpVerifyBody,
  patchBoardBody,
  patchBoardMemberRoleBody,
  patchFolderBody,
  patchMeBody,
  patchMemberRoleBody,
  patchTeamBody,
  putAccessBody,
  resolveLinkBody,
} from "./schemas.ts";

/**
 * سندِ OpenAPI 3.1 از **همان zodِ منبعِ حقیقت** ساخته می‌شود — گام ۵٫۵.
 *
 * ★ خط‌قرمزِ ۳ی `shared-types`: «یک تعریف، سه خروجی: تایپ، اعتبارسنجیِ زمانِ اجرا، و schema برای
 * OpenAPI». اینجا خروجیِ سوم است — با `z.toJSONSchema` (بومیِ zod v4، بدونِ وابستگیِ نو، P1). OpenAPI 3.1
 * روی JSON-Schema 2020-12 سوار است، همان چیزی که zod تولید می‌کند.
 *
 * ⚠️ `ROUTES` دستی نگه داشته می‌شود (قرارداد، مثلِ PLAN §۵٫۲)، ولی یک **گاردِ رانش** در تست ثابت می‌کند
 * هر مسیرِ ثبت‌شده در Fastify اینجا هم مستند است — پس دریفت بی‌صدا نمی‌مانَد.
 */

/** یک schemaِ zod را به JSON-Schemaِ سازگار با OpenAPI 3.1 تبدیل می‌کند (بدونِ کلیدِ `$schema`). */
function toJson(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { unrepresentable: "any" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

/** schemaهای نام‌دارِ `components` — از DTOهای `shared-types` و بدنه‌های درخواستِ محلی. */
const COMPONENT_SCHEMAS: Record<string, z.ZodType> = {
  ApiError: apiError,
  User: user,
  UserPublic: userPublic,
  Team: team,
  TeamMember: teamMember,
  Board: board,
  BoardSummary: boardSummary,
  BoardMember: boardMember,
  Folder: folder,
  RtTokenClaims: rtTokenClaims,
  AssetPresignRequest: assetPresignRequest,
  AssetPresignResponse: assetPresignResponse,
  Paginated: paginated(z.unknown()),
  OtpRequestBody: otpRequestBody,
  OtpVerifyBody: otpVerifyBody,
  CreateBoardBody: createBoardBody,
  PatchBoardBody: patchBoardBody,
  CreateTeamBody: createTeamBody,
  PatchTeamBody: patchTeamBody,
  PatchMemberRoleBody: patchMemberRoleBody,
  CreateInviteBody: createInviteBody,
  CreateFolderBody: createFolderBody,
  PatchFolderBody: patchFolderBody,
  PatchMeBody: patchMeBody,
  PutAccessBody: putAccessBody,
  ResolveLinkBody: resolveLinkBody,
  AddBoardMemberBody: addBoardMemberBody,
  PatchBoardMemberRoleBody: patchBoardMemberRoleBody,
  // ── billing (M4 فاز ۵) ──
  Plan: plan,
  Subscription: subscription,
  Invoice: invoice,
  CheckoutBody: checkoutBody,
};

/**
 * ★★ schemaهای **داخلی** — پنلِ ادمین (M6، [ADR-067](../../../ARCHITECTURE_DECISIONS.md#adr-067) §۵).
 *
 * `components.schemas`ِ سندِ عمومی **همه‌ی** `COMPONENT_SCHEMAS` را بی‌توجه به مسیر خروجی می‌دهد
 * (واقعیتِ ۸ی فاز ۰)؛ پس شکلِ DTOهای ادمین اگر آن‌جا بنشیند، از `GET /openapi.json`ِ عمومی لو
 * می‌رود حتی وقتی هیچ مسیرِ `/admin`ی مستند نیست. این فهرست جداست و مسیرهای `internal` فقط از
 * این می‌خوانند. سه خودآزمون در `openapi.test.ts` مرزِ دو فهرست را نگه می‌دارند.
 */
const INTERNAL_SCHEMAS: Record<string, z.ZodType> = {
  AdminMe: adminMe,
  StepUpVerifyRequest: stepUpVerifyRequest,
  // فاز ۴٫۳ (D12، تاییدِ ۱۴۰۵/۰۶/۲۶)
  AuditLogEntry: auditLogEntry,
  AuditLogQuery: auditLogQuery,
  // فاز ۵ (D12، تاییدِ ۱۴۰۵/۰۶/۲۷)
  AdminSearchQuery: adminSearchQuery,
  AdminSearchResult: adminSearchResult,
  AdminUserSummary: adminUserSummary,
  AdminUserDetail: adminUserDetail,
  AdminTeamDetail: adminTeamDetail,
  AdminUserBoard: adminUserBoard,
  PhoneRevealResult: phoneRevealResult,
  SuspendRequest: suspendRequest,
  // فاز ۶ (D12، تاییدِ ۱۴۰۵/۰۷/۰۱) — پرداخت‌ها و استرداد (ADR-068)
  AdminPaymentQuery: adminPaymentQuery,
  AdminPaymentSummary: adminPaymentSummary,
  AdminPaymentDetail: adminPaymentDetail,
  PaymentActionResult: paymentActionResult,
  ExpireRequest: expireRequest,
  RefundRequest: refundRequest,
  RefundResult: refundResult,
  ReconcileRequest: reconcileRequest,
  ReconcileReport: reconcileReport,
};

type PublicSchemaName = keyof typeof COMPONENT_SCHEMAS;
type InternalSchemaName = keyof typeof INTERNAL_SCHEMAS;

export interface RouteDoc {
  method: "get" | "post" | "patch" | "delete" | "put";
  /** مسیرِ Fastify (`:param`) — گاردِ دریفت مستقیم با آن می‌سنجد؛ هنگامِ خروجی به `{param}` می‌شود. */
  path: string;
  tag: string;
  summary: string;
  /** پیش‌فرض bearer؛ `public: true` یعنی بدونِ احراز. */
  public?: boolean;
  /**
   * ★ `internal: true` = مسیرِ پنلِ ادمین (ADR-067 §۵): در گاردِ دریفت **هست** (باید مستند باشد)،
   * در `openapi.json`/`api.md`ِ عمومی **نیست**، و schemaهایش فقط از `INTERNAL_SCHEMAS` می‌آیند.
   */
  internal?: boolean;
  /** نامِ schemaِ بدنه در `components` (برای مسیرِ داخلی: `INTERNAL_SCHEMAS`). */
  body?: PublicSchemaName | InternalSchemaName;
  /** پاسخِ موفق: کد + (اختیاری) schema. پیش‌فرضِ کد ۲۰۰. */
  ok?: { code?: number; schema?: PublicSchemaName | InternalSchemaName; description?: string };
}

/** ★ منبعِ واحدِ مسیرها — گاردِ دریفتِ تست تضمین می‌کند کامل بماند. */
const ROUTES: RouteDoc[] = [
  // ── سلامت ──
  { method: "get", path: "/healthz", tag: "health", summary: "liveness", public: true },
  {
    method: "get",
    path: "/readyz",
    tag: "health",
    summary: "readiness (ping به db)",
    public: true,
  },
  {
    method: "get",
    path: "/openapi.json",
    tag: "health",
    summary: "سندِ OpenAPI 3.1",
    public: true,
  },
  {
    method: "get",
    path: "/api/v1/docs",
    tag: "health",
    summary: "مرورگرِ سبکِ مستندات (self-hosted)",
    public: true,
  },

  // ── احراز ──
  {
    method: "post",
    path: "/auth/otp/request",
    tag: "auth",
    summary: "ارسالِ OTP (ضدِ enumeration، rate-limit)",
    public: true,
    body: "OtpRequestBody",
  },
  {
    method: "post",
    path: "/auth/otp/verify",
    tag: "auth",
    summary: "تاییدِ OTP → accessToken + کوکیِ refresh",
    public: true,
    body: "OtpVerifyBody",
  },
  {
    method: "post",
    path: "/auth/refresh",
    tag: "auth",
    summary: "چرخشِ refresh (کوکیِ HttpOnly؛ reuse → سوزاندنِ خانواده)",
    public: true,
  },

  // ── کاربر ──
  { method: "get", path: "/me", tag: "me", summary: "پروفایل + تیم‌ها", ok: { schema: "User" } },
  {
    method: "patch",
    path: "/me",
    tag: "me",
    summary: "ویرایشِ نام/locale",
    body: "PatchMeBody",
    ok: { schema: "User" },
  },

  // ── تیم ──
  {
    method: "post",
    path: "/teams",
    tag: "teams",
    summary: "ساختِ تیم (اتمیک: team+owner+usage)",
    body: "CreateTeamBody",
    ok: { code: 201, schema: "Team" },
  },
  { method: "get", path: "/teams/:id", tag: "teams", summary: "تیم", ok: { schema: "Team" } },
  {
    method: "patch",
    path: "/teams/:id",
    tag: "teams",
    summary: "ویرایشِ تیم (admin+)",
    body: "PatchTeamBody",
    ok: { schema: "Team" },
  },
  { method: "get", path: "/teams/:id/members", tag: "teams", summary: "اعضای تیم" },
  {
    method: "patch",
    path: "/teams/:id/members/:userId",
    tag: "teams",
    summary: "تغییرِ نقشِ عضو (admin+، مالک محافظت‌شده)",
    body: "PatchMemberRoleBody",
  },
  {
    method: "delete",
    path: "/teams/:id/members/:userId",
    tag: "teams",
    summary: "حذفِ عضو",
    ok: { code: 204 },
  },
  {
    method: "post",
    path: "/teams/:id/invites",
    tag: "teams",
    summary: "ساختِ دعوت (توکنِ hash)",
    body: "CreateInviteBody",
    ok: { code: 201 },
  },
  {
    method: "post",
    path: "/invites/:token/accept",
    tag: "teams",
    summary: "پذیرشِ دعوت (اتمیک، FOR UPDATE)",
  },

  // ── فولدر ──
  { method: "get", path: "/teams/:teamId/folders", tag: "folders", summary: "فولدرهای تیم" },
  {
    method: "post",
    path: "/teams/:teamId/folders",
    tag: "folders",
    summary: "ساختِ فولدر",
    body: "CreateFolderBody",
    ok: { code: 201, schema: "Folder" },
  },
  {
    method: "patch",
    path: "/folders/:id",
    tag: "folders",
    summary: "ویرایشِ فولدر",
    body: "PatchFolderBody",
    ok: { schema: "Folder" },
  },
  {
    method: "delete",
    path: "/folders/:id",
    tag: "folders",
    summary: "حذفِ فولدر",
    ok: { code: 204 },
  },

  // ── بورد ──
  { method: "get", path: "/boards", tag: "boards", summary: "لیست/جستجوی pg_trgm/فولدر/favorite" },
  {
    method: "post",
    path: "/boards",
    tag: "boards",
    summary: "ساختِ بورد (تک‌ردیفی، created_by)",
    body: "CreateBoardBody",
    ok: { code: 201, schema: "Board" },
  },
  {
    method: "get",
    path: "/boards/:id",
    tag: "boards",
    summary: "متادیتای بورد + myRole",
    ok: { schema: "Board" },
  },
  {
    method: "get",
    path: "/boards/:id/snapshot",
    tag: "boards",
    summary: "snapshotِ بوت (octet-stream؛ ۲۰۴ اگر نباشد)",
    ok: { description: "application/octet-stream" },
  },
  {
    method: "patch",
    path: "/boards/:id",
    tag: "boards",
    summary: "ویرایشِ بورد (editor+)",
    body: "PatchBoardBody",
    ok: { schema: "Board" },
  },
  {
    method: "delete",
    path: "/boards/:id",
    tag: "boards",
    summary: "حذفِ نرم (owner)",
    ok: { code: 204 },
  },
  {
    method: "post",
    path: "/boards/:id/restore",
    tag: "boards",
    summary: "بازیابیِ بوردِ حذف‌شده (owner)",
  },
  {
    method: "post",
    path: "/boards/:id/duplicate",
    tag: "boards",
    summary: "تکثیرِ متادیتا (editor+)",
    ok: { code: 201, schema: "Board" },
  },
  { method: "post", path: "/boards/:id/favorite", tag: "boards", summary: "نشان‌کردن (viewer+)" },
  {
    method: "delete",
    path: "/boards/:id/favorite",
    tag: "boards",
    summary: "برداشتنِ نشان",
    ok: { code: 204 },
  },
  {
    method: "get",
    path: "/boards/:id/rt-token",
    tag: "boards",
    summary: "★ rt-tokenِ ۶۰ثانیه‌ایِ WS (پورتِ ۴)",
    ok: { schema: "RtTokenClaims", description: "توکنِ امضاشده + claims" },
  },

  // ── دسترسی/اشتراک ──
  {
    method: "get",
    path: "/boards/:id/access",
    tag: "board-access",
    summary: "حالتِ اشتراک + اعضا (viewer+)",
  },
  {
    method: "put",
    path: "/boards/:id/access",
    tag: "board-access",
    summary: "تنظیمِ حالت + تولید/ابطالِ لینک (owner)",
    body: "PutAccessBody",
  },
  {
    method: "post",
    path: "/public/boards/resolve",
    tag: "board-access",
    summary: "resolveِ مهمانِ لینک → گرنتِ ماندگار (DP-4)",
    body: "ResolveLinkBody",
  },
  {
    method: "post",
    path: "/boards/:id/members",
    tag: "board-access",
    summary: "افزودنِ عضوِ مستقیم (owner)",
    body: "AddBoardMemberBody",
  },
  {
    method: "patch",
    path: "/boards/:id/members/:userId",
    tag: "board-access",
    summary: "تغییرِ نقشِ عضوِ مستقیم (owner)",
    body: "PatchBoardMemberRoleBody",
  },
  {
    method: "delete",
    path: "/boards/:id/members/:userId",
    tag: "board-access",
    summary: "حذفِ عضوِ مستقیم (owner)",
    ok: { code: 204 },
  },

  // ── دارایی ──
  {
    method: "post",
    path: "/boards/:boardId/assets/presign",
    tag: "assets",
    summary: "presignِ آپلود (editor+)",
    body: "AssetPresignRequest",
    ok: { schema: "AssetPresignResponse" },
  },
  {
    method: "post",
    path: "/boards/:boardId/assets/:fileId/commit",
    tag: "assets",
    summary: "commit: تاییدِ بایتِ واقعی (sha/نوع/اندازه) + دی‌دوپ (editor+)",
  },
  {
    method: "get",
    path: "/assets/:fileId",
    tag: "assets",
    summary: "۳۰۲ به presigned GET (viewer+)",
    ok: { code: 302, description: "ریدایرکت به URLِ امضاشده" },
  },

  // ── پرداخت و اشتراک (M4 فاز ۵) ──
  {
    method: "get",
    path: "/billing/plans",
    tag: "billing",
    summary: "فهرستِ پلن‌های **فعال** (عمومی — صفحه‌ی قیمت)",
    public: true,
    ok: { schema: "Plan" },
  },
  {
    method: "post",
    path: "/teams/:teamId/billing/checkout",
    tag: "billing",
    summary: "شروعِ خرید (owner) — مبلغ کاملاً سمتِ سرور محاسبه می‌شود",
    body: "CheckoutBody",
  },
  {
    method: "get",
    path: "/billing/zarinpal/callback",
    tag: "billing",
    summary: "بازگشت از درگاه → verifyِ سرور-به-سرور → ریدایرکت به وب (عمومی)",
    public: true,
  },
  {
    method: "post",
    path: "/billing/payments/:paymentId/verify",
    tag: "billing",
    summary: "verifyِ دستی — بازیابیِ پرداختِ گم‌شده (owner)",
  },
  {
    method: "get",
    path: "/teams/:teamId/billing/subscription",
    tag: "billing",
    summary: "اشتراکِ فعلی (admin؛ `null` یعنی تیمِ رایگان)",
    ok: { schema: "Subscription" },
  },
  {
    method: "get",
    path: "/teams/:teamId/billing/invoices",
    tag: "billing",
    summary: "فاکتورها (admin)",
    ok: { schema: "Invoice" },
  },
  {
    method: "post",
    path: "/teams/:teamId/billing/cancel",
    tag: "billing",
    summary: "لغو در پایانِ دوره (owner)",
    ok: { schema: "Subscription" },
  },
  // ⚠️ فقط در غیر-production ثبت می‌شود، ولی **مستند می‌مانَد**: گاردِ دریفت با `buildApp`ِ
  //    محیطِ تست می‌سنجد و اگر اینجا نباشد قرمز می‌شود. جای درگاهِ واقعی را در توسعه می‌گیرد (P3).
  {
    method: "get",
    path: "/billing/mock/pay/:authority",
    tag: "billing",
    summary: "صفحه‌ی ساختگیِ پرداخت — **فقط توسعه** (در production ثبت نمی‌شود)",
    public: true,
  },

  // ── ★ پنلِ ادمین (M6 فاز ۳) — همه `internal`؛ تگِ `admin` عمداً در `tags`ِ سندِ عمومی نیست ──
  {
    method: "get",
    path: "/admin/me",
    tag: "admin",
    summary: "کیستم؟ (staff) + وضعیتِ step-up",
    internal: true,
    ok: { schema: "AdminMe" },
  },
  {
    method: "post",
    path: "/admin/step-up/request",
    tag: "admin",
    summary: "درخواستِ کدِ step-up به شماره‌ی خودِ staff (purpose=admin_step_up، سقفِ نرخِ OTP)",
    internal: true,
  },
  {
    method: "post",
    path: "/admin/step-up/verify",
    tag: "admin",
    summary: "تاییدِ کدِ step-up → users.step_up_verified_at = now()",
    internal: true,
    body: "StepUpVerifyRequest",
    ok: { schema: "AdminMe" },
  },
  {
    method: "get",
    path: "/admin/audit",
    tag: "admin",
    summary:
      "ردیف‌های audit_logs — فیلترِ actor/action(پیشوندی)/target/بازه، keyset cursor (AuditLogQuery)؛ ip ماسک",
    internal: true,
    ok: { schema: "Paginated", description: "paginated(AuditLogEntry)" },
  },
  // ── فاز ۵ — کاربران و تیم‌ها (ADR-066) ──
  {
    method: "post",
    path: "/admin/search",
    tag: "admin",
    summary:
      "جست‌وجوی کاربر/تیم — q: شماره‌ی کاملِ 09…، UUID، یا متن (trgm)؛ شماره ماسک؛ POST تا عبارت در لاگ/URL ننشیند؛ ممیزی‌شده (user.search)",
    internal: true,
    body: "AdminSearchQuery",
    ok: { schema: "AdminSearchResult" },
  },
  {
    method: "get",
    path: "/admin/users/:id",
    tag: "admin",
    summary: "جزئیاتِ کاربر: تیم‌ها با نقش/پلن، بوردهای ساخته‌شده، نشست‌های زنده",
    internal: true,
    ok: { schema: "AdminUserDetail" },
  },
  {
    method: "get",
    path: "/admin/teams/:id",
    tag: "admin",
    summary: "جزئیاتِ تیم: پلن/سقف/مصرف با count(*)ِ زنده، اشتراکِ زنده، اعضا با وضعیت",
    internal: true,
    ok: { schema: "AdminTeamDetail" },
  },
  {
    method: "get",
    path: "/admin/users/:id/boards",
    tag: "admin",
    summary: "نمای پشتیبانی: بوردهای کاربر با نقشِ خودش (سازنده/عضو/تیم؛ حذف‌شده‌ها هم)",
    internal: true,
    ok: { description: "{ items: AdminUserBoard[] }" },
  },
  {
    method: "post",
    path: "/admin/users/:id/phone/reveal",
    tag: "admin",
    summary: "شماره‌ی کامل — ممیزی‌شده (user.phone.reveal)؛ تنها مسیرِ خروجِ شماره‌ی ماسک‌نشده",
    internal: true,
    ok: { schema: "PhoneRevealResult" },
  },
  {
    method: "post",
    path: "/admin/users/:id/suspend",
    tag: "admin",
    summary:
      "تعلیق (step-up لازم، ۴۲۸ بدونش): status=suspended + سوزاندنِ همه‌ی نشست‌ها + audit در یک تراکنش؛ staff ۴۰۹",
    internal: true,
    body: "SuspendRequest",
    ok: { schema: "AdminUserSummary" },
  },
  {
    method: "post",
    path: "/admin/users/:id/unsuspend",
    tag: "admin",
    summary: "رفعِ تعلیق (step-up لازم): status=active + audit؛ نشست‌ها برنمی‌گردند",
    internal: true,
    ok: { schema: "AdminUserSummary" },
  },
  // ── فاز ۶ — پرداخت‌ها و استرداد (ADR-068) ──
  {
    method: "post",
    path: "/admin/payments/search",
    tag: "admin",
    summary:
      "فهرستِ پرداخت‌ها — فیلترِ team/ref_id(دقیق)/authority(پیشوندی)/status، keyset cursor؛ POST تا شماره‌ی پیگیری در لاگ/URL ننشیند؛ ممیزی‌شده (payment.search)",
    internal: true,
    body: "AdminPaymentQuery",
    ok: { schema: "Paginated", description: "paginated(AdminPaymentSummary)" },
  },
  {
    method: "get",
    path: "/admin/payments/:id",
    tag: "admin",
    summary:
      "جزئیاتِ پرداخت: payloadهای request/callback/verify، فاکتور، اشتراکِ فعال‌شده، و دلیلِ غیرفعال‌بودنِ انقضا",
    internal: true,
    ok: { schema: "AdminPaymentDetail" },
  },
  {
    method: "post",
    path: "/admin/payments/:id/verify",
    tag: "admin",
    summary:
      "verifyِ دستی (step-up): همان settlePayment + auditِ داخلِ همان تراکنش؛ ۲۰۰ با outcome برای هر نتیجه",
    internal: true,
    ok: { schema: "PaymentActionResult" },
  },
  {
    method: "post",
    path: "/admin/payments/:id/expire",
    tag: "admin",
    summary:
      "انقضای دستی (step-up): نردبانِ ADR-056 پله‌ی ۳ زیرِ قفل + verifyِ تازه؛ paid ⇒ فعال‌سازی، notPaid ⇒ ابطال",
    internal: true,
    body: "ExpireRequest",
    ok: { schema: "PaymentActionResult" },
  },
  {
    method: "post",
    path: "/admin/payments/:id/refund",
    tag: "admin",
    summary:
      "استرداد (step-up): manual = ثبتِ مرجعِ دستی · gateway = پورتِ refund (زرین‌پال ⇒ REFUND_UNAVAILABLE)",
    internal: true,
    body: "RefundRequest",
    ok: { schema: "RefundResult" },
  },
  {
    method: "post",
    path: "/admin/payments/reconcile",
    tag: "admin",
    summary:
      "sweepِ دستی (step-up) زیرِ همان advisory lock؛ قفلِ گرفته‌شده ⇒ ۴۰۹. batchSize ≤ ۲۵ (مهلتِ nginx)",
    internal: true,
    body: "ReconcileRequest",
    ok: { schema: "ReconcileReport" },
  },
];

/** خروجیِ OpenAPIِ یک مسیرِ Fastify: `:param` → `{param}`. */
const toOpenApiPath = (path: string): string => path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");

/** مسیرهای داخلی به شکلِ OpenAPI — برای گاردِ «مسیرِ داخلی در سندِ عمومی». */
export function internalOpenApiPaths(routes: readonly RouteDoc[] = ROUTES): string[] {
  return routes.filter((r) => r.internal === true).map((r) => toOpenApiPath(r.path));
}

/** نام‌های schemaی داخلی — برای گاردِ «schemaی ادمین در componentsِ عمومی». */
export function internalSchemaNames(): string[] {
  return Object.keys(INTERNAL_SCHEMAS);
}

export interface RouteDrift {
  /** ثبت‌شده در Fastify ولی نه در `ROUTES` و نه در استثناها. */
  undocumented: string[];
  /** در `ROUTES` هست ولی Fastify ثبتش نکرده. */
  unregistered: string[];
  /** استثنایی که مسیرش دیگر وجود ندارد. */
  deadExceptions: string[];
}

/**
 * ★ گاردِ دریفت — خالص، تا خودآزمون بتواند با ورودیِ عمداً خراب قرمزش کند.
 * مسیرهای `internal` **داخلِ** `documented`اند: بی‌سند‌ماندنِ یک مسیرِ `/admin` همان‌قدر قرمز است.
 */
export function routeDrift(
  registered: Iterable<string>,
  documented: ReadonlySet<string>,
  exceptions: ReadonlySet<string>,
): RouteDrift {
  const reg = new Set(registered);
  return {
    undocumented: [...reg].filter((r) => !documented.has(r) && !exceptions.has(r)).sort(),
    unregistered: [...documented].filter((r) => !reg.has(r)).sort(),
    deadExceptions: [...exceptions].filter((r) => !reg.has(r)).sort(),
  };
}

/**
 * ★★ سه ادعا درباره‌ی سندِ **عمومی** (ADR-067 §۵) — خالص، برای تست و برای `gen-openapi --check`:
 * هیچ مسیرِ داخلی در `paths` · هیچ schemaی داخلی در `components.schemas` · تگِ `admin` در `tags` نیست.
 */
export function publicSpecProblems(
  doc: Record<string, unknown>,
  internalPaths: readonly string[],
  internalSchemas: readonly string[],
): string[] {
  const paths = (doc.paths ?? {}) as Record<string, unknown>;
  const components = (doc.components ?? {}) as { schemas?: Record<string, unknown> };
  const tags = ((doc.tags ?? []) as { name: string }[]).map((t) => t.name);
  const problems: string[] = [];
  for (const p of internalPaths) {
    if (p in paths) problems.push(`مسیرِ داخلی در سندِ عمومی: ${p}`);
  }
  for (const s of internalSchemas) {
    if (components.schemas !== undefined && s in components.schemas) {
      problems.push(`schemaی داخلی در componentsِ عمومی: ${s}`);
    }
  }
  if (tags.includes("admin")) problems.push("تگِ admin در tagsِ سندِ عمومی");
  return problems;
}

/** فهرستِ مسیرهای مستندشده به‌صورتِ `METHOD path` (مسیرِ Fastify) — گاردِ دریفتِ تست از این استفاده می‌کند. */
export function documentedRoutes(): Set<string> {
  return new Set(ROUTES.map((r) => `${r.method.toUpperCase()} ${r.path}`));
}

const STD_ERRORS = {
  "400": { $ref: "#/components/responses/Error" },
  "401": { $ref: "#/components/responses/Error" },
  "403": { $ref: "#/components/responses/Error" },
  "404": { $ref: "#/components/responses/Error" },
};

function buildResponses(r: RouteDoc): Record<string, unknown> {
  const code = String(r.ok?.code ?? 200);
  const success: Record<string, unknown> =
    code === "204"
      ? { description: r.ok?.description ?? "بدونِ محتوا" }
      : {
          description: r.ok?.description ?? "موفق",
          ...(r.ok?.schema
            ? {
                content: {
                  "application/json": {
                    schema: { $ref: `#/components/schemas/${r.ok.schema}` },
                  },
                },
              }
            : {}),
        };
  return r.public
    ? { [code]: success }
    : { [code]: success, "429": { $ref: "#/components/responses/Error" }, ...STD_ERRORS };
}

/**
 * سندِ **عمومیِ** OpenAPI 3.1 — مسیرهای `internal` و `INTERNAL_SCHEMAS` عمداً بیرون می‌مانند.
 * ورودی‌ها تزریق‌پذیرند فقط برای خودآزمون‌ها (`openapi.test.ts`)؛ مصرف‌کننده‌ی واقعی بدونِ آرگومان صدا می‌زند.
 */
export function buildOpenApiDocument(
  routes: readonly RouteDoc[] = ROUTES,
  componentSchemas: Record<string, z.ZodType> = COMPONENT_SCHEMAS,
): Record<string, unknown> {
  const schemas: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(componentSchemas)) {
    schemas[name] = toJson(schema);
  }

  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    if (r.internal === true) continue; // ADR-067 §۵ — سندِ عمومی، فقط مسیرهای عمومی
    const oaPath = toOpenApiPath(r.path);
    const params = [...r.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    const op: Record<string, unknown> = {
      tags: [r.tag],
      summary: r.summary,
      ...(params.length > 0 ? { parameters: params } : {}),
      ...(r.public ? {} : { security: [{ bearerAuth: [] }] }),
      responses: buildResponses(r),
    };
    if (r.body) {
      op.requestBody = {
        required: true,
        content: {
          "application/json": { schema: { $ref: `#/components/schemas/${r.body}` } },
        },
      };
    }
    paths[oaPath] ??= {};
    paths[oaPath][r.method] = op;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Hamboom API",
      version: "0.1.0",
      description: "REST APIِ پلتفرمِ وایت‌بوردِ همکاریِ هم‌بوم (ماژول M3).",
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "health" },
      { name: "auth" },
      { name: "me" },
      { name: "teams" },
      { name: "folders" },
      { name: "boards" },
      { name: "board-access" },
      { name: "assets" },
      { name: "billing" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      responses: {
        Error: {
          description: "خطا (قالبِ یکسانِ apiError)",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
        },
      },
      schemas,
    },
    paths,
  };
}
