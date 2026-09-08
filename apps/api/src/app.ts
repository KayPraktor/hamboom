import { randomUUID } from "node:crypto";

import fastifyCookie from "@fastify/cookie";
import fastifyRateLimit from "@fastify/rate-limit";
import { createAssetService } from "@hamboom/assets";
import { assertSmsProviderAllowed, createMockSmsProvider, maskPhone } from "@hamboom/auth-core";
import { assertGatewayAllowed, type PaymentGateway } from "@hamboom/billing-core";
import { assertProductionConfig } from "@hamboom/config";
import type { ObjectStore } from "@hamboom/storage";
import Fastify, { type FastifyInstance } from "fastify";
import type pg from "pg";

import { makeRequireAuth } from "./auth-guard.ts";
import { loadApiConfig, secretBytes, type ApiConfig } from "./config.ts";
import { registerErrorHandler } from "./errors.ts";
import { registerIdempotency } from "./idempotency.ts";
import { loggerOptions } from "./logger.ts";
import { createDbPool } from "./plugins/db.ts";
import { createPaymentGateway } from "./plugins/payment.ts";
import { registerReconcileJob } from "./plugins/reconcile.ts";
import { createAssetObjectStore, createSnapshotObjectStore } from "./plugins/s3.ts";
import { registerAssetRoutes } from "./routes/assets.ts";
import { registerBillingRoutes } from "./routes/billing.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import { registerBoardAccessRoutes } from "./routes/board-access.ts";
import { registerBoardRoutes } from "./routes/boards.ts";
import { registerDocsRoutes } from "./routes/docs.ts";
import { registerFolderRoutes } from "./routes/folders.ts";
import { registerMeRoutes } from "./routes/me.ts";
import { registerTeamRoutes } from "./routes/teams.ts";

/**
 * `buildApp()` — نمونه‌ی Fastifyِ **تست‌پذیر** (بدونِ `listen`). ماژول M3، فاز ۵.
 *
 * ★ همه‌ی وابستگی‌ها تزریق‌پذیرند (config، db) تا تست بدونِ شبکه اجرا شود.
 */

// ★ `app.db` — استخرِ pg. adapterها رویش سوارند.
declare module "fastify" {
  interface FastifyInstance {
    db: pg.Pool;
    /** فهرستِ مسیرهای ثبت‌شده (`METHOD url`) — گاردِ دریفتِ OpenAPI با این می‌سنجد. */
    registeredRoutes: string[];
  }
}

export interface BuildAppOptions {
  config?: ApiConfig;
  /** استخرِ db تزریق‌پذیر برای تست (وگرنه از config ساخته می‌شود و در onClose بسته می‌شود). */
  db?: pg.Pool;
  /** ObjectStoreِ باکتِ snapshots — تزریق‌پذیر تا تست بدونِ MinIO اجرا شود (وگرنه از config). */
  snapshots?: ObjectStore;
  /** ObjectStoreِ باکتِ assets — تزریق‌پذیر تا تست بدونِ MinIO اجرا شود (وگرنه از config). */
  assets?: ObjectStore;
  /** درگاهِ پرداخت — تزریق‌پذیر تا تست بدونِ شبکه (وگرنه از config، M4 فاز ۵). */
  gateway?: PaymentGateway;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadApiConfig();
  // ★★ روی configِ **حل‌شده**، نه فقط شاخه‌ی `??` — همان درسِ `assertGatewayAllowed`
  //    پایین: گیتی که فقط مسیرِ پیش‌فرض را ببیند، از تزریق رد می‌شود.
  assertProductionConfig(config);

  const app = Fastify({
    logger: loggerOptions(config.LOG_LEVEL),
    genReqId: () => randomUUID(),
  });
  app.decorateRequest("authUser", null);

  // ★ گاردِ دریفتِ OpenAPI: هر مسیرِ ثبت‌شده جمع می‌شود تا تست ثابت کند همه مستندند.
  //   قبل از ثبتِ هر route اضافه می‌شود (onRoute فقط routeهای بعد از خودش را می‌بیند). HEAD حذف.
  const registeredRoutes: string[] = [];
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const m of methods) if (m !== "HEAD") registeredRoutes.push(`${m} ${route.url}`);
  });
  app.decorate("registeredRoutes", registeredRoutes);

  registerErrorHandler(app);

  // کوکی (برای refreshِ HttpOnly) + محدودیتِ نرخ. قبل از routeها تا سراسری اعمال شوند.
  await app.register(fastifyCookie);
  // ★ خطای ۴۲۹ از راهِ setErrorHandler به شکلِ یکسانِ apiError نگاشت می‌شود (errors.ts).
  await app.register(fastifyRateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW_SECONDS * 1000,
  });

  // Idempotency-Key روی POSTهای احرازشده (گام ۵٫۵) — قبل از routeها تا سراسری اعمال شود.
  registerIdempotency(app, { ttlMs: 24 * 60 * 60 * 1000 });

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

  // ── مستندات (عمومی، بدونِ احراز): OpenAPI 3.1 + مرورگرِ سبک ──────────
  registerDocsRoutes(app);

  // ── وابستگی‌های احراز/OTP ───────────────────────────────────────────
  const secret = secretBytes(config);
  // ⚠️ کدِ ثابت فقط در dev و اگر داده شده باشد؛ وگرنه تصادفی.
  const fixedCode = config.APP_ENV === "local" ? config.OTP_DEV_FIXED_CODE : undefined;
  // ★ MockSms کدِ خام را در لاگِ سرور چاپ می‌کند (فقط dev، P3: بدونِ حسابِ پیامکِ واقعی)؛ شماره ماسک.
  const sms = createMockSmsProvider((phone, code) => {
    app.log.warn(`[SMS mock — فقط dev] کدِ ورود ${code} → ${maskPhone(phone)}`);
  });
  // ★★ گیتِ M5 گام ۴٫۱ — بدونِ آن، `APP_ENV=production` با پیامکِ **ساختگی** بالا می‌آید:
  //    هیچ کاربرِ واقعی نمی‌تواند وارد شود و کدِ ورود در لاگ می‌نشیند. در فاز ۲ با یک
  //    اجرای واقعی دیده شد (کد از لاگ خوانده شد، در حالی که APP_ENV=production بود).
  assertSmsProviderAllowed(sms, config.APP_ENV);

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

  // ── Object Storage (P4: فقط از راهِ @hamboom/storage) ───────────────
  // یک store به‌ازای هر باکت؛ تزریق‌پذیر تا تست بدونِ MinIO اجرا شود.
  const snapshots = options.snapshots ?? createSnapshotObjectStore(config);
  const assetStore = options.assets ?? createAssetObjectStore(config);
  // ★ fileId از نوعِ uuid ساخته می‌شود چون کلیدِ اصلیِ جدولِ `files` است.
  const assetService = createAssetService({
    objectStore: assetStore,
    maxBytes: config.UPLOAD_MAX_BYTES,
    newFileId: () => randomUUID(),
  });

  const requireAuth = makeRequireAuth(secret);
  registerMeRoutes(app, { pool, requireAuth });
  registerTeamRoutes(app, {
    pool,
    requireAuth,
    appEnv: config.APP_ENV,
    inviteTtlSeconds: 7 * 24 * 60 * 60, // ۷ روز
  });
  registerFolderRoutes(app, { pool, requireAuth });
  registerBoardRoutes(app, {
    pool,
    requireAuth,
    secret,
    rtTokenTtlSeconds: config.RT_TOKEN_TTL_SECONDS,
    snapshots,
  });
  registerBoardAccessRoutes(app, { pool, requireAuth });
  registerAssetRoutes(app, {
    pool,
    requireAuth,
    assets: assetService,
    assetStore,
    assetBucket: config.S3_BUCKET_ASSETS,
  });

  // ── پرداخت و اشتراک (M4 فاز ۵) ──────────────────────────────────────
  // ★★ گیت روی **درگاهِ حل‌شده** اجرا می‌شود، نه فقط روی شاخه‌ی `??`. نگارشِ اول
  //    `options.gateway ?? createPaymentGateway(config)` بود و چون گیت داخلِ
  //    `createPaymentGateway` است، یک درگاهِ **تزریق‌شده** کاملاً از آن رد می‌شد — یعنی
  //    دقیقاً همان ادعای «هر ورودی از یک گیت رد می‌شود» نقض می‌شد.
  const resolvedGateway = options.gateway ?? createPaymentGateway(config);
  assertGatewayAllowed(resolvedGateway, config.APP_ENV);
  // ★★ `createPaymentGateway` خودش `assertGatewayAllowed` را صدا می‌زند، پس اگر
  //    `APP_ENV=production` با `PAYMENT_PROVIDER=mock` بالا بیاید **همین‌جا** می‌شکند —
  //    نه سرِ اولین «پرداختِ رایگانِ موفق» در production (ADR-049).
  registerBillingRoutes(app, {
    pool,
    requireAuth,
    gateway: resolvedGateway,
    vatPercent: config.VAT_PERCENT,
    callbackUrl: config.ZARINPAL_CALLBACK_URL,
    webBaseUrl: config.WEB_BASE_URL,
    appEnv: config.APP_ENV,
    callbackRateLimit: {
      max: config.RATE_LIMIT_MAX,
      timeWindow: config.RATE_LIMIT_WINDOW_SECONDS * 1000,
    },
  });

  // ── آشتی‌دهیِ بازه‌ای (M4 فاز ۷) — **پیش‌فرض خاموش** ─────────────────
  // ★ بعد از routeها ثبت می‌شود چون همان درگاهِ حل‌شده را می‌گیرد؛ یک درگاهِ دوم یعنی
  //   احتمالِ اینکه sweep با درگاهی حرف بزند که پرداخت را نساخته است.
  registerReconcileJob(app, { pool, gateway: resolvedGateway, config });

  return app;
}
