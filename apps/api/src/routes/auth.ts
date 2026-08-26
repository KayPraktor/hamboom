import {
  RefreshError,
  requestOtp,
  rotateSession,
  signAccessToken,
  startSession,
  verifyOtp,
  type OtpConfig,
  type OtpResult,
  type RotateResult,
  type SmsProvider,
} from "@hamboom/auth-core";
import type { ApiErrorCode } from "@hamboom/shared-types";
import type { FastifyInstance, FastifyReply } from "fastify";
import type pg from "pg";

import { createPgOtpStore } from "../adapters/otp-store.ts";
import { createPgSessionStore } from "../adapters/session-store.ts";
import { HttpError } from "../errors.ts";
import { withTransaction } from "../plugins/db.ts";
import { otpRequestBody, otpVerifyBody, parseBody } from "../schemas.ts";
import { findOrCreateUserByPhone } from "../services/accounts.ts";

const REFRESH_COOKIE = "refresh_token";

export interface AuthRouteDeps {
  pool: pg.Pool;
  sms: SmsProvider;
  otpConfig: OtpConfig;
  secret: Uint8Array;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  /** `local` → کوکیِ ناامن + بازتابِ refresh در بدنه (curlِ دستی)؛ وگرنه فقط کوکیِ Secure. */
  appEnv: string;
  otpRateLimit: { max: number; timeWindow: number };
}

/** ★ refresh را در کوکیِ HttpOnly می‌گذارد — JS مرورگر نمی‌تواند بخواندش (ضدِ XSS-سرقتِ توکن). */
function setRefreshCookie(reply: FastifyReply, deps: AuthRouteDeps, token: string): void {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: deps.appEnv !== "local", // production: فقط https
    sameSite: "lax",
    path: "/auth",
    maxAge: deps.refreshTtlSeconds,
  });
}

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
  // ── درخواستِ OTP — ★ همیشه ۲۰۰ (ضدِ enumeration)، با محدودیتِ نرخِ سخت‌تر ──
  app.post(
    "/auth/otp/request",
    { config: { rateLimit: { max: deps.otpRateLimit.max, timeWindow: deps.otpRateLimit.timeWindow } } },
    async (req) => {
      const { phone } = parseBody(otpRequestBody, req.body);
      await requestOtp(createPgOtpStore(deps.pool), deps.sms, phone, deps.otpConfig);
      return { ok: true };
    },
  );

  // ── verify → کاربر/نشست/توکن ────────────────────────────────────────
  app.post("/auth/otp/verify", async (req, reply) => {
    const { phone, code } = parseBody(otpVerifyBody, req.body);

    // ⚠️ verify بیرونِ tx تا incrementAttempts روی خطا بماند (قفلِ max-attempts).
    const result = await verifyOtp(createPgOtpStore(deps.pool), phone, code, deps.otpConfig);
    if (!result.ok) throw otpFailure(result.reason);

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

    setRefreshCookie(reply, deps, created.refreshToken);
    return {
      accessToken,
      // ★ فقط در dev بدنه هم refresh دارد (curl)؛ در production کوکیِ HttpOnly تنها راه است.
      refreshToken: deps.appEnv === "local" ? created.refreshToken : undefined,
      isNewUser: created.account.isNewUser,
      personalTeamId: created.account.personalTeamId,
      user: rows[0] ?? null,
    };
  });

  // ── refresh چرخشی (اتمی + reuse detection) — از کوکی، یا بدنه در dev ──
  //
  // ⚠️ تراکنش **دستی** (نه withTransaction): در reuse باید `burnFamily` را **commit** کنیم بعد خطا
  //    (اگر throw به rollback برسد، سوزاندن برمی‌گردد — باگی که تستِ دستیِ مالک روی PG گرفت).
  app.post("/auth/refresh", async (req, reply) => {
    const cookieToken = req.cookies[REFRESH_COOKIE];
    const bodyToken = (req.body as { refreshToken?: unknown } | undefined)?.refreshToken;
    const raw = cookieToken ?? (typeof bodyToken === "string" ? bodyToken : undefined);
    if (raw === undefined) {
      throw new HttpError(400, "VALIDATION_ERROR", "refresh token لازم است (کوکی یا بدنه).");
    }

    const client = await deps.pool.connect();
    try {
      await client.query("BEGIN");
      let rotated: RotateResult;
      try {
        rotated = await rotateSession(createPgSessionStore(client), raw, {
          ttlSeconds: deps.refreshTtlSeconds,
        });
      } catch (error) {
        if (error instanceof RefreshError) {
          if (error.code === "reuse") {
            await client.query("COMMIT"); // سوزاندنِ خانواده باید بماند
            reply.clearCookie(REFRESH_COOKIE, { path: "/auth" });
            throw new HttpError(401, "TOKEN_REUSED", "استفاده‌ی مجدد شناسایی شد؛ کلِ نشست باطل شد.");
          }
          await client.query("ROLLBACK");
          throw new HttpError(401, "UNAUTHORIZED", "refresh نامعتبر یا منقضی است.");
        }
        await client.query("ROLLBACK");
        throw error;
      }
      await client.query("COMMIT");
      const accessToken = await signAccessToken(deps.secret, rotated.sub, deps.accessTtlSeconds);
      setRefreshCookie(reply, deps, rotated.refreshToken);
      return {
        accessToken,
        refreshToken: deps.appEnv === "local" ? rotated.refreshToken : undefined,
      };
    } finally {
      client.release();
    }
  });
}
