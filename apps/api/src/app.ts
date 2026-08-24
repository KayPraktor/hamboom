import { randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import type pg from "pg";

import { loadApiConfig, type ApiConfig } from "./config.ts";
import { registerErrorHandler } from "./errors.ts";
import { loggerOptions } from "./logger.ts";
import { createDbPool } from "./plugins/db.ts";

/**
 * `buildApp()` — نمونه‌ی Fastifyِ **تست‌پذیر** (بدونِ `listen`). ماژول M3، گام ۵٫۱.
 *
 * ★ همه‌ی وابستگی‌ها **تزریق‌پذیر**اند (config، db) تا تست بدونِ دیتابیس/شبکه اجرا شود —
 * همان الگوی «binder قبل از سرور»ی M2 روی سطحِ HTTP. redactِ P7 در `loggerOptions` است و
 * مستقلاً در `logger.test.ts` روی pino آزموده می‌شود.
 */

// ★ `app.db` — استخرِ pg. تزریقِ adapterهای فاز ۵٫۲ رویش سوار می‌شوند.
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

  registerErrorHandler(app);

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
  // ⚠️ healthz فقط «سرور بالاست» (K8s liveness)؛ readyz وابستگی را می‌سنجد (readiness) —
  //    همان تفکیکی که realtime در گام ۴٫۸ قفل کرد (در خاموشی readyz رد می‌کند، healthz نه).
  app.get("/healthz", () => ({ status: "ok" }));

  app.get("/readyz", async (_req, reply) => {
    try {
      await pool.query("SELECT 1");
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "not_ready" });
    }
  });

  return app;
}
