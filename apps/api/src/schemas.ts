import type { z } from "zod";
import { z as zod } from "zod";

import { HttpError } from "./errors.ts";

/**
 * schema‌های بدنه‌ی درخواست‌ها (zod) — گام ۵٫۲ (سخت‌سازی). به‌جای چکِ دستیِ `typeof`.
 *
 * ★ اعتبارسنجیِ **فرمت** است، نه وجودِ کاربر: `otpRequest` روی شماره‌ی بدفرمت ۴۰۰ می‌دهد، ولی
 * requestOtp همچنان ضدِ enumeration است (روی شماره‌ی **درست‌فرمتِ** ثبت‌نشده هم ۲۰۰).
 */

const iranMobile = zod
  .string()
  .regex(/^09\d{9}$/, "شماره‌ی موبایلِ ایران باید ۱۱ رقم و با ۰۹ آغاز شود");

export const otpRequestBody = zod.object({ phone: iranMobile });

export const otpVerifyBody = zod.object({
  phone: iranMobile,
  code: zod.string().regex(/^\d{6}$/, "کد باید ۶ رقم باشد"),
});

export const createBoardBody = zod.object({
  title: zod.string().trim().min(1).max(200).optional(),
  teamId: zod.string().uuid("teamId باید UUID باشد").optional(),
});

/** بدنه را اعتبارسنجی می‌کند یا `VALIDATION_ERROR` می‌اندازد (اولین پیامِ خطا). */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const first = result.error.issues[0];
    throw new HttpError(400, "VALIDATION_ERROR", first?.message ?? "ورودی نامعتبر است.");
  }
  return result.data;
}
