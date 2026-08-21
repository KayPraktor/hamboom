import { z } from "zod";

import { hbAllowedImageMime } from "../canvas/asset.ts";

/**
 * قراردادِ آپلودِ دارایی — [PLAN §۵٫۲](../../../../PLAN.md)، گام ۳٫۳ی M3.
 *
 * جریان: کلاینت `presign` می‌خواهد → مستقیم به Object Storage آپلود می‌کند → `commit` می‌زند و
 * **سرور بایت‌های واقعی را می‌سنجد**. متادیتای نهایی `HbAsset` است ([canvas/asset.ts](../canvas/asset.ts)).
 *
 * ⚠️ پاسخ **`{ url, fields }`** است، نه `{ uploadUrl, headers }` — probe ۳٫۰ ثابت کرد presigned PUT
 * سقفِ اندازه را اعمال نمی‌کند؛ مکانیزم **POST-policy** با `content-length-range` است
 * (PLAN §۵٫۲ یادداشتِ ۱). فیلدِ `file` باید آخرین فیلدِ فرم باشد.
 */

/** بدنه‌ی `POST /boards/:boardId/assets/presign`. */
export const assetPresignRequest = z.object({
  mimeType: hbAllowedImageMime,
  sizeBytes: z.number().int().positive(),
  /**
   * ادعای کلاینت درباره‌ی هشِ فایل. ★ سرور در `commit` این را **مستقلاً روی بایت‌های
   * واقعی بازمحاسبه و مقایسه** می‌کند — به ادعا اعتماد نمی‌شود (قیدِ مالک ۱۴۰۵/۰۵/۲۸).
   */
  sha256: z.string().length(64),
});
export type AssetPresignRequest = z.infer<typeof assetPresignRequest>;

/** پاسخِ presign — فرمِ POST-policy که کلاینت مستقیم به `url` می‌فرستد. */
export const assetPresignResponse = z.object({
  fileId: z.string().min(1),
  url: z.string(),
  /** فیلدهای امضاشده‌ی فرم (`Policy`/`X-Amz-Signature`/`key`/`Content-Type`/…). `file` آخرین فیلد است. */
  fields: z.record(z.string(), z.string()),
});
export type AssetPresignResponse = z.infer<typeof assetPresignResponse>;
