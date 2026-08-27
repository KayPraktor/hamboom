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

export const patchMeBody = zod.object({
  displayName: zod.string().trim().min(1).max(80).optional(),
  locale: zod.enum(["fa", "en"]).optional(),
});

export const patchBoardBody = zod.object({
  title: zod.string().trim().min(1).max(200).optional(),
  // `null` یعنی «از فولدر خارج شود».
  folderId: zod.string().uuid().nullable().optional(),
});

// حالت‌های دسترسیِ بورد — هم‌تراز با `boardAccessModes`ِ shared-types (بدونِ link_comment).
const boardAccessMode = zod.enum(["private", "team", "link_view", "link_edit"]);

export const putAccessBody = zod.object({
  accessMode: boardAccessMode,
  /** اگر true، توکنِ لینک از نو ساخته می‌شود (لینکِ قبلی و مهمان‌هایش باطل). */
  regenerate: zod.boolean().optional(),
});

export const resolveLinkBody = zod.object({ linkToken: zod.string().min(10) });

// نقش‌های قابلِ‌تخصیصِ بورد — بدونِ `commenter` (نقشِ بی‌اثرِ فعلی، گام ۲٫۲).
const assignableBoardRole = zod.enum(["owner", "editor", "viewer"]);

export const addBoardMemberBody = zod.object({
  userId: zod.string().uuid("userId باید UUID باشد"),
  role: assignableBoardRole,
});

export const patchBoardMemberRoleBody = zod.object({ role: assignableBoardRole });

/** نقش‌های قابلِ‌تخصیص در تیم — نه `owner` (سازنده است، انتقالِ مالکیت جداست). */
const assignableTeamRole = zod.enum(["admin", "member", "guest"]);

export const createTeamBody = zod.object({
  name: zod.string().trim().min(1).max(120),
  slug: zod
    .string()
    .regex(/^[a-z0-9-]{2,50}$/, "slug فقط حروفِ کوچکِ لاتین/عدد/خط‌تیره، ۲ تا ۵۰ نویسه")
    .optional(),
});

export const patchTeamBody = zod.object({
  name: zod.string().trim().min(1).max(120).optional(),
});

export const patchMemberRoleBody = zod.object({ role: assignableTeamRole });

export const createInviteBody = zod
  .object({
    phone: iranMobile.optional(),
    email: zod.string().email("ایمیل نامعتبر").optional(),
    role: assignableTeamRole,
  })
  .refine((d) => d.phone !== undefined || d.email !== undefined, {
    message: "شماره یا ایمیل لازم است",
  });

export const createFolderBody = zod.object({
  name: zod.string().trim().min(1).max(120),
  parentId: zod.string().uuid().optional(),
});

export const patchFolderBody = zod.object({
  name: zod.string().trim().min(1).max(120).optional(),
});

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
