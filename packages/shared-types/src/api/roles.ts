import { z } from "zod";

/**
 * نقشِ کاربر روی یک بورد — منبعِ حقیقتِ `BoardRole` اینجاست
 * ([ADR-043](../../../../ARCHITECTURE_DECISIONS.md#adr-043)، [PLAN §۵٫۱](../../../../PLAN.md)).
 * `ydoc-schema` این آرایه را وارد می‌کند و برای پروتکلِ سیمش re-export می‌کند.
 *
 * ⚠️ **ترتیب معنا دارد:** روی سیمِ WSِ `ydoc-schema` با **ایندکس** می‌رود، پس فقط می‌شود به
 * **انتها** اضافه کرد — جابه‌جایی یعنی کلاینتِ قدیمی نقشِ اشتباه، بدترین باگِ مجوز. یک تست پینش می‌کند.
 */
export const boardRoles = ["owner", "editor", "commenter", "viewer"] as const;
export const boardRole = z.enum(boardRoles);
export type BoardRole = z.infer<typeof boardRole>;

/**
 * نقش‌های قابلِ‌تخصیص به عضوِ بورد در **M3** (ورودیِ `POST /boards/:id/members`).
 *
 * ★ `satisfies readonly BoardRole[]` تضمین می‌کند هر عضو **حتماً** یک `boardRole` است — یک
 * تایپوی «editer» یا نقشی که در `boardRoles` نباشد خطای کامپایل می‌دهد، پس واگرایی از
 * `boardRoles` **ساختاراً ناممکن** است (نه یک زیرمجموعه‌ی مستقل که ممکن است از قلم بیفتد).
 * ⚠️ `commenter` عمداً بیرون است: کامنت فاز ۱۰ است و در M2 مثلِ `viewer` fail-closed شد. در
 * `boardRoles` می‌مانَد (قراردادِ سیم)، ولی تخصیص‌ناپذیر است تا «نقشِ بی‌اثر» ساخته نشود.
 */
export const assignableBoardRoles = ["owner", "editor", "viewer"] as const satisfies readonly BoardRole[];
export const assignableBoardRole = z.enum(assignableBoardRoles);
export type AssignableBoardRole = z.infer<typeof assignableBoardRole>;

/** نقشِ کاربر در تیم — [PLAN §۵٫۱](../../../../PLAN.md). */
export const teamRoles = ["owner", "admin", "member", "guest"] as const;
export const teamRole = z.enum(teamRoles);
export type TeamRole = z.infer<typeof teamRole>;

/**
 * حالتِ دسترسیِ بورد — [PLAN §۵٫۱](../../../../PLAN.md).
 *
 * ⚠️ `link_comment` عمداً بیرون است (کامنت = فاز ۱۰). برخلافِ `boardRole` روی سیم با ایندکس
 * نمی‌رود، پس تمیز حذف شد و در فاز ۱۰ اضافه می‌شود؛ ستونِ DB `varchar` است.
 */
export const boardAccessModes = ["private", "team", "link_view", "link_edit"] as const;
export const boardAccessMode = z.enum(boardAccessModes);
export type BoardAccessMode = z.infer<typeof boardAccessMode>;
