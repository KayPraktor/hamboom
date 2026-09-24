import {
  effectiveBoardRole,
  requestOtp,
  verifyOtp,
  type OtpConfig,
  type SmsProvider,
} from "@hamboom/auth-core";
import type { PaymentGateway } from "@hamboom/billing-core";
import {
  adminPaymentQuery,
  adminSearchQuery,
  auditLogQuery,
  expireRequest,
  reconcileRequest,
  refundRequest,
  stepUpVerifyRequest,
  suspendRequest,
  type AdminMe,
  type AdminPaymentDetail,
  type AdminPaymentSummary,
  type AdminSearchResult,
  type AdminTeamDetail,
  type AdminUserBoard,
  type AdminUserDetail,
  type AdminUserSummary,
  type AuditLogEntry,
  type PaymentActionResult,
  type PhoneRevealResult,
  type ReconcileReport,
  type RefundResult,
} from "@hamboom/shared-types";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import type pg from "pg";

import { createPgOtpStore } from "../adapters/otp-store.ts";
import { createPgSessionStore } from "../adapters/session-store.ts";
import { auditActor, audited, recordAudit } from "../audit.ts";
import {
  toAdminPaymentDetail,
  toAdminPaymentSummary,
  toAdminTeamDetail,
  toAdminTeamSummary,
  toAdminUserBoard,
  toAdminUserDetail,
  toAdminUserSummary,
  toAuditLogEntry,
} from "../dto.ts";
import { HttpError } from "../errors.ts";
import { withAdvisoryLock } from "../plugins/leader-lock.ts";
import { withTransaction, type Executor } from "../plugins/db.ts";
import { assertUuid, parseBody } from "../schemas.ts";
import {
  expireBlockedReason,
  InvalidPaymentCursorError,
  listPayments,
  readPaymentDetail,
  type ExpireCandidate,
} from "../services/admin-payments.ts";
import {
  lockPaymentForSettle,
  refundPayment,
  settleLocked,
  settlePayment,
} from "../services/billing.ts";
import { applyExpiry, runReconcile, type ReconcilePolicy } from "../services/reconcile.ts";
import {
  classifyQuery,
  listUserBoards,
  readPhone,
  readTeamDetail,
  readUserDetail,
  readUserRow,
  searchTeams,
  searchUsers,
} from "../services/admin-users.ts";
import { InvalidCursorError, listAuditLogs, maskIp } from "../services/audit-log.ts";
import { otpFailure } from "./auth.ts";

/**
 * مسیرهای پایه‌ی پنلِ ادمین — M6 فاز ۳ ([ADR-065](../../../../ARCHITECTURE_DECISIONS.md#adr-065)،
 * [ADR-066](../../../../ARCHITECTURE_DECISIONS.md#adr-066)).
 *
 * ★ **هر مسیرِ `/admin` سه گارد دارد، به همین ترتیب:** `requireAuth` (توکن) → `requireStaff` (خواندنِ
 * DB، fail-closed) → و برای عملِ مخرب `requireStepUp`. اولین مسیرهای مخرب **تعلیق/رفعِ تعلیق** (فاز ۵٫۲)
 * هستند — ۴۲۸ روی استکِ واقعی با همین‌ها سنجیده شد.
 *
 * ── کاربران و تیم‌ها (فاز ۵، ADR-066) ───────────────────────────────────────
 *
 * خواندن‌ها (`search`، `users/:id`، `teams/:id`، `users/:id/boards`) بدونِ `audited()` — گیتِ ۱۶ فقط جهش را
 * می‌خواهد. `phone/reveal` **POST** است با اینکه چیزی عوض نمی‌کند: عمداً، تا هم زیرِ گیتِ ۱۶ بیفتد و هم
 * هیچ کشِ GETی شماره‌ی کامل را نگه ندارد. تعلیق (§۴): `status` + سوزاندنِ همه‌ی نشست‌ها + ردیفِ audit در
 * **یک** تراکنش با `FOR UPDATE` روی کاربر؛ staff از پنل معلق **نمی‌شود** (اول `admin-grant-staff --revoke` از
 * ایمیج) تا یک staffِ لو‌رفته نتواند بقیه‌ی staff را بیرون بیندازد.
 *
 * ── step-up (ADR-066 §۳) ────────────────────────────────────────────────────
 *
 * همان زیرساختِ OTPِ ورود، با `purpose='admin_step_up'` روی یک storeِ **جدا** (چالشِ ورودِ در جریانِ
 * همان شماره را نمی‌کُشد — conformance). موفقیت `users.step_up_verified_at = now()` می‌نویسد؛ هیچ
 * نشستِ نو، هیچ توکنِ نو، هیچ خانواده‌ی refreshِ نو — همان تفاوتی که با `/auth/otp/verify` عمدی است.
 * شماره‌ی مقصد **از ردیفِ خودِ staff** می‌آید، نه از بدنه: کسی نمی‌تواند کد را به شماره‌ی دیگری بفرستد.
 *
 * ⚠️ همان سقفِ نرخِ `/auth/otp/request` روی درخواستِ step-up هم هست — این مسیر پیامک می‌فرستد.
 *
 * ★ سندِ این مسیرها در `openapi.ts` با `internal: true` است (ADR-067 §۵): در گاردِ دریفت هست، در
 * `openapi.json`ِ عمومی نیست.
 */

export interface AdminRouteDeps {
  pool: pg.Pool;
  requireAuth: preHandlerHookHandler;
  requireStaff: preHandlerHookHandler;
  /** ۴۲۸ بدونِ OTPِ تازه — روی هر عملِ مخرب (ADR-066 §۳). */
  requireStepUp: preHandlerHookHandler;
  sms: SmsProvider;
  otpConfig: OtpConfig;
  otpRateLimit: { max: number; timeWindow: number };
}

/**
 * depsِ مسیرهای پرداخت — **جدا** از `AdminRouteDeps` (M6 فاز ۶).
 *
 * ★ عمدی: مسیرهای فاز ۳/۵ نه درگاه می‌خواهند نه سیاستِ آشتی‌دهی، و این مجموعه در `buildApp` **بعد از**
 * حل‌شدنِ درگاه ثبت می‌شود — همان درگاهی که `registerBillingRoutes` و تایمرِ آشتی‌دهی می‌گیرند. یک نمونه‌ی
 * دوم یعنی احتمالِ اینکه staff ردیفی را با درگاهی verify کند که نساخته‌اش.
 */
export interface AdminPaymentRouteDeps {
  pool: pg.Pool;
  requireAuth: preHandlerHookHandler;
  requireStaff: preHandlerHookHandler;
  requireStepUp: preHandlerHookHandler;
  gateway: PaymentGateway;
  /** سیاستِ آشتی‌دهی از config — `expireAfterMs` سقفِ نردبانِ انقضای دستی هم هست. */
  reconcilePolicy: ReconcilePolicy;
}

const STEP_UP_PURPOSE = "admin_step_up" as const;

/** پاسخِ `adminMe` از ردیفِ فعلیِ کاربر — همان شکلِ `GET /admin/me`، در verify هم برمی‌گردد. */
async function readAdminMe(pool: pg.Pool, userId: string): Promise<AdminMe> {
  const { rows } = await pool.query<{ step_up_verified_at: Date | string | null }>(
    "SELECT step_up_verified_at FROM users WHERE id = $1",
    [userId],
  );
  const at = rows[0]?.step_up_verified_at ?? null;
  return {
    userId,
    isStaff: true,
    stepUpVerifiedAt: at === null ? null : new Date(at).toISOString(),
  };
}

/** شماره‌ی تاییدشده‌ی خودِ staff — مقصدِ OTPِ step-up. بدونِ شماره اصلاً staff نمی‌شود وارد شود. */
async function staffPhone(pool: pg.Pool, req: FastifyRequest): Promise<string> {
  const userId = req.staff!.userId;
  const { rows } = await pool.query<{ phone: string | null }>(
    "SELECT phone FROM users WHERE id = $1 AND phone_verified_at IS NOT NULL",
    [userId],
  );
  const phone = rows[0]?.phone ?? null;
  if (phone === null) {
    throw new HttpError(
      409,
      "CONFLICT",
      "این حسابِ staff شماره‌ی تاییدشده ندارد؛ step-up ممکن نیست.",
    );
  }
  return phone;
}

export function registerAdminRoutes(app: FastifyInstance, deps: AdminRouteDeps): void {
  const staffOnly = [deps.requireAuth, deps.requireStaff];

  // ── ★ خواندنِ audit (فاز ۴٫۳) — keyset، فیلترِ AND، ip ماسک ───────────────
  // `parseBody` روی query هم همان کار را می‌کند (zod + VALIDATION_ERROR)؛ cursorِ خراب ۴۰۰ است،
  // نه «از اول» — سکوت یعنی صفحه‌ی تکراری. فقط خواندن است ⇒ بدونِ audited() (گیتِ ۱۶ فقط جهش را می‌خواهد).
  app.get(
    "/admin/audit",
    { preHandler: staffOnly },
    async (req): Promise<{ items: AuditLogEntry[]; nextCursor: string | null }> => {
      const q = parseBody(auditLogQuery, req.query);
      try {
        const page = await listAuditLogs(deps.pool, {
          actorUserId: q.actor,
          action: q.action,
          targetType: q.targetType,
          targetId: q.targetId,
          from: q.from,
          to: q.to,
          limit: q.limit,
          cursor: q.cursor,
        });
        return {
          items: page.rows.map((r) => toAuditLogEntry(r, maskIp)),
          nextCursor: page.nextCursor,
        };
      } catch (error) {
        if (error instanceof InvalidCursorError) {
          throw new HttpError(400, "VALIDATION_ERROR", "cursor نامعتبر است.");
        }
        throw error;
      }
    },
  );

  // ── کیستم؟ — لینکِ «پنل» و وضعیتِ step-up در رابط از همین می‌آید ──────────
  app.get("/admin/me", { preHandler: staffOnly }, (req) =>
    readAdminMe(deps.pool, req.staff!.userId),
  );

  // ── step-up: درخواستِ کد → شماره‌ی خودِ staff ─────────────────────────────
  app.post(
    "/admin/step-up/request",
    {
      preHandler: staffOnly,
      config: {
        ...audited("staff.step_up.request"),
        rateLimit: { max: deps.otpRateLimit.max, timeWindow: deps.otpRateLimit.timeWindow },
      },
    },
    async (req) => {
      const phone = await staffPhone(deps.pool, req);
      // ★ فاز ۴ (ADR-067 §۱): چالش + ردیفِ audit در **یک** تراکنش — store روی همان tx. ارسالِ پیامک
      //   داخلِ تراکنش می‌مانَد (مثلِ درگاه در settlePayment)؛ سقفش SMS_IR_TIMEOUT_MS=۱۰s < ۳۰sِ
      //   idle_in_transaction (ADR-057). شکستِ ارسال ⇒ rollback ⇒ نه چالش، نه ردیف.
      await withTransaction(deps.pool, async (tx) => {
        await requestOtp(createPgOtpStore(tx, STEP_UP_PURPOSE), deps.sms, phone, deps.otpConfig);
        await recordAudit(tx, { actor: auditActor(req), action: "staff.step_up.request" });
      });
      return { ok: true };
    },
  );

  // ── step-up: تاییدِ کد → `step_up_verified_at = now()` ──────────────────────
  app.post(
    "/admin/step-up/verify",
    { preHandler: staffOnly, config: audited("staff.step_up") },
    async (req) => {
      const { code } = parseBody(stepUpVerifyRequest, req.body);
      const phone = await staffPhone(deps.pool, req);
      // ⚠️ مثلِ ورود، بیرونِ تراکنش: incrementAttempts روی خطا باید بماند (قفلِ max-attempts).
      const result = await verifyOtp(
        createPgOtpStore(deps.pool, STEP_UP_PURPOSE),
        phone,
        code,
        deps.otpConfig,
      );
      if (!result.ok) throw otpFailure(result.reason);
      // ★ فاز ۴: مهر + ردیفِ audit در یک تراکنش (ADR-067 §۱).
      const userId = req.staff!.userId;
      await withTransaction(deps.pool, async (tx) => {
        await tx.query(
          "UPDATE users SET step_up_verified_at = now(), updated_at = now() WHERE id = $1",
          [userId],
        );
        await recordAudit(tx, {
          actor: auditActor(req),
          action: "staff.step_up",
          target: { type: "user", id: userId },
        });
      });
      return readAdminMe(deps.pool, userId);
    },
  );

  // ══ فاز ۵ — کاربران و تیم‌ها ═══════════════════════════════════════════════
  const stepUp = [...staffOnly, deps.requireStepUp];
  const userIdParam = (req: FastifyRequest): string => {
    const { id } = req.params as { id: string };
    assertUuid(id, "شناسه‌ی کاربر");
    return id;
  };

  // ── جست‌وجو: شماره‌ی کاملِ «09…»، UUID، یا متن (trgm) — هر دو فهرست با هم ──
  // ★ **POST** با بدنه، نه GET با query string (یافته‌ی بازبینیِ ۵٫۵): `?q=<شماره>` شماره‌ی کاملِ یک شخص را در
  //   لاگِ دسترسیِ api و nginx و تاریخچه‌ی مرورگر می‌نشانْد. و **ممیزی‌شده** (`user.search`): «چه کسی دنبالِ چه
  //   نوعِ چیزی گشت» — بدونِ خودِ عبارت در metadata (نام/شماره PII است).
  app.post(
    "/admin/search",
    { preHandler: staffOnly, config: audited("user.search") },
    async (req): Promise<AdminSearchResult> => {
      const q = parseBody(adminSearchQuery, req.body);
      const kind = classifyQuery(q.q);
      if (kind === null) return { users: [], teams: [] };
      const [users, teams] = await Promise.all([
        searchUsers(deps.pool, kind, q.limit),
        searchTeams(deps.pool, kind, q.limit),
      ]);
      await withTransaction(deps.pool, (tx) =>
        recordAudit(tx, {
          actor: auditActor(req),
          action: "user.search",
          metadata: { kind: kind.kind, users: users.length, teams: teams.length },
        }),
      );
      return { users: users.map(toAdminUserSummary), teams: teams.map(toAdminTeamSummary) };
    },
  );

  app.get("/admin/users/:id", { preHandler: staffOnly }, async (req): Promise<AdminUserDetail> => {
    const detail = await readUserDetail(deps.pool, userIdParam(req));
    if (detail === null) throw new HttpError(404, "USER_NOT_FOUND", "کاربر یافت نشد.");
    return toAdminUserDetail(detail);
  });

  app.get("/admin/teams/:id", { preHandler: staffOnly }, async (req): Promise<AdminTeamDetail> => {
    const { id } = req.params as { id: string };
    assertUuid(id, "شناسه‌ی تیم");
    const detail = await readTeamDetail(deps.pool, id);
    if (detail === null) throw new HttpError(404, "TEAM_NOT_FOUND", "تیم یافت نشد.");
    return toAdminTeamDetail(detail);
  });

  // ── نمای پشتیبانی (۵٫۴): بوردهای کاربر با نقشِ **خودش** — کوئریِ خودِ پنل، نه predicateِ GET /boards ──
  //   نقش با `isSuspended:false` حساب می‌شود: «اگر فعال بود چه داشت» — برای کاربرِ معلق فهرستِ خالی بی‌فایده است.
  app.get(
    "/admin/users/:id/boards",
    { preHandler: staffOnly },
    async (req): Promise<{ items: AdminUserBoard[] }> => {
      const id = userIdParam(req);
      if ((await readUserRow(deps.pool, id)) === null) {
        throw new HttpError(404, "USER_NOT_FOUND", "کاربر یافت نشد.");
      }
      const rows = await listUserBoards(deps.pool, id);
      const items: AdminUserBoard[] = [];
      for (const r of rows) {
        const role = effectiveBoardRole({
          isStaff: false,
          isSuspended: false,
          isBoardOwner: r.is_board_owner,
          accessMode: r.access_mode as AdminUserBoard["accessMode"],
          directRole: r.direct_role as AdminUserBoard["role"] | null,
          teamRole: r.team_role as "owner" | "admin" | "member" | "guest" | null,
          hasValidLink: false,
        });
        if (role !== null) items.push(toAdminUserBoard(r, role));
      }
      return { items };
    },
  );

  // ── شماره‌ی کامل — تنها راه؛ POST تا ممیزی شود (گیتِ ۱۶) و کش نشود ──
  app.post(
    "/admin/users/:id/phone/reveal",
    { preHandler: staffOnly, config: audited("user.phone.reveal") },
    async (req): Promise<PhoneRevealResult> => {
      const id = userIdParam(req);
      return withTransaction(deps.pool, async (tx) => {
        const phone = await readPhone(tx, id);
        if (phone === null)
          throw new HttpError(404, "USER_NOT_FOUND", "کاربر یا شماره‌اش یافت نشد.");
        await recordAudit(tx, {
          actor: auditActor(req),
          action: "user.phone.reveal",
          target: { type: "user", id },
        });
        return { phone };
      });
    },
  );

  // ── تعلیق / رفعِ تعلیق (۵٫۲، ADR-066 §۴) — step-up + یک تراکنش ──
  const lockUser = async (
    tx: Executor,
    id: string,
  ): Promise<{ status: string; is_staff: boolean }> => {
    const { rows } = await tx.query<{ status: string; is_staff: boolean }>(
      "SELECT status, is_staff FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
      [id],
    );
    if (rows[0] === undefined) throw new HttpError(404, "USER_NOT_FOUND", "کاربر یافت نشد.");
    return rows[0];
  };

  app.post(
    "/admin/users/:id/suspend",
    { preHandler: stepUp, config: audited("user.suspend") },
    async (req): Promise<AdminUserSummary> => {
      const id = userIdParam(req);
      const { reason } = parseBody(suspendRequest, req.body);
      return withTransaction(deps.pool, async (tx) => {
        const row = await lockUser(tx, id);
        if (row.is_staff) {
          throw new HttpError(
            409,
            "CONFLICT",
            "حسابِ staff از پنل معلق نمی‌شود؛ اول با admin-grant-staff --revoke سلبش کن.",
          );
        }
        if (row.status !== "active") {
          throw new HttpError(409, "INVALID_TRANSITION", `حساب در وضعیتِ «${row.status}» است.`);
        }
        await tx.query("UPDATE users SET status = 'suspended', updated_at = now() WHERE id = $1", [
          id,
        ]);
        // ★ همه‌ی خانواده‌های نشست در همین تراکنش می‌سوزند — پورتِ SessionStore، نه SQLِ جدا.
        const sessionsRevoked = await createPgSessionStore(tx).revokeAllForUser(id);
        // ★ و چالشِ ورودِ در جریانِ همین شماره مصرف می‌شود (یافته‌ی ۵٫۵): کدی که پیش از تعلیق فرستاده شده
        //   نباید بعدش نشست بسازد. `/auth/otp/verify` هم خودش status را می‌سنجد — این لایه‌ی دوم است.
        const consumed = await tx.query(
          `UPDATE otp_challenges SET consumed_at = now()
            WHERE purpose = 'login' AND consumed_at IS NULL
              AND destination = (SELECT phone FROM users WHERE id = $1)`,
          [id],
        );
        await recordAudit(tx, {
          actor: auditActor(req),
          action: "user.suspend",
          target: { type: "user", id },
          metadata: {
            reason,
            sessionsRevoked,
            challengesConsumed: consumed.rowCount ?? 0,
            from: "active",
          },
        });
        return toAdminUserSummary((await readUserRow(tx, id))!);
      });
    },
  );

  app.post(
    "/admin/users/:id/unsuspend",
    { preHandler: stepUp, config: audited("user.unsuspend") },
    async (req): Promise<AdminUserSummary> => {
      const id = userIdParam(req);
      return withTransaction(deps.pool, async (tx) => {
        const row = await lockUser(tx, id);
        if (row.status !== "suspended") {
          throw new HttpError(409, "INVALID_TRANSITION", `حساب در وضعیتِ «${row.status}» است.`);
        }
        // نشست‌ها برنمی‌گردند — کاربر دوباره با OTP وارد می‌شود (سوختن یک‌طرفه است).
        await tx.query("UPDATE users SET status = 'active', updated_at = now() WHERE id = $1", [
          id,
        ]);
        await recordAudit(tx, {
          actor: auditActor(req),
          action: "user.unsuspend",
          target: { type: "user", id },
          metadata: { from: "suspended" },
        });
        return toAdminUserSummary((await readUserRow(tx, id))!);
      });
    },
  );
}

// ══ فاز ۶ — پرداخت‌ها و استرداد (ADR-068) ═══════════════════════════════════
//
// ★ خواندن‌ها staff-only؛ **هر چهار جهش** پشتِ step-up و `audited()`: verifyِ دستی پول را فعال می‌کند،
//   انقضا فاکتور را باطل، استرداد اشتراک را لغو، و sweepِ دستی هر سه را با هم. هیچ‌کدام «فقط خواندن» نیست.
// ⚠️ verify/expire برای **هر** نتیجه ۲۰۰ می‌دهند با `outcome`: برای اپراتور «درگاه چه گفت» خودِ جواب است،
//   و یک ۴۰۹ همان را پشتِ قالبِ خطا پنهان می‌کند (برخلافِ مسیرِ ownerِ M4 که کاربرِ نهایی است).
export function registerAdminPaymentRoutes(app: FastifyInstance, deps: AdminPaymentRouteDeps): void {
  const staffOnly = [deps.requireAuth, deps.requireStaff];
  const stepUp = [...staffOnly, deps.requireStepUp];
  const paymentIdParam = (req: FastifyRequest): string => {
    const { id } = req.params as { id: string };
    assertUuid(id, "شناسه‌ی پرداخت");
    return id;
  };

  /** ردیفِ تازه‌ی همان پرداخت برای پاسخ — پس از جهش، تا رابط وضعیتِ **بعد از عمل** را ببیند. */
  const summaryAfter = async (db: Executor, id: string): Promise<AdminPaymentSummary> => {
    const rows = await readPaymentDetail(db, id);
    if (rows === null) throw new HttpError(404, "PAYMENT_NOT_FOUND", "پرداخت یافت نشد.");
    return toAdminPaymentSummary(rows.payment);
  };

  // ★ **POST با بدنه** (یافته‌ی بازبینیِ ۶٫۵): شماره‌ی پیگیریِ بانکی و authorityِ مشتری نباید در query
  //   string و از آن‌جا در لاگِ دسترسیِ nginx/api بنشینند — دقیقاً همان دلیلی که `/admin/search`ِ فاز ۵ را
  //   POST کرد. و چون POSTِ زیرِ `/admin` است، گیتِ ۱۶ اعلامِ ممیزی می‌خواهد: `payment.search` ثبت می‌شود
  //   (چه کسی دنبالِ چه **نوع** فیلتری گشت — بدونِ خودِ شماره‌ها، که همان قاعده‌ی `user.search` است).
  app.post(
    "/admin/payments/search",
    { preHandler: staffOnly, config: audited("payment.search") },
    async (req): Promise<{ items: AdminPaymentSummary[]; nextCursor: string | null }> => {
      const q = parseBody(adminPaymentQuery, req.body ?? {});
      try {
        const page = await listPayments(deps.pool, {
          teamId: q.teamId,
          refId: q.refId,
          authority: q.authority,
          status: q.status,
          limit: q.limit,
          cursor: q.cursor,
        });
        await withTransaction(deps.pool, (tx) =>
          recordAudit(tx, {
            actor: auditActor(req),
            action: "payment.search",
            metadata: {
              byTeam: q.teamId !== undefined,
              byRefId: q.refId !== undefined,
              byAuthority: q.authority !== undefined,
              status: q.status ?? null,
              results: page.rows.length,
            },
          }),
        );
        return { items: page.rows.map(toAdminPaymentSummary), nextCursor: page.nextCursor };
      } catch (error) {
        if (error instanceof InvalidPaymentCursorError) {
          throw new HttpError(400, "VALIDATION_ERROR", "cursor نامعتبر است.");
        }
        throw error;
      }
    },
  );

  app.get(
    "/admin/payments/:id",
    { preHandler: staffOnly },
    async (req): Promise<AdminPaymentDetail> => {
      const rows = await readPaymentDetail(deps.pool, paymentIdParam(req));
      if (rows === null) throw new HttpError(404, "PAYMENT_NOT_FOUND", "پرداخت یافت نشد.");
      // ★ دلیلِ غیرفعال‌بودنِ دکمه‌ی انقضا از **سرور** می‌آید: سقفش configی است و رابط نباید حدسش بزند.
      const blocked = expireBlockedReason(
        rows.payment,
        { expireAfterMs: deps.reconcilePolicy.expireAfterMs },
        new Date(),
      );
      return toAdminPaymentDetail(rows, blocked);
    },
  );

  // ── verifyِ دستی: همان `settlePayment`، با auditِ داخلِ همان تراکنش ──
  app.post(
    "/admin/payments/:id/verify",
    { preHandler: stepUp, config: audited("payment.verify") },
    async (req): Promise<PaymentActionResult> => {
      const id = paymentIdParam(req);
      const outcome = await settlePayment(
        { pool: deps.pool, gateway: deps.gateway },
        { by: "id", id },
        {
          onSettled: async (tx, result) => {
            await recordAudit(tx, {
              actor: auditActor(req),
              action: "payment.verify",
              target: { type: "payment", id },
              metadata: {
                outcome: result.kind,
                ...(result.kind === "notPaid" ? { gatewayCode: result.code } : {}),
              },
            });
          },
        },
      );
      const message =
        outcome.kind === "notPaid" || outcome.kind === "unknown" ? outcome.message : null;
      return { outcome: outcome.kind, message, payment: await summaryAfter(deps.pool, id) };
    },
  );

  // ── انقضای دستی: نردبانِ ADR-056 **زیرِ قفل**، بعد یک پرسشِ تازه ──
  app.post(
    "/admin/payments/:id/expire",
    { preHandler: stepUp, config: audited("payment.expire") },
    async (req): Promise<PaymentActionResult> => {
      const id = paymentIdParam(req);
      const { reason } = parseBody(expireRequest, req.body);
      const outcome = await withTransaction(deps.pool, async (tx) => {
        const payment = await lockPaymentForSettle(tx, deps.gateway, { by: "id", id });
        // ★ نردبان **دوباره زیرِ قفل** سنجیده می‌شود، نه فقط برای رنگِ دکمه: بینِ بازشدنِ صفحه و کلیک،
        //   ردیف می‌تواند تسویه شده باشد.
        const row = await tx.query<ExpireCandidate>(
          "SELECT status, authority, failure_code, requested_at FROM payments WHERE id = $1",
          [id],
        );
        const blocked = expireBlockedReason(
          row.rows[0]!,
          { expireAfterMs: deps.reconcilePolicy.expireAfterMs },
          new Date(),
        );
        if (blocked !== null) throw new HttpError(409, "INVALID_TRANSITION", blocked);

        // ★★ و تازه بعدش یک verifyِ **تازه**: اگر کاربر همین حالا پرداخت کرده باشد، باطل‌کردن پول را
        //    برای همیشه پیشِ درگاه جا می‌گذاشت (یافته‌ی منتقدِ فاز ۶).
        const settled = await settleLocked(tx, { gateway: deps.gateway }, payment);
        if (settled.kind !== "notPaid") {
          // ★★ **تلاشِ ابطالی که به ابطال نرسید هم ردِ خودش را می‌گذارد** — در مرورگر دیده شد که این
          //    مسیر می‌تواند یک اشتراک را **فعال** کند (درگاه گفت پول گرفته شده) و هیچ ردیفی نماند:
          //    یک جهشِ مالی با actorِ نامعلوم. نامِ عمل `payment.verify` است چون کاری که واقعاً رخ داد
          //    همان پرسش بود؛ `via: "expire"` می‌گوید staff دنبالِ چه بود. (ابطالِ واقعی ردیفِ
          //    `payment.expire`ِ خودش را از `applyExpiry` می‌گیرد — یک عمل، یک ردیف.)
          await recordAudit(tx, {
            actor: auditActor(req),
            action: "payment.verify",
            target: { type: "payment", id },
            metadata: { via: "expire", reason, outcome: settled.kind },
          });
        }
        if (settled.kind === "activated") return { kind: "activated" as const, message: null };
        if (settled.kind === "alreadySettled") {
          return { kind: "alreadySettled" as const, message: null };
        }
        if (settled.kind === "unknown") {
          return { kind: "unknown" as const, message: settled.message };
        }
        await applyExpiry(
          tx,
          { id: payment.id, invoice_id: payment.invoice_id },
          auditActor(req),
          { reason, failureCode: settled.code === null ? null : String(settled.code) },
        );
        return { kind: "expired" as const, message: settled.message };
      });
      return {
        outcome: outcome.kind,
        message: outcome.message,
        payment: await summaryAfter(deps.pool, id),
      };
    },
  );

  // ── استرداد: تنها نویسنده‌ی `refunded`، با audit در همان تراکنش ──
  app.post(
    "/admin/payments/:id/refund",
    { preHandler: stepUp, config: audited("payment.refund") },
    async (req): Promise<RefundResult> => {
      const id = paymentIdParam(req);
      const body = parseBody(refundRequest, req.body);
      const result = await withTransaction(deps.pool, async (tx) => {
        const rows = await refundPayment(
          tx,
          { gateway: deps.gateway },
          id,
          body.channel === "manual"
            ? { channel: "manual", refundRef: body.refundRef }
            : { channel: "gateway" },
        );
        await recordAudit(tx, {
          actor: auditActor(req),
          action: "payment.refund",
          target: { type: "payment", id },
          metadata: {
            channel: body.channel,
            reason: body.reason,
            refundRef: rows.refundRef,
            amountRial: rows.amountRial,
            // ★ کوپن با استرداد **آزاد نمی‌شود** (سیاستِ ثبت‌شده) — پس دستِ‌کم در پرونده بماند که کدامش بود.
            couponCode: rows.couponCode,
            subscriptionCanceled: rows.subscriptionCanceled,
            subscriptionRestored: rows.subscriptionRestored,
          },
        });
        return rows;
      });
      return {
        payment: await summaryAfter(deps.pool, id),
        subscriptionCanceled: result.subscriptionCanceled,
        subscriptionRestored: result.subscriptionRestored,
      };
    },
  );

  // ── sweepِ دستی: همان `runReconcile`، زیرِ همان advisory lock ──
  //
  // ⚠️ **همگام است و سقفِ دسته کوچک‌تر**: هر ردیف یک رفت‌وبرگشتِ تا ۱۵ثانیه‌ایِ درگاه است و
  //    `proxy_read_timeout`ِ nginx ۶۰ ثانیه — با دسته‌ی ۵۰ی تایمر، staff ۵۰۴ می‌گرفت در حالی که sweep
  //    پشتِ سر ادامه داشت. پیش‌فرض ۱۰، سقفِ schema ۲۵.
  // ⚠️ ردیفِ auditِ خلاصه **پس از** اجرا نوشته می‌شود و این صادقانه است: هر ردیف تراکنشِ خودش را دارد و
  //    `payment.expire`/`payment.adopt`ِ داخلِ همان تراکنش‌ها پاسخ‌گوییِ ردیف‌به‌ردیف را نگه می‌دارند.
  app.post(
    "/admin/payments/reconcile",
    { preHandler: stepUp, config: audited("payment.reconcile") },
    async (req): Promise<ReconcileReport> => {
      const body = parseBody(reconcileRequest, req.body ?? {});
      const actor = auditActor(req);
      const report = await withAdvisoryLock({ pool: deps.pool }, () =>
        runReconcile(
          { pool: deps.pool, gateway: deps.gateway, actor },
          {
            ...deps.reconcilePolicy,
            batchSize: body.batchSize,
            adoptOrphans: body.adoptOrphans,
            dryRun: body.dryRun,
          },
        ),
      );
      if (report === null) {
        throw new HttpError(
          409,
          "CONFLICT",
          "یک آشتی‌دهی همین حالا در حالِ اجراست (تایمرِ همین نود یا نودِ دیگر). کمی بعد دوباره.",
        );
      }
      await withTransaction(deps.pool, (tx) =>
        recordAudit(tx, {
          actor,
          action: "payment.reconcile",
          metadata: {
            dryRun: body.dryRun,
            adoptOrphans: body.adoptOrphans,
            batchSize: body.batchSize,
            scanned: report.scanned,
            activated: report.activated,
            expired: report.expired,
            adopted: report.adopted,
            orphans: report.orphans,
            errors: report.errors.length,
          },
        }),
      );
      return {
        scanned: report.scanned,
        skipped: report.skipped,
        activated: report.activated,
        alreadySettled: report.alreadySettled,
        stillPending: report.stillPending,
        unknown: report.unknown,
        expired: report.expired,
        orphans: report.orphans,
        adopted: report.adopted,
        subscriptionsEnded: report.subscriptionsEnded,
        errors: report.errors,
      };
    },
  );
}
