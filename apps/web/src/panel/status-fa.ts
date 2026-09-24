import type { UserStatus } from "@hamboom/shared-types";

/** برچسبِ فارسیِ `users.status` — مشترکِ صفحه‌های پنل (جدا از کامپوننت‌ها برای Fast Refresh). */
export const STATUS_FA: Record<UserStatus, string> = {
  active: "فعال",
  suspended: "معلق",
  deleted: "حذف‌شده",
};
