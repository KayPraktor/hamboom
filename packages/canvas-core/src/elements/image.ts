import type { HbElement } from "@hamboom/shared-types";

import { buildBaseElement, resolveSeed, type ElementSeedOptions } from "./factory";

/**
 * تصویر — گام ۳٫۶.
 *
 * ── باینری اینجا نیست ─────────────────────────────────────────────────
 *
 * عنصر تصویر فقط یک **ارجاع** (`fileId`) به یک asset است؛ خودِ بایت‌ها هرگز
 * در عنصر یا در سند نیستند ([PLAN بخش ۷٫۱](../../../../PLAN.md)). بایت‌ها از
 * راه `outbound.requestAssetUpload` بالا می‌روند و برای رندر با
 * `outbound.resolveAssetUrl(fileId)` به موتور داده می‌شوند. سیم‌کشیِ این جریان
 * کار `tools/image-tool.ts` است؛ این فایل فقط عنصر خالص را می‌سازد.
 *
 * ── وضعیت ─────────────────────────────────────────────────────────────
 *
 * عنصر تازه با `status: "pending"` ساخته می‌شود تا موتور یک placeholder نشان
 * دهد، و پس از آماده‌شدن فایل به `"saved"` می‌رود. jsdom این رفتار را نشان
 * نمی‌دهد؛ در مرورگر تایید می‌شود.
 */

/** بیشینه‌ی حجم فایل سمت کلاینت (TODO ۳٫۶). منبع واحدِ عدد و پیام خطا. */
export const HB_IMAGE_MAX_MB = 20;
export const HB_IMAGE_MAX_BYTES = HB_IMAGE_MAX_MB * 1024 * 1024;

/** فرمت‌های مجاز سمت کلاینت (TODO ۳٫۶). */
export const HB_IMAGE_MIME_ALLOW = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
] as const;
export type HbImageMime = (typeof HB_IMAGE_MIME_ALLOW)[number];

/** بیشینه‌ی طولِ بلندترین ضلع هنگام درج، برای اینکه تصویر بزرگ کل بوم را نگیرد. */
export const HB_IMAGE_MAX_DISPLAY = 480;

export type ImageValidation =
  | { ok: true; mime: HbImageMime }
  | { ok: false; reason: "bad-type" | "too-large"; message: string };

/**
 * اعتبارسنجی سمت کلاینت — نوع MIME و حجم.
 *
 * خالص و مستقل از DOM (فقط `type` و `size` را می‌خواند) تا در jsdom هم آزمودنی
 * باشد. پیام‌ها فارسی‌اند چون مستقیم به کاربر نشان داده می‌شوند (P6).
 */
export function validateImageFile(file: { type: string; size: number }): ImageValidation {
  if (!(HB_IMAGE_MIME_ALLOW as readonly string[]).includes(file.type)) {
    return {
      ok: false,
      reason: "bad-type",
      message: `این فرمت پشتیبانی نمی‌شود: ${file.type || "نامشخص"}`,
    };
  }
  if (file.size > HB_IMAGE_MAX_BYTES) {
    return {
      ok: false,
      reason: "too-large",
      message: `حجم فایل بیش از حد مجاز است (بیشینه ${HB_IMAGE_MAX_MB} مگابایت)`,
    };
  }
  return { ok: true, mime: file.type as HbImageMime };
}

/**
 * ابعاد نمایش تصویر را با حفظ نسبت، داخل یک کادر بیشینه جا می‌دهد.
 *
 * اگر ابعاد طبیعی نامعلوم بود (`0`)، یک مربع پیش‌فرض برمی‌گرداند تا عنصر همچنان
 * قابل انتخاب و تغییر اندازه باشد.
 */
export function fitImageBox(
  naturalWidth: number,
  naturalHeight: number,
  max: number = HB_IMAGE_MAX_DISPLAY,
): { width: number; height: number } {
  if (naturalWidth <= 0 || naturalHeight <= 0) return { width: max, height: max };
  const longest = Math.max(naturalWidth, naturalHeight);
  if (longest <= max) return { width: naturalWidth, height: naturalHeight };
  const scale = max / longest;
  return {
    width: Math.round(naturalWidth * scale),
    height: Math.round(naturalHeight * scale),
  };
}

export interface CreateImageOptions extends ElementSeedOptions {
  fileId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  authorId: string;
  index?: string;
  status?: "pending" | "saved" | "error";
  scale?: [number, number];
}

/** ساخت یک عنصر تصویر خالص که به `fileId` ارجاع می‌دهد. */
export function createImage(options: CreateImageOptions): HbElement {
  const {
    fileId,
    x,
    y,
    width,
    height,
    authorId,
    index = "a0",
    status = "pending",
    scale = [1, 1],
    ...seedOptions
  } = options;

  const seed = resolveSeed(seedOptions);

  return {
    ...buildBaseElement({
      id: `img_${seed.makeId()}`,
      type: "image",
      x,
      y,
      width,
      height,
      index,
      kind: "image",
      authorId,
      seed,
    }),
    // تصویر حاشیه و پس‌زمینه ندارد؛ خودش پیکسل است.
    strokeColor: "transparent",
    backgroundColor: "transparent",
    roundness: null,
    fileId,
    scale,
    status,
    crop: null,
  } as unknown as HbElement;
}
