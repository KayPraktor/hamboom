import { z } from "zod";

/**
 * متادیتای فایل روی بوم.
 *
 * ⚠️ **باینری هرگز اینجا نیست.** سند Yjs فقط این متادیتا را نگه می‌دارد؛ خود
 * فایل در Object Storage است و کلاینت با `GET /api/v1/assets/:fileId` یک URL
 * امضاشده می‌گیرد ([PLAN بخش ۷٫۳](../../../../PLAN.md)).
 *
 * دلیل: base64 کردن یک تصویر داخل CRDT، سند را چند مگابایت می‌کند و آن حجم
 * با هر بار sync بین همه‌ی کاربران رد و بدل می‌شود.
 */
export const hbAsset = z.object({
  fileId: z.string().min(1),
  bucket: z.string(),
  /** کلید کامل در bucket — شامل مسیر تیم و بورد. */
  key: z.string(),
  mime: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sizeBytes: z.number().int().nonnegative(),
  /** برای دی‌دوپ در سطح تیم. */
  sha256: z.string().length(64).nullable(),
  uploadedBy: z.string(),
  createdAt: z.number().int(),
});
export type HbAsset = z.infer<typeof hbAsset>;

/** نوع‌های تصویری مجاز — در سرور هم دوباره اعتبارسنجی می‌شود. */
export const HB_ALLOWED_IMAGE_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
] as const;

export const hbAllowedImageMime = z.enum(HB_ALLOWED_IMAGE_MIME);
export type HbAllowedImageMime = z.infer<typeof hbAllowedImageMime>;
