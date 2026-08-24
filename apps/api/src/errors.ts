import type { ApiErrorCode } from "@hamboom/shared-types";
import type { FastifyError, FastifyInstance } from "fastify";

/**
 * قالبِ یکسانِ خطا — [PLAN §۵](../../../PLAN.md)، `apiError`ِ `shared-types`:
 * `{ error: { code, message, details?, requestId } }`.
 *
 * ★ **خطای ناشناخته هرگز جزئیات لو نمی‌دهد:** به `INTERNAL` + پیامِ عمومی نگاشت می‌شود و
 * علتِ واقعی فقط در **لاگِ سرور** می‌مانَد (مثلِ AuthErrorِ realtime). requestId پلِ ردیابی است.
 */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** میان‌برهای پرکاربرد. */
export const httpErrors = {
  unauthorized: (m = "احراز هویت لازم است.") => new HttpError(401, "UNAUTHORIZED", m),
  forbidden: (m = "به این منبع دسترسی ندارید.") => new HttpError(403, "FORBIDDEN", m),
  notFound: (code: ApiErrorCode = "NOT_FOUND", m = "یافت نشد.") => new HttpError(404, code, m),
  conflict: (code: ApiErrorCode, m: string) => new HttpError(409, code, m),
} as const;

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const requestId = req.id;

    if (err instanceof HttpError) {
      reply
        .code(err.statusCode)
        .send({ error: { code: err.code, message: err.message, details: err.details, requestId } });
      return;
    }

    // خطای اعتبارسنجیِ fastify/zod → ۴۰۰ بدونِ لو دادنِ ساختار.
    if (err.validation) {
      reply.code(400).send({
        error: { code: "VALIDATION_ERROR", message: "ورودی نامعتبر است.", requestId },
      });
      return;
    }

    // ناشناخته → ۵۰۰. علت فقط در لاگ (P7: err ممکن است داده‌ی حساس داشته باشد، ولی
    // به کلاینت نمی‌رود). پیام عمومی است.
    req.log.error({ err }, "unhandled error");
    reply.code(500).send({
      error: { code: "INTERNAL", message: "خطای داخلیِ سرور.", requestId },
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({
      error: { code: "NOT_FOUND", message: "مسیر یافت نشد.", requestId: req.id },
    });
  });
}
