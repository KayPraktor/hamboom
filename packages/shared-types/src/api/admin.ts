import { z } from "zod";

import { invoice, planLimits, planUsage, subscription, teamSubscriptionStatus } from "./billing.ts";
import { isoDateTime, pageQuery, rial, uuid } from "./primitives.ts";
import { boardAccessMode, boardRole, teamRole } from "./roles.ts";

/**
 * قراردادِ پنلِ ادمین — M6 ([ADR-065](../../../../ARCHITECTURE_DECISIONS.md#adr-065)،
 * [ADR-066](../../../../ARCHITECTURE_DECISIONS.md#adr-066)). تاییدِ مالک ۱۴۰۵/۰۶/۲۱ (M6-D12).
 *
 * ★ **عمداً کوچک:** فقط آنچه فازِ جاری مصرف می‌کند. فاز ۳: `adminMe`/`stepUpVerifyRequest`؛ فاز ۴: `auditLogEntry`/
 * `auditLogQuery` (تاییدِ ۱۴۰۵/۰۶/۲۶)؛ فاز ۵: کاربران/تیم‌ها/تعلیق/نمای پشتیبانی (تاییدِ ۱۴۰۵/۰۶/۲۷)؛ فاز ۶: پرداخت‌ها و
 * استرداد (تاییدِ ۱۴۰۵/۰۷/۰۱)؛ فاز ۷: آمار و وضعیتِ سیستم (تاییدِ ۱۴۰۵/۰۷/۰۳).
 * ★ هر فاز DTOی خودش را **در همان فاز** و با یک توقفِ ثبت‌شده در `PROGRESS-M6-admin.md` آورد —
 * شکلِ فاز ۷ در فاز ۰ حدس بود، و ADR-021 تصویبِ حدس نمی‌خواهد. (و درست هم بود: `plan_id`ی که
 * نقشه فرض کرده بود اصلاً وجود ندارد، ستون `plan_code` است.)
 *
 * ⚠️ این‌ها در سندِ **عمومیِ** OpenAPI نیستند (`internal` — ADR-067)؛ در sdk تایپ‌شده‌اند.
 */

/** پاسخِ `GET /admin/me` — فقط برای staff؛ غیرِ staff ۴۰۳ می‌گیرد، پس `isStaff` همیشه `true` است. */
export const adminMe = z.object({
  userId: uuid,
  isStaff: z.literal(true),
  /** آخرین step-upِ موفق (OTPِ تازه) — `null` یعنی هنوز هیچ؛ پنجره‌اش `ADMIN_STEP_UP_SECONDS`. */
  stepUpVerifiedAt: isoDateTime.nullable(),
});
export type AdminMe = z.infer<typeof adminMe>;

/** بدنه‌ی `POST /admin/step-up/verify` — همان شکلِ کدِ OTPِ ورود. */
export const stepUpVerifyRequest = z.object({
  code: z.string().regex(/^\d{4,8}$/),
});
export type StepUpVerifyRequest = z.infer<typeof stepUpVerifyRequest>;

/**
 * یک ردیفِ `audit_logs` برای پنل — M6 فاز ۴٫۳ ([ADR-067](../../../../ARCHITECTURE_DECISIONS.md#adr-067)).
 * تاییدِ مالک ۱۴۰۵/۰۶/۲۶ (D12). `ip` فقط **ماسک‌شده** (§۳)؛ `actorUserId`/`teamId` می‌توانند `null` باشند
 * (سیستم/CLI مثلِ `admin-grant-staff`، یا عملِ غیرِ تیمی).
 */
export const auditLogEntry = z.object({
  /** `bigserial` — زیرِ 2^53، پس `number` (int8→number، ADR-015). */
  id: z.number().int(),
  actorUserId: uuid.nullable(),
  teamId: uuid.nullable(),
  /** واژگانِ dotted: `staff.grant`، `user.suspend`، … */
  action: z.string(),
  /** `user` | `team` | `board` | `payment` | `subscription` | `staff` — عمداً رشته، تا افزودنِ نوعِ نو قرارداد را نشکند. */
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  /** «203.0.x.x» / «2001:db8::…» — هرگز کامل. */
  ipMasked: z.string().nullable(),
  /** بریده به ۲۵۶. */
  userAgent: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: isoDateTime,
});
export type AuditLogEntry = z.infer<typeof auditLogEntry>;

/** کوئریِ `GET /admin/audit` — همه اختیاری و AND؛ `action` **پیشوندی**؛ صفحه‌بندیِ cursor (`pageQuery`). */
export const auditLogQuery = pageQuery.extend({
  actor: uuid.optional(),
  action: z.string().min(1).max(60).optional(),
  targetType: z.string().min(1).max(40).optional(),
  targetId: z.string().min(1).max(200).optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
});
export type AuditLogQuery = z.infer<typeof auditLogQuery>;

// ── فاز ۵ — کاربران و تیم‌ها (تاییدِ مالک ۱۴۰۵/۰۶/۲۷، D12) ────────────────────

/** وضعیتِ حساب — همان CHECKِ ستونِ `users.status`. */
export const userStatus = z.enum(["active", "suspended", "deleted"]);
export type UserStatus = z.infer<typeof userStatus>;

/** بدنه‌ی `POST /admin/search` — `q`: شماره‌ی **کاملِ** `09…`، UUID، یا متن (trgm روی نام/نامِ تیم، پیشوندِ slug). POST تا عبارت در URL/لاگ ننشیند. */
export const adminSearchQuery = z.object({
  q: z.string().trim().min(1).max(80),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type AdminSearchQuery = z.infer<typeof adminSearchQuery>;

/**
 * کاربر از نگاهِ پنل. ★ `phoneMasked` («0912***45») **هرگز کامل نیست** — نمایشِ کامل فقط با
 * `POST /admin/users/:id/phone/reveal` که ردیفِ audit می‌نویسد (عددِ سیاستیِ TODO-M6 §۰).
 */
export const adminUserSummary = z.object({
  id: uuid,
  displayName: z.string(),
  phoneMasked: z.string().nullable(),
  status: userStatus,
  isStaff: z.boolean(),
  createdAt: isoDateTime,
  lastSeenAt: isoDateTime.nullable(),
});
export type AdminUserSummary = z.infer<typeof adminUserSummary>;

/** تیم از نگاهِ پنل — شمارش‌ها `count(*)`ِ زنده (ADR-053)، پلن همان رزولوشنِ `PLAN_CODE_SQL`. */
export const adminTeamSummary = z.object({
  id: uuid,
  slug: z.string(),
  name: z.string(),
  isPersonal: z.boolean(),
  ownerUserId: uuid,
  memberCount: z.number().int().nonnegative(),
  boardCount: z.number().int().nonnegative(),
  planCode: z.string(),
  subscriptionStatus: teamSubscriptionStatus,
  createdAt: isoDateTime,
});
export type AdminTeamSummary = z.infer<typeof adminTeamSummary>;

/** پاسخِ `GET /admin/search` — هر دو فهرست با هم؛ پیشوندِ شماره تیمی ندارد ⇒ `teams: []`. */
export const adminSearchResult = z.object({
  users: z.array(adminUserSummary),
  teams: z.array(adminTeamSummary),
});
export type AdminSearchResult = z.infer<typeof adminSearchResult>;

/** پاسخِ `GET /admin/users/:id`. `activeSessions` = refresh tokenهای زنده (دستگاه‌های واردشده). */
export const adminUserDetail = adminUserSummary.extend({
  teams: z.array(
    z.object({
      teamId: uuid,
      slug: z.string(),
      name: z.string(),
      isPersonal: z.boolean(),
      role: teamRole,
      planCode: z.string(),
      joinedAt: isoDateTime,
    }),
  ),
  /** بوردهای زنده‌ای که این کاربر ساخته. */
  boardCount: z.number().int().nonnegative(),
  activeSessions: z.number().int().nonnegative(),
});
export type AdminUserDetail = z.infer<typeof adminUserDetail>;

/** پاسخِ `GET /admin/teams/:id` — `limits`/`usage` همان ستون‌های گیتِ ظرفیت؛ `subscription` اشتراکِ زنده یا `null`. */
export const adminTeamDetail = adminTeamSummary.extend({
  limits: planLimits,
  usage: planUsage,
  subscription: subscription.nullable(),
  members: z.array(
    z.object({
      userId: uuid,
      displayName: z.string(),
      role: teamRole,
      status: userStatus,
      joinedAt: isoDateTime,
    }),
  ),
});
export type AdminTeamDetail = z.infer<typeof adminTeamDetail>;

/** پاسخِ `POST /admin/users/:id/phone/reveal` — شماره‌ی کامل، فقط از این مسیرِ ممیزی‌شده. */
export const phoneRevealResult = z.object({ phone: z.string() });
export type PhoneRevealResult = z.infer<typeof phoneRevealResult>;

/** بدنه‌ی `POST /admin/users/:id/suspend` — دلیل در `metadata`ی ردیفِ audit می‌نشیند (بدونِ PII). */
export const suspendRequest = z.object({ reason: z.string().trim().min(3).max(200) });
export type SuspendRequest = z.infer<typeof suspendRequest>;

/**
 * یک بورد در نمای پشتیبانی — `GET /admin/users/:id/boards` (ADR-066 §۱). `role` نقشِ **خودِ کاربر** از
 * همان `effectiveBoardRole` است، نه نقشِ staff؛ حذف‌شده‌ها هم می‌آیند (`deletedAt` پر).
 */
export const adminUserBoard = z.object({
  id: uuid,
  title: z.string(),
  teamId: uuid,
  teamName: z.string(),
  accessMode: boardAccessMode,
  role: boardRole,
  lastActivityAt: isoDateTime,
  deletedAt: isoDateTime.nullable(),
});
export type AdminUserBoard = z.infer<typeof adminUserBoard>;
// ── فاز ۶ — پرداخت‌ها و استرداد (تاییدِ مالک ۱۴۰۵/۰۷/۰۱، D12؛ [ADR-068](../../../../ARCHITECTURE_DECISIONS.md#adr-068)) ──

/** وضعیتِ پرداخت — همان `payments_status_ck`. */
export const paymentStatus = z.enum([
  "pending",
  "paid",
  "failed",
  "canceled",
  "refunded",
  "verify_failed",
]);
export type PaymentStatus = z.infer<typeof paymentStatus>;

/**
 * بدنه‌ی `POST /admin/payments/search` — همه اختیاری و AND؛ `refId` تطبیقِ **دقیق** (شماره‌ی پیگیریِ رسید)،
 * `authority` **پیشوندی** (۳۶ کاراکتر است و اپراتور چند حرفِ اول را دارد)؛ صفحه‌بندیِ cursor (`pageQuery`).
 *
 * ★ **POST با بدنه، نه GET با query string** — همان قاعده‌ی `adminSearchQuery`ِ فاز ۵ (یافته‌ی بازبینیِ ۶٫۵):
 * شماره‌ی پیگیریِ بانکیِ یک مشتری و authorityِ پرداختش در لاگِ دسترسیِ nginx/api و تاریخچه‌ی مرورگر
 * نمی‌نشینند.
 */
export const adminPaymentQuery = pageQuery.extend({
  teamId: uuid.optional(),
  refId: z.string().trim().min(1).max(80).optional(),
  authority: z.string().trim().min(1).max(80).optional(),
  status: paymentStatus.optional(),
});
export type AdminPaymentQuery = z.infer<typeof adminPaymentQuery>;

/** یک پرداخت در فهرستِ پنل. ⚠️ عمداً بدونِ `cardPanMasked`/payloadها — آن‌ها فقط در جزئیات. */
export const adminPaymentSummary = z.object({
  id: uuid,
  teamId: uuid,
  teamName: z.string(),
  initiatedBy: uuid,
  invoiceId: uuid.nullable(),
  invoiceNumber: z.string().nullable(),
  /** `zarinpal` | `idpay` | `mock` — رشته، چون کاتالوگِ درگاه در کد منجمد نمی‌شود. */
  gateway: z.string(),
  gatewayMode: z.string(),
  amountRial: rial,
  status: paymentStatus,
  authority: z.string().nullable(),
  refId: z.string().nullable(),
  failureCode: z.string().nullable(),
  requestedAt: isoDateTime,
  paidAt: isoDateTime.nullable(),
  verifiedAt: isoDateTime.nullable(),
  /** ۰۰۰۹ — `refunded` ⇔ این پر است (CHECKِ دیتابیس). */
  refundedAt: isoDateTime.nullable(),
});
export type AdminPaymentSummary = z.infer<typeof adminPaymentSummary>;

/**
 * پاسخِ `GET /admin/payments/:id` — همان «PaymentAdminView»ِ نقشه‌ی فاز ۰.
 *
 * ★ سه payload **بدونِ PII**اند (نیّتِ خرید؛ `{Authority, Status}`؛ verdictِ نرمال‌شده‌ی بدونِ کارت) و از فاز ۶
 * واقعاً نوشته می‌شوند — تا امروز ستونشان همیشه `NULL` بود. `expireBlocked` دلیلِ **سرور** است (سقفش configی
 * است، نه چیزی که رابط بتواند حساب کند): `null` یعنی دکمه‌ی انقضا فعال.
 */
export const adminPaymentDetail = adminPaymentSummary.extend({
  cardPanMasked: z.string().nullable(),
  feeRial: rial.nullable(),
  refundRef: z.string().nullable(),
  refundAmountRial: rial.nullable(),
  requestPayload: z.record(z.string(), z.unknown()).nullable(),
  callbackPayload: z.record(z.string(), z.unknown()).nullable(),
  verifyPayload: z.record(z.string(), z.unknown()).nullable(),
  invoice: invoice.nullable(),
  /** اشتراکی که `activated_by_payment_id` به همین پرداخت اشاره می‌کند — هدفِ استرداد؛ `null` اگر هیچ. */
  subscription: subscription.nullable(),
  expireBlocked: z.string().nullable(),
});
export type AdminPaymentDetail = z.infer<typeof adminPaymentDetail>;

/**
 * پاسخِ `POST /admin/payments/:id/{verify,expire}` — **۲۰۰ برای هر نتیجه**.
 *
 * ★ برای staff «هنوز پرداخت نشده» یک **اطلاع** است نه خطا (برخلافِ مسیرِ ownerِ M4 که ۴۰۹ می‌دهد): اپراتور
 * می‌خواهد بداند درگاه چه گفت، و یک ۴۰۹ همان را پشتِ قالبِ خطا پنهان می‌کند.
 */
export const paymentActionResult = z.object({
  outcome: z.enum(["activated", "alreadySettled", "notPaid", "unknown", "expired"]),
  message: z.string().nullable(),
  payment: adminPaymentSummary,
});
export type PaymentActionResult = z.infer<typeof paymentActionResult>;

/** بدنه‌ی `POST /admin/payments/:id/expire` — دلیل در `metadata`ی audit (بدونِ PII). */
export const expireRequest = z.object({ reason: z.string().trim().min(3).max(200) });
export type ExpireRequest = z.infer<typeof expireRequest>;

/**
 * بدنه‌ی `POST /admin/payments/:id/refund` — دو کانالِ **صریح** (ADR-068 §۲).
 *
 * `manual`: staff پول را در پنلِ درگاه برگردانده و شماره‌ی مرجع را این‌جا ثبت می‌کند — **امروز تنها مسیرِ اجرایی**.
 * `gateway`: از پورتِ `PaymentGateway.refund`؛ زرین‌پال `REFUND_UNAVAILABLE` می‌دهد تا کانالِ واقعی بیاید.
 */
export const refundRequest = z.discriminatedUnion("channel", [
  z.object({
    channel: z.literal("manual"),
    refundRef: z.string().trim().min(1).max(80),
    reason: z.string().trim().min(3).max(200),
  }),
  z.object({ channel: z.literal("gateway"), reason: z.string().trim().min(3).max(200) }),
]);
export type RefundRequest = z.infer<typeof refundRequest>;

/** پاسخِ استرداد — اثرِ اشتراک صریح است، چون همان چیزی است که پشتیبانی باید به مشتری بگوید. */
export const refundResult = z.object({
  payment: adminPaymentSummary,
  /** اشتراکی که با این استرداد لغو شد (`activated_by_payment_id`)، یا `null`. */
  subscriptionCanceled: uuid.nullable(),
  /** اشتراکِ **جایگزین‌شده‌ی** قبلی که برگردانده شد (تمدیدِ مسترد ⇒ دوره‌ی قبلیِ پرداخت‌شده برمی‌گردد)، یا `null`. */
  subscriptionRestored: uuid.nullable(),
});
export type RefundResult = z.infer<typeof refundResult>;

/**
 * بدنه‌ی `POST /admin/payments/reconcile` — sweepِ **دستی**.
 *
 * ⚠️ `batchSize` سقفِ ۲۵ دارد و پیش‌فرضش ۱۰ است (نه ۵۰ی تایمر): هر ردیف یک رفت‌وبرگشتِ ۱۵ثانیه‌ایِ درگاه
 * می‌تواند باشد و `proxy_read_timeout`ِ nginx ۶۰ ثانیه است.
 */
export const reconcileRequest = z.object({
  adoptOrphans: z.boolean().default(false),
  dryRun: z.boolean().default(false),
  /**
   * ⚠️ سقف **۱۰** است نه ۲۵ (یافته‌ی بازبینیِ ۶٫۵): هر ردیف تا ۱۵ ثانیه انتظارِ درگاه است و
   * `proxy_read_timeout`ِ nginx ۶۰ ثانیه — ۲۵ ردیف هیچ‌وقت داخلِ آن پنجره جا نمی‌شد. ★ و حتی ۱۰ هم
   * **تضمین نیست**: ۵۰۴ گرفتن sweep را متوقف نمی‌کند (هر ردیف تراکنشِ خودش را دارد و ردیف‌های
   * `payment.expire`/`payment.adopt` در ممیزی می‌مانند) — فقط گزارشش را از دست می‌دهی.
   */
  batchSize: z.coerce.number().int().min(1).max(10).default(5),
});
export type ReconcileRequest = z.infer<typeof reconcileRequest>;

const nonNegative = z.number().int().nonnegative();

/** گزارشِ یک اجرای آشتی‌دهی — همان شکلِ `ReconcileReport`ِ سرویس، منهای `decisions` (داخلی). */
export const reconcileReport = z.object({
  scanned: nonNegative,
  skipped: nonNegative,
  /** ★ عددِ مهم: «پول گرفته شده بود و سرویس داده نشده بود». */
  activated: nonNegative,
  alreadySettled: nonNegative,
  stillPending: nonNegative,
  unknown: nonNegative,
  expired: nonNegative,
  orphans: nonNegative,
  adopted: nonNegative,
  subscriptionsEnded: nonNegative,
  errors: z.array(z.string()),
});
export type ReconcileReport = z.infer<typeof reconcileReport>;

// ── فاز ۷ — آمار و وضعیتِ سیستم (تاییدِ مالک ۱۴۰۵/۰۷/۰۳، D12) ──────────────────────────

/**
 * کوئریِ `GET /admin/stats` — فقط پنجره‌ی سریِ روزانه.
 *
 * ⚠️ سقفِ ۹۰ عمدی است: سری روی جدولِ `boards`/`payments` **بدونِ ایندکس** اجرا می‌شود (اندازه‌گیریِ ۷٫۰:
 * روی ۳۰۰هزار ردیف ۱۶ms، پس ایندکس هنوز نمی‌ارزد) و یک پنجره‌ی بی‌سقف آن استدلال را باطل می‌کند.
 */
export const adminStatsQuery = z.object({
  days: z.coerce.number().int().min(7).max(90).default(30),
});
export type AdminStatsQuery = z.infer<typeof adminStatsQuery>;

/**
 * یک نقطه‌ی سریِ روزانه.
 *
 * ★★ `date` **شروعِ روزِ تهران** است (نه UTC)، به‌صورتِ لحظه‌ی ISO. دلیلش اندازه‌گیری است:
 * لایه‌ی نمایش (`@hamboom/i18n`) منطقه را روی `Asia/Tehran` **پین** کرده، پس یک سطلِ UTC یعنی
 * برچسبِ جلالیِ «فلان روز» روی بازه‌ی ۰۳:۳۰ تا ۰۳:۳۰ — روی داده‌ی همین ماشین **۴ از ۱۶** سطل
 * روزِ دیگری می‌افتاد. سرور سطل را به لحظه تبدیل می‌کند تا نما هیچ ریاضیِ منطقه‌ای نکند.
 */
export const statPoint = z.object({ date: isoDateTime, count: nonNegative });
export type StatPoint = z.infer<typeof statPoint>;

/** همان، برای پول. */
export const statMoneyPoint = z.object({ date: isoDateTime, rial });
export type StatMoneyPoint = z.infer<typeof statMoneyPoint>;

/** یک ردیفِ «تیم‌ها به تفکیکِ پلن». */
export const adminPlanUsage = z.object({
  /** ⚠️ عمداً رشته، نه enum — افزودنِ یک پلنِ نو نباید قراردادِ پنل را بشکند. */
  planCode: z.string(),
  planName: z.string(),
  /** `null` یعنی تیمِ **بی‌ردیفِ اشتراک** (رایگان/شخصی)؛ این‌ها در جدولِ `subscriptions` اصلاً نیستند. */
  period: z.enum(["monthly", "yearly"]).nullable(),
  teams: nonNegative,
  /** صندلیِ **فروخته‌شده** (`subscriptions.seats`)، نه شمارشِ عضو — `team_members` تاریخچه ندارد. */
  seats: nonNegative,
});
export type AdminPlanUsage = z.infer<typeof adminPlanUsage>;

/** پاسخِ `GET /admin/stats` — همه از SQLِ خالص، همه با `::bigint` (B-2). */
export const adminStats = z.object({
  generatedAt: isoDateTime,
  windowDays: nonNegative,
  users: z.object({
    total: nonNegative,
    suspended: nonNegative,
    staff: nonNegative,
    active1d: nonNegative,
    active7d: nonNegative,
    active30d: nonNegative,
    newInWindow: nonNegative,
    /**
     * ★★ `false` یعنی هنوز **هیچ** ردیفی `last_seen_at` ندارد ⇒ سه عددِ فعالِ بالا «نامعلوم»اند،
     * نه صفر. بدونِ این پرچم، پنل یک صفرِ راست‌گونما نشان می‌داد — همان چیزی که تا پیش از ۷٫۱
     * واقعیتِ دیتابیس بود (۱۹ کاربر، صفر مقدار).
     */
    activityTracked: z.boolean(),
  }),
  boards: z.object({ live: nonNegative, trashed: nonNegative, newInWindow: nonNegative }),
  /** `personal` زیرمجموعه‌ی `total` است — هر ثبت‌نام یک تیمِ شخصی می‌سازد. */
  teams: z.object({ total: nonNegative, personal: nonNegative, newInWindow: nonNegative }),
  plans: z.array(adminPlanUsage),
  revenue: z.object({
    /** جمعِ پرداخت‌هایی که **یک‌بار پرداخت شده‌اند** — یعنی `paid` **و** `refunded` (استرداد `paid_at` را پاک نمی‌کند). */
    grossRial: rial,
    refundedRial: rial,
    /**
     * ⚠️ **علامت‌دار** و عمداً `rial` نیست: استردادِ پرداختی که **پیش از** پنجره انجام شده بود
     * می‌تواند خالصِ پنجره را منفی کند. یک `nonnegative` این‌جا فقط یک ۵۰۰ی بی‌دلیل می‌ساخت.
     */
    netRial: z.number().int(),
    windowGrossRial: rial,
  }),
  series: z.object({
    boards: z.array(statPoint),
    users: z.array(statPoint),
    revenue: z.array(statMoneyPoint),
  }),
});
export type AdminStats = z.infer<typeof adminStats>;

/** وضعیتِ یک چکِ سیستم. `unknown` = «نپرسیدیم/نمی‌دانیم» و با `fail` یکی نیست (همان قاعده‌ی ADR-056). */
export const systemCheckState = z.enum(["ok", "warn", "fail", "unknown"]);
export type SystemCheckState = z.infer<typeof systemCheckState>;

/** یک چکِ زنده در `GET /admin/system`. */
export const systemCheck = z.object({
  /** ⚠️ عمداً رشته: `db` · `s3:assets` · `s3:snapshots` · `s3:backups` · `redis` · `clock`. */
  key: z.string(),
  state: systemCheckState,
  /** فارسیِ کوتاهِ قابلِ نمایش — ⚠️ هرگز رشته‌ی اتصال، رمز یا متنِ خامِ خطا (P7). */
  detail: z.string(),
  /** `null` یعنی اصلاً پرسیده نشد (مثلاً Redis پیکربندی نشده). */
  latencyMs: nonNegative.nullable(),
});
export type SystemCheck = z.infer<typeof systemCheck>;

/**
 * پاسخِ `GET /admin/system` — نقاطِ کورِ `/readyz` را **دیدنی** می‌کند
 * ([ADR-067](../../../../ARCHITECTURE_DECISIONS.md#adr-067): به‌جای عمیق‌کردنِ `/readyz`).
 */
export const systemStatus = z.object({
  generatedAt: isoDateTime,
  /** بدترینِ حالتِ چک‌ها (`fail` > `warn` > `unknown` > `ok`). */
  state: systemCheckState,
  checks: z.array(systemCheck),
  backup: z.object({
    lastDumpAt: isoDateTime.nullable(),
    lastMirrorAt: isoDateTime.nullable(),
    /** سنِ تازه‌ترینِ آن دو به ساعت؛ `null` یعنی هیچ پشتیبانی نیست. */
    ageHours: z.number().nullable(),
    /** عددِ سیاستیِ فاز ۰: ۳۰ ساعت. */
    staleAfterHours: nonNegative,
  }),
  reconcile: z.object({
    /** `BILLING_RECONCILE_ENABLED` — خاموش‌بودن **خرابی نیست**. */
    enabled: z.boolean(),
    intervalSeconds: nonNegative,
    /**
     * ⚠️ فقط مسیرِ **تایمر** را می‌شمارد؛ sweepِ دستیِ فاز ۶ به آن دست نمی‌زند، و نودی که
     * قفلِ رهبری را باخته هیچ‌وقت ثبت نمی‌کند. پس `null` سه معنی دارد و پنل هر سه را جدا می‌گوید.
     */
    lastRunAt: isoDateTime.nullable(),
    runs: nonNegative,
    activated: nonNegative,
    expired: nonNegative,
    orphans: nonNegative,
    adopted: nonNegative,
    errors: nonNegative,
  }),
  /**
   * ★★ ساعتِ Postgres منهای ساعتِ api (میلی‌ثانیه). همین اختلاف بود که step-up را به حلقه‌ی ۴۲۸
   * می‌انداخت (۷٫۱b) — حالا به‌جای نامرئی‌ماندن، دیده می‌شود. `null` یعنی خودِ DB در دسترس نبود.
   */
  clockSkewMs: z.number().nullable(),
});
export type SystemStatus = z.infer<typeof systemStatus>;

/**
 * یک ردیفِ `feature_flags` — **فقط‌خواندنی** (M6-D7: ارزیاب و CRUD موکول شدند).
 * ⚠️ جدول امروز خالی است و این صادقانه است، نه باگ؛ پرچمِ نمایشیِ ساختگی ساخته نمی‌شود.
 */
export const adminFeatureFlag = z.object({
  key: z.string(),
  enabled: z.boolean(),
  rolloutPct: z.number().int().min(0).max(100),
  teamIds: z.array(uuid),
  updatedAt: isoDateTime,
});
export type AdminFeatureFlag = z.infer<typeof adminFeatureFlag>;
