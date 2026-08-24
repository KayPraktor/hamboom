import {
  RefreshError,
  requestOtp,
  rotateSession,
  signAccessToken,
  startSession,
  verifyOtp,
  type OtpConfig,
  type OtpResult,
  type SmsProvider,
} from "@hamboom/auth-core";
import type { ApiErrorCode } from "@hamboom/shared-types";
import type { FastifyInstance } from "fastify";
import type pg from "pg";

import { createPgOtpStore } from "../adapters/otp-store.ts";
import { createPgSessionStore } from "../adapters/session-store.ts";
import { HttpError } from "../errors.ts";
import { withTransaction } from "../plugins/db.ts";
import { findOrCreateUserByPhone } from "../services/accounts.ts";

export interface AuthRouteDeps {
  pool: pg.Pool;
  sms: SmsProvider;
  otpConfig: OtpConfig;
  secret: Uint8Array;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}

/** خطای verifyOtpِ ناموفق → کدِ HTTP. */
function otpFailure(reason: Extract<OtpResult, { ok: false }>["reason"]): HttpError {
  const map: Record<typeof reason, { code: ApiErrorCode; msg: string }> = {
    no_challenge: { code: "OTP_INVALID", msg: "کدی برای این شماره درخواست نشده." },
    expired: { code: "OTP_EXPIRED", msg: "کد منقضی شده است." },
    locked: { code: "OTP_TOO_MANY", msg: "تلاشِ بیش از حد؛ دوباره کد بگیر." },
    mismatch: { code: "OTP_INVALID", msg: "کد نادرست است." },
  };
  const m = map[reason];
  return new HttpError(400, m.code, m.msg);
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  // ── درخواستِ OTP — ★ همیشه ۲۰۰ (ضدِ enumeration) ────────────────────
  app.post("/auth/otp/request", async (req) => {
    const body = req.body as { phone?: unknown } | undefined;
    if (typeof body?.phone !== "string" || body.phone.length < 5) {
      throw new HttpError(400, "VALIDATION_ERROR", "شماره‌ی موبایل لازم است.");
    }
    // requestOtp خودش همیشه موفق است؛ نبودِ کاربر لو نمی‌رود. کد hash می‌شود و خام فقط به sms می‌رود.
    await requestOtp(createPgOtpStore(deps.pool), deps.sms, body.phone, deps.otpConfig);
    return { ok: true };
  });

  // ── verify → کاربر/نشست/توکن ────────────────────────────────────────
  app.post("/auth/otp/verify", async (req) => {
    const body = req.body as { phone?: unknown; code?: unknown } | undefined;
    if (typeof body?.phone !== "string" || typeof body?.code !== "string") {
      throw new HttpError(400, "VALIDATION_ERROR", "شماره و کد لازم است.");
    }
    const { phone, code } = body;

    // ⚠️ verify **بیرونِ** تراکنشِ ساختِ کاربر: incrementAttempts روی خطا باید **بماند**، وگرنه
    //    قفلِ max-attempts هرگز فعال نمی‌شود. موفقیت → چالش consume می‌شود (روی همان استخر).
    const result = await verifyOtp(createPgOtpStore(deps.pool), phone, code, deps.otpConfig);
    if (!result.ok) throw otpFailure(result.reason);

    // موفق → کاربر/تیم/نشست اتمیک.
    const created = await withTransaction(deps.pool, async (tx) => {
      const account = await findOrCreateUserByPhone(tx, phone);
      const refreshToken = await startSession(createPgSessionStore(tx), account.userId, {
        ttlSeconds: deps.refreshTtlSeconds,
      });
      return { account, refreshToken };
    });

    const accessToken = await signAccessToken(
      deps.secret,
      created.account.userId,
      deps.accessTtlSeconds,
    );
    const { rows } = await deps.pool.query(
      "SELECT id, phone, display_name, locale FROM users WHERE id = $1",
      [created.account.userId],
    );

    // ⚠️ dev: refreshToken در بدنه برای curlِ دستی؛ در production کوکیِ HttpOnly (سخت‌سازیِ ۵٫۳).
    return {
      accessToken,
      refreshToken: created.refreshToken,
      isNewUser: created.account.isNewUser,
      personalTeamId: created.account.personalTeamId,
      user: rows[0] ?? null,
    };
  });

  // ── refresh چرخشی (اتمی + reuse detection) ──────────────────────────
  app.post("/auth/refresh", async (req) => {
    const body = req.body as { refreshToken?: unknown } | undefined;
    if (typeof body?.refreshToken !== "string") {
      throw new HttpError(400, "VALIDATION_ERROR", "refreshToken لازم است.");
    }
    const raw = body.refreshToken;

    let rotated;
    try {
      // ★★ کلِ find+markUsed+insert در یک تراکنش → SELECT FOR UPDATE واقعاً قفل می‌کند.
      rotated = await withTransaction(deps.pool, async (tx) =>
        rotateSession(createPgSessionStore(tx), raw, { ttlSeconds: deps.refreshTtlSeconds }),
      );
    } catch (error) {
      if (error instanceof RefreshError) {
        if (error.code === "reuse") {
          throw new HttpError(401, "TOKEN_REUSED", "استفاده‌ی مجدد شناسایی شد؛ کلِ نشست باطل شد.");
        }
        throw new HttpError(401, "UNAUTHORIZED", "refresh نامعتبر یا منقضی است.");
      }
      throw error;
    }

    const accessToken = await signAccessToken(deps.secret, rotated.sub, deps.accessTtlSeconds);
    return { accessToken, refreshToken: rotated.refreshToken };
  });
}
