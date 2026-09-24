import { isIP } from "node:net";

import type { FastifyRequest } from "fastify";

import type { Executor } from "./plugins/db.ts";

/**
 * ممیزیِ عمل‌های ادمین — M6، [ADR-067](../../../ARCHITECTURE_DECISIONS.md#adr-067).
 *
 * ── اعلام (فاز ۳) ────────────────────────────────────────────────────────
 *
 * `audited(action)` یک تکه‌ی `config` برای route است: «این مسیر یک جهشِ ادمین است و نامِ
 * عملش این است». گیتِ ۱۶ی `pnpm verify` ([`scripts/check-admin-audit.ts`](../../../scripts/check-admin-audit.ts))
 * هر `POST/PATCH/PUT/DELETE` زیرِ `/admin` را که این اعلام را نداشته باشد قرمز می‌کند —
 * پس مسیرِ مخربی که فراموش شود ممیزی شود، اصلاً به verify نمی‌رسد.
 *
 * ── نوشتن (فاز ۴) — یک نقطه، همان تراکنش ──────────────────────────────────
 *
 * `recordAudit(tx, …)` **تنها** نویسنده‌ی `audit_logs` در api است و همیشه executorِ همان تراکنشی
 * را می‌گیرد که عمل را انجام می‌دهد (ADR-067 §۱). ردیفی که بیرونِ تراکنشِ عمل نوشته شود یا عملی
 * را ثبت می‌کند که رخ نداد، یا عملی را ثبت نمی‌کند که رخ داد — هر دو برای پرونده‌ی تعلیق/استرداد
 * بدترند از نداشتنِ audit. اثباتش: تستِ «عمل شکست می‌خورد ⇒ هیچ ردیفی» روی PGِ واقعی
 * (`sdk:contract`) و خودآزمونِ `admin-grant-staff` (شکستِ عمدیِ INSERT ⇒ پرچم برنمی‌گردد).
 *
 * ★ P7 با یک تفاوتِ ثبت‌شده: `ip` و `user_agent` **ذخیره می‌شوند** (forensics) ولی هرگز به pino
 * نمی‌روند — این تابع لاگ نمی‌زند، و `LOG_REDACT_PATHS` پیش از این اولین نویسنده `ip/phone/
 * user_agent/email` را گرفت (ADR-067 §۳). در DTO `ip` ماسک است (فاز ۴٫۳). IPِ نامعتبر (که
 * ستونِ `inet` ردش می‌کرد) به `null` می‌شود: ردِ forensics نباید خودِ عمل را بیندازد.
 *
 * ★ واژگانِ `dotted` ثابت است و به‌جای رشته‌ی آزاد **union** است، تا نامِ عملی که در پنل
 * فیلتر می‌شود با نامی که نوشته می‌شود یکی بماند. هر فاز عمل‌های خودش را به انتها اضافه می‌کند.
 */

export type AuditAction =
  // فاز ۳ — step-upِ staff (ADR-066 §۳) و اعطا/سلبِ staff (اسکریپتِ `admin-grant-staff`)
  | "staff.step_up.request"
  | "staff.step_up"
  | "staff.grant"
  | "staff.revoke"
  // فاز ۵ — کاربران: نمایشِ کاملِ شماره (عددِ سیاستیِ TODO §۰)، تعلیق/رفعِ تعلیق (ADR-066 §۴)،
  //          و نمای پشتیبانی: rt-tokenی که نقشش **فقط** از staff آمده (ADR-066 §۱)
  | "user.search"
  | "user.phone.reveal"
  | "user.suspend"
  | "user.unsuspend"
  | "support.board.view"
  // فاز ۶ — پرداخت‌ها (ADR-068): verifyِ دستی، انقضای دستی/خودکار، استرداد، فرزندخواندگی، sweepِ دستی.
  // ⚠️ `payment.expire`/`payment.adopt` را **آشتی‌دهی هم** می‌نویسد (actor = سیستم، `actor_user_id = NULL`):
  //    همان عمل، دو فراخوان — و پرونده‌ی «چه کسی این پرداخت را باطل کرد» باید هر دو را داشته باشد.
  | "payment.search"
  | "payment.verify"
  | "payment.expire"
  | "payment.refund"
  | "payment.adopt"
  | "payment.reconcile";

/** نوعِ هدفِ عمل — ستونِ `target_type`؛ `target_id` شناسه‌ی همان جدول است. */
export type AuditTargetType = "user" | "team" | "board" | "payment" | "subscription" | "staff";

export interface AuditRouteConfig {
  /** نامِ عمل در واژگانِ dotted — گیتِ ۱۶ وجودِ **ناتهیِ** این را روی هر جهشِ `/admin` می‌خواهد. */
  action: AuditAction;
}

declare module "fastify" {
  interface FastifyContextConfig {
    /** ★ اعلامِ ممیزی روی routeهای `/admin` — با `audited()` ساخته می‌شود. */
    audit?: AuditRouteConfig;
  }
}

/** تکه‌ی `config` برای یک routeِ ممیزی‌شده: `app.post(url, { config: audited("user.suspend") }, …)`. */
export function audited(action: AuditAction): { audit: AuditRouteConfig } {
  return { audit: { action } };
}

/** کیست و از کجا — از درخواستِ staff استخراج می‌شود (`auditActor(req)`). */
export interface AuditActor {
  /** `null` = سیستم/CLI (اسکریپتِ `admin-grant-staff` خودش می‌نویسد؛ این‌جا همیشه staff است). */
  userId: string | null;
  ip: string | null;
  userAgent: string | null;
}

export interface AuditEntry {
  actor: AuditActor;
  action: AuditAction;
  target?: { type: AuditTargetType; id: string };
  /** تیمِ مرتبط (اگر عمل تیمی است) — ایندکسِ `audit_logs_team_idx` روی همین است. */
  teamId?: string | null;
  /** فقط داده‌ی **غیرِ PII** و کوچک (وضعیتِ قبل/بعد، دلیل). شماره/ایمیل این‌جا ننویس. */
  metadata?: Record<string, unknown>;
}

/**
 * actorِ یک درخواستِ staff — `req.staff` را `requireStaff` پر کرده؛ `req.ip` پشتِ nginx با
 * `TRUST_PROXY` IPِ واقعیِ کلاینت است (M5 گام ۹٫۲). UA به ۲۵۶ کاراکتر بریده می‌شود.
 */
export function auditActor(req: FastifyRequest): AuditActor {
  const ua = req.headers["user-agent"];
  return {
    userId: req.staff?.userId ?? req.authUser?.sub ?? null,
    ip: req.ip,
    userAgent: typeof ua === "string" && ua.length > 0 ? ua.slice(0, 256) : null,
  };
}

/** IPی که ستونِ `inet` می‌پذیرد، وگرنه `null` — تا forensics عمل را نیندازد. */
export function inetOrNull(ip: string | null | undefined): string | null {
  if (ip === null || ip === undefined) return null;
  // ★ IPv4-mapped IPv6 (`::ffff:1.2.3.4`) از سوکتِ dual-stack می‌آید؛ `inet` قبولش می‌کند ولی
  //   ماسک/فیلترِ پنل شکلِ v4 را می‌خواهد — پس همان‌جا نرمال می‌شود.
  const v4mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  const candidate = v4mapped?.[1] ?? ip;
  return isIP(candidate) === 0 ? null : candidate;
}

/**
 * ★★ تنها نقطه‌ی نوشتنِ `audit_logs` — با executorِ **همان تراکنشِ** عمل.
 *
 * ⚠️ این تابع هیچ‌چیز لاگ نمی‌زند و هیچ خطایی را نمی‌بلعد: اگر INSERT شکست بخورد، تراکنشِ عمل
 * هم باید بشکند (ADR-067 §۱). اگر عمل «بدونِ audit» بهتر از «بدونِ عمل» بود، از اول ممیزی
 * نمی‌خواست.
 */
export async function recordAudit(tx: Executor, entry: AuditEntry): Promise<void> {
  await tx.query(
    `INSERT INTO audit_logs (actor_user_id, team_id, action, target_type, target_id, ip, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      entry.actor.userId,
      entry.teamId ?? null,
      entry.action,
      entry.target?.type ?? null,
      entry.target?.id ?? null,
      inetOrNull(entry.actor.ip),
      entry.actor.userAgent,
      JSON.stringify(entry.metadata ?? {}),
    ],
  );
}
