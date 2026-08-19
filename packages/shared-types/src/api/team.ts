import { z } from "zod";

import { isoDateTime, uuid } from "./primitives.ts";
import { teamRole } from "./roles.ts";
import { userPublic } from "./user.ts";

/** عضوِ تیم — [PLAN §۵٫۱](../../../../PLAN.md). */
export const teamMember = z.object({
  user: userPublic,
  role: teamRole,
  joinedAt: isoDateTime,
  invitedBy: uuid.nullable(),
});
export type TeamMember = z.infer<typeof teamMember>;

/**
 * تیم (ورک‌اسپیس) — [PLAN §۵٫۱](../../../../PLAN.md).
 *
 * ⚠️ **نسخه‌ی لاغرِ M3:** فیلدهای مالی (`planCode`، `subscriptionStatus`، `limits`، `usage`)
 * عمداً حذف شده‌اند — مصرف‌کننده‌شان **M4 (billing)** است و طبق اصلِ پروژه چیزی بدونِ
 * مصرف‌کننده اضافه نمی‌شود.
 */
export const team = z.object({
  id: uuid,
  slug: z.string(),
  name: z.string(),
  avatarUrl: z.url().nullable(),
  myRole: teamRole,
  memberCount: z.number().int().nonnegative(),
  createdAt: isoDateTime,
});
export type Team = z.infer<typeof team>;
