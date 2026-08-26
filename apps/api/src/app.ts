import { randomUUID } from "node:crypto";

import fastifyCookie from "@fastify/cookie";
import fastifyRateLimit from "@fastify/rate-limit";
import { createMockSmsProvider, maskPhone } from "@hamboom/auth-core";
import Fastify, { type FastifyInstance } from "fastify";
import type pg from "pg";

import { makeRequireAuth } from "./auth-guard.ts";
import { loadApiConfig, secretBytes, type ApiConfig } from "./config.ts";
import { registerErrorHandler } from "./errors.ts";
import { loggerOptions } from "./logger.ts";
import { createDbPool } from "./plugins/db.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import { registerBoardRoutes } from "./routes/boards.ts";

/**
 * `buildApp()` — نمونه‌ی Fastifyِ **تست‌پذیر** (بدونِ `listen`). ماژول M3، فاز ۵.
 *
 * ★ همه‌ی وابستگی‌ها تزریق‌پذیرند (config، db) تا تست بدونِ شبکه اجرا شود.
 */

// ★ `app.db` — استخرِ pg. adapterها رویش سوارند.
declare module "fastify" {
  interface FastifyInstance {
    db: pg.Pool;
  }
}

export interface BuildAppOptions {
  config?: ApiConfig;
  /** استخرِ db تزریق‌پذیر برای تست (وگرنه از config ساخته می‌شود و در onClose بسته می‌شود). */
  db?: pg.Pool;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadApiConfig();

  const app = Fastify({
    logger: loggerOptions(config.LOG_LEVEL),
    genReqId: () => randomUUID(),
  });
  app.decorateRequest("authUser", null);

  registerErrorHandler(app);

  // کوکی (برای refreshِ HttpOnly) + محدودیتِ نرخ. قبل از routeها تا سراسری اعمال شوند.
  await app.register(fastifyCookie);
  // ★ خطای ۴۲۹ از راهِ setErrorHandler به شکلِ یکسانِ apiError نگاشت می‌شود (errors.ts).
  await app.register(fastifyRateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW_SECONDS * 1000,
  });

  const ownsPool = options.db === undefined;
  const pool =
    options.db ??
    createDbPool({
      connectionString: config.DATABASE_URL,
      ssl: config.DATABASE_SSL,
      poolMax: config.DATABASE_POOL_MAX,
    });
  app.decorate("db", pool);
  if (ownsPool) {
    app.addHook("onClose", async () => {
      await pool.end();
    });
  }

  // ── سلامت ──────────────────────────────────────────────────────────
  app.get("/healthz", () => ({ status: "ok" }));
  app.get("/readyz", async (_req, reply) => {
    try {
      await pool.query("SELECT 1");
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "not_ready" });
    }
  });

  // ── وابستگی‌های احراز/OTP ───────────────────────────────────────────
  const secret = secretBytes(config);
  // ⚠️ کدِ ثابت فقط در dev و اگر داده شده باشد؛ وگرنه تصادفی.
  const fixedCode = config.APP_ENV === "local" ? config.OTP_DEV_FIXED_CODE : undefined;
  // ★ MockSms کدِ خام را در لاگِ سرور چاپ می‌کند (فقط dev، P3: بدونِ حسابِ پیامکِ واقعی)؛ شماره ماسک.
  const sms = createMockSmsProvider((phone, code) => {
    app.log.warn(`[SMS mock — فقط dev] کدِ ورود ${code} → ${maskPhone(phone)}`);
  });

  registerAuthRoutes(app, {
    pool,
    sms,
    otpConfig: {
      ttlSeconds: config.OTP_TTL_SECONDS,
      maxAttempts: config.OTP_MAX_ATTEMPTS,
      cooldownSeconds: config.OTP_COOLDOWN_SECONDS,
      fixedCode,
    },
    secret,
    accessTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
    refreshTtlSeconds: config.REFRESH_TOKEN_TTL_SECONDS,
    appEnv: config.APP_ENV,
    otpRateLimit: {
      max: config.RATE_LIMIT_OTP_MAX,
      timeWindow: config.RATE_LIMIT_WINDOW_SECONDS * 1000,
    },
  });

  registerBoardRoutes(app, { pool, requireAuth: makeRequireAuth(secret) });

  return app;
}
