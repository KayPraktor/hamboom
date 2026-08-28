import type { z } from "zod";

import { HttpError } from "./errors.ts";

/**
 * ★ بدنه‌های درخواست حالا در `@hamboom/shared-types` (`src/api/requests.ts`) اند — **منبعِ واحدِ ورودی**
 * برای api (اعتبارسنجی) و `packages/sdk` (تایپِ ورودی)، گام ۶ (تاییدِ مالک). این‌جا فقط re-export می‌شوند تا
 * routeها بی‌تغییر بمانند، به‌علاوه‌ی ابزارِ محلیِ اعتبارسنجی (`parseBody`/`assertUuid`) که به `HttpError`ِ api گره خورده.
 */
export {
  addBoardMemberBody,
  createBoardBody,
  createFolderBody,
  createInviteBody,
  createTeamBody,
  otpRequestBody,
  otpVerifyBody,
  patchBoardBody,
  patchBoardMemberRoleBody,
  patchFolderBody,
  patchMemberRoleBody,
  patchMeBody,
  patchTeamBody,
  putAccessBody,
  resolveLinkBody,
} from "@hamboom/shared-types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** پارامترِ مسیر را UUID می‌سنجد یا `VALIDATION_ERROR` — وگرنه کوئریِ `uuid` روی PG می‌ترکد (۵۰۰). */
export function assertUuid(value: string, label = "شناسه"): void {
  if (!UUID_RE.test(value)) {
    throw new HttpError(400, "VALIDATION_ERROR", `${label} باید UUID باشد.`);
  }
}

/** بدنه را اعتبارسنجی می‌کند یا `VALIDATION_ERROR` می‌اندازد (اولین پیامِ خطا). */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const first = result.error.issues[0];
    throw new HttpError(400, "VALIDATION_ERROR", first?.message ?? "ورودی نامعتبر است.");
  }
  return result.data;
}
