import type { FastifyRequest, preHandlerHookHandler } from "fastify";
import type pg from "pg";

import { HttpError } from "./errors.ts";

/**
 * گیتِ `/admin` — M6 فاز ۳، [ADR-066](../../../ARCHITECTURE_DECISIONS.md#adr-066) §۲ و §۳.
 *
 * ── `requireStaff`: یک خواندنِ PK در هر درخواست، fail-closed ────────────────
 *
 * بعد از `requireAuth` می‌نشیند و `is_staff`/`status` را از **دیتابیس** می‌خوانَد، نه از توکن:
 * access-token هیچ نقشی حمل نمی‌کند (ADR-012) و اگر می‌کرد هم ۱۵ دقیقه کهنه می‌مانْد — سلبِ staff
 * یا تعلیق باید **در همان درخواستِ بعدی** اثر کند. هزینه‌اش اندازه گرفته شد (probe ۱٫۷): p50 ۰٫۴۶ms،
 * p99 ۰٫۸۸ms روی استخرِ گرم؛ برای staff (تعدادِ کم، حساسیتِ بالا) ارزان است. برای همه‌ی کاربران
 * **نمی‌کنیم** — به همین دلیل این‌جاست و نه داخلِ `requireAuth`.
 *
 * ★ **همه‌ی ردها ۴۰۳ی یک‌شکل‌اند** (غیرِ staff، staffِ معلق، کاربرِ حذف‌شده): هیچ‌کدام به بیرون
 * نمی‌گویند «staff هست ولی معلق است». علت فقط در لاگِ سرور است (`staffDenied`)، بدونِ PII.
 *
 * ── `requireStepUp`: پنجره‌ی per-user ─────────────────────────────────────
 *
 * `now − users.step_up_verified_at ≤ ADMIN_STEP_UP_SECONDS`؛ وگرنه **۴۲۸ `STEP_UP_REQUIRED`** —
 * کلاینت `POST /admin/step-up/{request,verify}` را می‌زند و دوباره تلاش می‌کند. ⚠️ per-user است
 * نه per-session (ADR-066 §۳؛ محدودیتِ ثبت‌شده). همان ردیفی را می‌خواند که `requireStaff` خوانده
 * (یک کوئری برای هر درخواست، نه دو) — پس **همیشه بعد از `requireStaff`**.
 */

export interface StaffContext {
  userId: string;
  /** آخرین step-upِ موفق — `null` یعنی هرگز. */
  stepUpVerifiedAt: Date | null;
}

declare module "fastify" {
  interface FastifyRequest {
    /** بعد از `requireStaff` پر است؛ قبلش `null`. */
    staff: StaffContext | null;
  }
}

export interface StaffGuardDeps {
  pool: pg.Pool;
  /** پنجره‌ی step-up (ثانیه) — `ADMIN_STEP_UP_SECONDS`. */
  stepUpSeconds: number;
  /** تزریق‌پذیر برای تست. */
  clock?: () => number;
}

interface StaffRow {
  is_staff: boolean;
  status: string;
  step_up_verified_at: Date | string | null;
}

/** ردیفِ staff را با یک کوئری می‌خواند؛ `null` یعنی «رد کن» (نبود، غیرِ staff، یا غیرِ فعال). */
export async function readStaff(
  pool: pg.Pool,
  userId: string,
): Promise<{ ok: true; ctx: StaffContext } | { ok: false; reason: string }> {
  const { rows } = await pool.query<StaffRow>(
    "SELECT is_staff, status, step_up_verified_at FROM users WHERE id = $1 AND deleted_at IS NULL",
    [userId],
  );
  const row = rows[0];
  if (row === undefined) return { ok: false, reason: "not_found" };
  if (!row.is_staff) return { ok: false, reason: "not_staff" };
  // ★ staffِ معلق هم ۴۰۳ — تعلیق در نقاطِ ورود fail-closed است (ADR-066 §۴) و پنل یک نقطه‌ی ورود است.
  if (row.status !== "active") return { ok: false, reason: `status_${row.status}` };
  const at = row.step_up_verified_at;
  return {
    ok: true,
    ctx: { userId, stepUpVerifiedAt: at === null ? null : at instanceof Date ? at : new Date(at) },
  };
}

/** آیا step-up داخلِ پنجره است؟ خالص، برای تست و برای پنل (`GET /admin/me`). */
export function stepUpFresh(
  stepUpVerifiedAt: Date | null,
  stepUpSeconds: number,
  nowMs: number,
): boolean {
  if (stepUpVerifiedAt === null) return false;
  const age = nowMs - stepUpVerifiedAt.getTime();
  return age >= 0 && age <= stepUpSeconds * 1000;
}

export function makeStaffGuards(deps: StaffGuardDeps): {
  requireStaff: preHandlerHookHandler;
  requireStepUp: preHandlerHookHandler;
} {
  const now = deps.clock ?? Date.now;

  const requireStaff: preHandlerHookHandler = async function requireStaff(req: FastifyRequest) {
    // ★ ترتیبِ preHandler مهم است: بدونِ `requireAuth` قبل از این، `authUser` خالی است ⇒ ۴۰۱.
    if (req.authUser === null) {
      throw new HttpError(401, "UNAUTHORIZED", "احراز هویت لازم است.");
    }
    const result = await readStaff(deps.pool, req.authUser.sub);
    if (!result.ok) {
      // P7: فقط علت، بدونِ شناسه‌ی کاربر (شناسه در reqِ pino هست، ولی این‌جا عمداً تکرار نمی‌شود).
      req.log.info({ staffDenied: result.reason }, "ردِ /admin");
      throw new HttpError(403, "FORBIDDEN", "این بخش فقط برای staff است.");
    }
    req.staff = result.ctx;
  };

  const requireStepUp: preHandlerHookHandler = async function requireStepUp(req: FastifyRequest) {
    if (req.staff === null) {
      // سیم‌کشیِ غلط (بدونِ requireStaff) — fail-closed، نه fail-open.
      throw new HttpError(401, "UNAUTHORIZED", "احراز هویت لازم است.");
    }
    if (!stepUpFresh(req.staff.stepUpVerifiedAt, deps.stepUpSeconds, now())) {
      throw new HttpError(
        428,
        "STEP_UP_REQUIRED",
        "برای این عمل تاییدِ دوباره لازم است: کدِ پیامکی را در پنل وارد کن.",
        { stepUpSeconds: deps.stepUpSeconds },
      );
    }
  };

  return { requireStaff, requireStepUp };
}
