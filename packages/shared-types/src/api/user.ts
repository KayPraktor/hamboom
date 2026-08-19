import { z } from "zod";

import { isoDateTime, locale, uuid } from "./primitives.ts";

/** نسخه‌ی سبکِ کاربر برای حضور و فهرستِ اعضا — [PLAN §۵٫۱](../../../../PLAN.md). */
export const userPublic = z.object({
  id: uuid,
  displayName: z.string(),
  avatarUrl: z.url().nullable(),
  /** رنگِ ثابتِ حضورِ کاربر روی بوم (#RRGGBB). */
  color: z.string(),
});
export type UserPublic = z.infer<typeof userPublic>;

/**
 * کاربر — [PLAN §۵٫۱](../../../../PLAN.md).
 *
 * ⚠️ `phone` و `email` هر دو nullable اند: احرازِ اصلی موبایل+OTP است و ایمیل مسیرِ دوم، پس
 * کاربرِ فقط-موبایل `email: null` دارد. قیدِ «حداقل یکی موجود باشد» ناوردای **ثبت‌نامِ سمتِ
 * سرور** است، نه شکلِ این DTOی خواندنی.
 */
export const user = z.object({
  id: uuid,
  phone: z.string().nullable(), // E.164
  phoneVerified: z.boolean(),
  email: z.email().nullable(),
  emailVerified: z.boolean(),
  displayName: z.string(),
  avatarUrl: z.url().nullable(),
  locale,
  createdAt: isoDateTime,
  lastSeenAt: isoDateTime.nullable(),
});
export type User = z.infer<typeof user>;
