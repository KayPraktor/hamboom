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
import { createHash } from "node:crypto";
import type pg from "pg";

import { createPgOtpStore } from "../adapters/otp-store.ts";
import { createPgSessionStore } from "../adapters/session-store.ts";
import { toUser, USER_COLUMNS, type UserRow } from "../dto.ts";
import { HttpError } from "../errors.ts";
import { withTransaction, type Executor } from "../plugins/db.ts";
import { otpRequestBody, otpVerifyBody, parseBody } from "../schemas.ts";
import { findOrCreateUserByPhone } from "../services/accounts.ts";

const REFRESH_COOKIE = "refresh_token";

/**
 * ★ تعلیق در نقاطِ ورود — M6 ۵٫۲ ([ADR-066](../../../../ARCHITECTURE_DECISIONS.md#adr-066) §۴).
 *
 * probe ۱٫۲ی M6 با عدد نشان داد `users.status='suspended'` تا آن روز **هیچ‌جا** enforce نمی‌شد: refresh توکنِ
 * نو می‌داد، OTP پیامک می‌فرستاد. حالا: درخواستِ OTP برای شماره‌ی معلق **۲۰۰ی بی‌صدا** است — نه چالش، نه
 * پیامک (ضدِ enumeration نشکند: بیرون نمی‌فهمد این شماره معلق است یا اصلاً نیست) · refresh **۴۰۱
 * `USER_SUSPENDED`** با پاک‌کردنِ کوکی، پیش از چرخش. خودِ توکن‌ها هم در لحظه‌ی تعلیق سوخته‌اند
 * (`revokeAllForUser`)؛ این چک برای **پیامِ راست‌گو** به کلاینت است، نه تنها سد. ⚠️ access-tokenِ ۱۵دقیقه‌ای
 * تا انقضا پذیرفته می‌شود و WSِ باز تا reconnect می‌مانَد — محدودیتِ ثبت‌شده، سنجه‌ی `admin:access`.
 */
async function phoneIsSuspended(pool: pg.Pool, phone: string): Promise<boolean> {
  const { rows } = await pool.query<{ status: string }>(
    "SELECT status FROM users WHERE phone = $1 AND deleted_at IS NULL",
    [phone],
  );
  return rows[0]?.status === "suspended";
}

/**
 * وضعیتِ صاحبِ یک refresh token — **مستقل از `revoked_at`** (ردیفِ سوخته‌ی کاربرِ معلق هم باید «معلق» بگوید).
 *
 * ★ **داخلِ تراکنشِ چرخش و با `FOR SHARE` روی ردیفِ کاربر** (یافته‌ی بازبینیِ ۵٫۵): تعلیق همان ردیف را `FOR UPDATE`
 * می‌گیرد، پس یا این خواندن پشتِ تعلیق می‌ایستد و «معلق» می‌بیند، یا تعلیق پشتِ این تراکنش می‌ایستد و ردیفِ
 * نشستِ نو را هم می‌سوزاند. با خواندنِ **بیرونِ** تراکنش (نسخه‌ی اول) یک refreshِ هم‌زمان می‌توانست بعد از
 * `revokeAllForUser` یک نشستِ زنده جا بگذارد.
 */
async function refreshOwnerSuspended(tx: Executor, rawToken: string): Promise<boolean> {
  const { rows } = await tx.query<{ status: string }>(
    `SELECT u.status FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.refresh_token_hash = $1
      FOR SHARE OF u`,
    [createHash("sha256").update(rawToken).digest("hex")],
  );
  return rows[0]?.status === "suspended";
}

/** وضعیتِ یک کاربر با قفلِ مشترک — پشتِ تعلیقِ هم‌زمان می‌ایستد (همان استدلالِ بالا، برای verify). */
async function userSuspendedForShare(tx: Executor, userId: string): Promise<boolean> {
  const { rows } = await tx.query<{ status: string }>(
    "SELECT status FROM users WHERE id = $1 FOR SHARE",
    [userId],
  );
  return rows[0]?.status === "suspended";
}

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

/** نگاشتِ شکستِ OTP به خطای HTTP — مشترکِ ورود و step-upِ پنل (M6 فاز ۳، همان کدها). */
export function otpFailure(reason: Extract<OtpResult, { ok: false }>["reason"]): HttpError {
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
    {
      config: {
        rateLimit: { max: deps.otpRateLimit.max, timeWindow: deps.otpRateLimit.timeWindow },
      },
    },
    async (req) => {
      const { phone } = parseBody(otpRequestBody, req.body);
      // ★ معلق ⇒ همان ۲۰۰، بدونِ چالش و بدونِ پیامک (ADR-066 §۴). فقط یک لاگِ بدونِ PII.
      if (await phoneIsSuspended(deps.pool, phone)) {
        req.log.info({ otpSuppressed: "suspended" }, "درخواستِ OTPِ کاربرِ معلق — بی‌صدا");
        return { ok: true };
      }
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
      // ★ سومین نقطه‌ی ورود (یافته‌ی بازبینیِ ۵٫۵): چالشی که پیش از تعلیق ساخته شده بود (TTL ۱۲۰s) نباید بعدش
      //   نشست بسازد. کد قبلاً مصرف شده و کاربر مالکِ شماره است ⇒ گفتنِ «معلق» این‌جا enumeration نیست.
      if (await userSuspendedForShare(tx, account.userId)) {
        throw new HttpError(401, "USER_SUSPENDED", "این حساب معلق شده است.");
      }
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
    const { rows } = await deps.pool.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
      [created.account.userId],
    );

    setRefreshCookie(reply, deps, created.refreshToken);
    return {
      accessToken,
      // ★ فقط در dev بدنه هم refresh دارد (curl)؛ در production کوکیِ HttpOnly تنها راه است.
      refreshToken: deps.appEnv === "local" ? created.refreshToken : undefined,
      isNewUser: created.account.isNewUser,
      personalTeamId: created.account.personalTeamId,
      user: rows[0] ? toUser(rows[0]) : null,
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
      // ★ پیش از چرخش و **داخلِ همین تراکنش**: صاحبِ توکن معلق است؟ ⇒ ۴۰۱ی راست‌گو + کوکی پاک (ADR-066 §۴).
      if (await refreshOwnerSuspended(client, raw)) {
        await client.query("ROLLBACK");
        reply.clearCookie(REFRESH_COOKIE, { path: "/auth" });
        throw new HttpError(401, "USER_SUSPENDED", "این حساب معلق شده است.");
      }
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
            throw new HttpError(
              401,
              "TOKEN_REUSED",
              "استفاده‌ی مجدد شناسایی شد؛ کلِ نشست باطل شد.",
            );
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
