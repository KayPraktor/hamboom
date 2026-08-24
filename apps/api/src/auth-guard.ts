import { TokenError, verifyAccessToken } from "@hamboom/auth-core";
import type { FastifyRequest, preHandlerHookHandler } from "fastify";

import { HttpError } from "./errors.ts";

/** هویتِ درخواست — از access token استخراج می‌شود (نه از بدنه). */
declare module "fastify" {
  interface FastifyRequest {
    authUser: { sub: string } | null;
  }
}

/**
 * سازنده‌ی preHandlerِ «توکنِ معتبر لازم است». روی مسیرهای محافظت‌شده گذاشته می‌شود؛ مسیرهای
 * عمومی (otp/*) آن را ندارند.
 *
 * ★ نقش را **حمل نمی‌کند** — فقط `sub`. نقشِ موثر جای دیگر با `effectiveBoardRole` محاسبه می‌شود
 * (ADR-012)، نه از توکن. `clock` تزریق‌پذیر برای تست.
 */
export function makeRequireAuth(secret: Uint8Array, clock?: () => number): preHandlerHookHandler {
  return async function requireAuth(req: FastifyRequest): Promise<void> {
    const header = req.headers.authorization;
    if (header === undefined || !header.startsWith("Bearer ")) {
      throw new HttpError(401, "UNAUTHORIZED", "توکنِ دسترسی لازم است.");
    }
    const token = header.slice("Bearer ".length);
    try {
      const { sub } = await verifyAccessToken(secret, token, clock);
      req.authUser = { sub };
    } catch (error) {
      // ★ علتِ دقیق (منقضی/امضا) به کلاینت لو نمی‌رود — همان fail-closedِ TokenError.
      const detail = error instanceof TokenError ? error.code : "unknown";
      req.log.info({ tokenError: detail }, "ردِ توکنِ access");
      throw new HttpError(401, "UNAUTHORIZED", "توکنِ دسترسی نامعتبر یا منقضی است.");
    }
  };
}

/** `sub`ِ درخواستِ احرازشده — بعد از `requireAuth` همیشه پر است. */
export function requireSub(req: FastifyRequest): string {
  if (req.authUser === null) {
    throw new HttpError(401, "UNAUTHORIZED", "احراز هویت لازم است.");
  }
  return req.authUser.sub;
}
