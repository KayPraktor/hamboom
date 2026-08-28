import { z } from "zod";

import { assignableBoardRole, boardAccessMode } from "./roles.ts";

/**
 * قراردادِ بدنه‌ی درخواست‌ها (zod) — منبعِ **واحدِ ورودی** برای `apps/api` (اعتبارسنجیِ زمانِ اجرا) و
 * `packages/sdk` (تایپِ ورودی). گام ۶ (تاییدِ دسته‌ایِ مالک — sdk حالا مصرف‌کننده‌شان است، ADR-021/M3-D2).
 *
 * ★ اینجا فقط **فرمت** سنجیده می‌شود، نه وجودِ منبع یا دسترسی — آن‌ها اعتبارِ تجاری‌اند و کارِ `apps/api`.
 * تا این نبود، هر بدنه یا در api دستی `typeof` می‌شد یا در sdk دوباره تعریف می‌شد؛ حالا یک تعریف، دو مصرف.
 */

const iranMobile = z
  .string()
  .regex(/^09\d{9}$/, "شماره‌ی موبایلِ ایران باید ۱۱ رقم و با ۰۹ آغاز شود");

/** نقش‌های قابلِ‌تخصیص در تیم — نه `owner` (سازنده است، انتقالِ مالکیت جداست). */
const assignableTeamRole = z.enum(["admin", "member", "guest"]);

export const otpRequestBody = z.object({ phone: iranMobile });
export type OtpRequestBody = z.infer<typeof otpRequestBody>;

export const otpVerifyBody = z.object({
  phone: iranMobile,
  code: z.string().regex(/^\d{6}$/, "کد باید ۶ رقم باشد"),
});
export type OtpVerifyBody = z.infer<typeof otpVerifyBody>;

export const patchMeBody = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  locale: z.enum(["fa", "en"]).optional(),
});
export type PatchMeBody = z.infer<typeof patchMeBody>;

export const createTeamBody = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .regex(/^[a-z0-9-]{2,50}$/, "slug فقط حروفِ کوچکِ لاتین/عدد/خط‌تیره، ۲ تا ۵۰ نویسه")
    .optional(),
});
export type CreateTeamBody = z.infer<typeof createTeamBody>;

export const patchTeamBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
});
export type PatchTeamBody = z.infer<typeof patchTeamBody>;

export const patchMemberRoleBody = z.object({ role: assignableTeamRole });
export type PatchMemberRoleBody = z.infer<typeof patchMemberRoleBody>;

export const createInviteBody = z
  .object({
    phone: iranMobile.optional(),
    email: z.string().email("ایمیل نامعتبر").optional(),
    role: assignableTeamRole,
  })
  .refine((d) => d.phone !== undefined || d.email !== undefined, {
    message: "شماره یا ایمیل لازم است",
  });
export type CreateInviteBody = z.infer<typeof createInviteBody>;

export const createFolderBody = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: z.string().uuid().optional(),
});
export type CreateFolderBody = z.infer<typeof createFolderBody>;

export const patchFolderBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
});
export type PatchFolderBody = z.infer<typeof patchFolderBody>;

export const createBoardBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  teamId: z.string().uuid("teamId باید UUID باشد").optional(),
});
export type CreateBoardBody = z.infer<typeof createBoardBody>;

export const patchBoardBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  /** `null` یعنی «از فولدر خارج شود». */
  folderId: z.string().uuid().nullable().optional(),
});
export type PatchBoardBody = z.infer<typeof patchBoardBody>;

export const putAccessBody = z.object({
  accessMode: boardAccessMode,
  /** اگر true، توکنِ لینک از نو ساخته می‌شود (لینکِ قبلی و مهمان‌هایش باطل). */
  regenerate: z.boolean().optional(),
});
export type PutAccessBody = z.infer<typeof putAccessBody>;

export const resolveLinkBody = z.object({ linkToken: z.string().min(10) });
export type ResolveLinkBody = z.infer<typeof resolveLinkBody>;

export const addBoardMemberBody = z.object({
  userId: z.string().uuid("userId باید UUID باشد"),
  role: assignableBoardRole,
});
export type AddBoardMemberBody = z.infer<typeof addBoardMemberBody>;

export const patchBoardMemberRoleBody = z.object({ role: assignableBoardRole });
export type PatchBoardMemberRoleBody = z.infer<typeof patchBoardMemberRoleBody>;
