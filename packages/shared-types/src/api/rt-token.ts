import { z } from "zod";

import { boardRole } from "./roles.ts";

/**
 * claimهای توکنِ اتصالِ WebSocket (`rtToken`) — قراردادِ **مشترکِ** صادرکننده
 * (`apps/api` endpointِ rt-token) و مصرف‌کننده (`apps/realtime`/`auth-core`).
 * [ADR-042](../../../../ARCHITECTURE_DECISIONS.md#adr-042)، [PLAN §۵٫۳](../../../../PLAN.md).
 *
 * ⚠️ **`exp` بر حسبِ ثانیه‌ی یونیکس است** (قراردادِ JWT، RFC 7519) — تنها جای پروژه که زمان
 * ثانیه است، پس تبدیل باید صریح باشد. probe ۱٫۳ نشان داد اگر صادرکننده اشتباهاً ms بنویسد،
 * توکن عملاً هرگز منقضی نمی‌شود؛ پس **`verify`ِ auth-core (فاز ۴) علاوه بر انقضا یک سقفِ آینده
 * روی `exp` می‌گذارد** (rt-token ۶۰ثانیه‌ای است). این schema فقط **شکل** را می‌بندد؛ سقف runtime است.
 *
 * ⚠️ `sub` (شناسه‌ی کاربر) **PII است** — خام لاگ نشود (P7). `role` کاملِ `boardRole` است.
 */
export const rtTokenClaims = z.object({
  sub: z.string().min(1),
  boardId: z.string().min(1),
  role: boardRole,
  exp: z.number().int().positive(),
});
export type RtTokenClaims = z.infer<typeof rtTokenClaims>;
