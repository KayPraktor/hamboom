import { z } from "zod";

import { planLimits, planUsage, teamSubscriptionStatus } from "./billing.ts";
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
 * ★ **فاز ۵ی M4 چهار فیلدِ مالی را اضافه کرد** که M3 عمداً جا گذاشته بود. تاخیرش هم عمدی
 * بود: در فاز ۲ مصرف‌کننده داشتند ولی **منبعِ داده نداشتند** (seedِ پلن‌ها فاز ۴ آمد)، و
 * پُرکردنشان با مقدارِ ساختگی یعنی دروغ در قرارداد (M4-D2، ADR-021/ADR-053).
 *
 * ⚠️ `subscriptionStatus` از `teamSubscriptionStatus` می‌آید (شش مقدار، با `none` برای تیمِ
 * بی‌اشتراک)، نه از `subscriptionStatus`ِ خودِ اشتراک (پنج مقدار) — M4-D2a.
 * ⚠️ `limits` می‌تواند `-1` (نامحدود) داشته باشد ولی `usage` هرگز.
 */
export const team = z.object({
  id: uuid,
  slug: z.string(),
  name: z.string(),
  avatarUrl: z.url().nullable(),
  myRole: teamRole,
  memberCount: z.number().int().nonnegative(),
  planCode: z.string().min(1).max(30),
  subscriptionStatus: teamSubscriptionStatus,
  limits: planLimits,
  usage: planUsage,
  createdAt: isoDateTime,
});
export type Team = z.infer<typeof team>;
