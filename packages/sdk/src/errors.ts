/**
 * خطای برگشتی از api — قالبِ یکسانِ §۵ (`{ error: { code, message, requestId } }`) + وضعیتِ HTTP.
 *
 * ★ فیلدهای **صریح** (نه parameter property) — sdk هم زیرِ Node (تست/SSR) اجرا می‌شود و strip-only
 * پارامتر-پراپرتی را نمی‌پذیرد (همان درسِ `errors.ts`ِ api / `auth-core`).
 */
export class SdkError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, requestId?: string, details?: unknown) {
    super(message);
    this.name = "SdkError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}
