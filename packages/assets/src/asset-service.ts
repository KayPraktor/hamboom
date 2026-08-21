import { createHash, randomBytes } from "node:crypto";

import type { AssetPresignRequest, AssetPresignResponse, HbAllowedImageMime } from "@hamboom/shared-types";
import { HB_ALLOWED_IMAGE_MIME } from "@hamboom/shared-types";
import type { ObjectStore } from "@hamboom/storage";

import { sniffMime } from "./sniff.ts";

/**
 * لایه‌ی دامنه‌ی دارایی — **مصرف‌کننده‌ی `@hamboom/storage`، نه بخشی از آن** (ADR-029).
 * قاعده‌ی mime، کلیدِ team/board، sniff و sha256 اینجاست؛ دروازه‌ی S3 در storage می‌مانَد نازک.
 *
 * ⚠️ **HTTP و DB اینجا نیستند** (کارِ `apps/api` در فاز ۵): این ماژول فقط منطقِ خالص + `ObjectStore`
 * است. `commit` اینجا فقط **اعتبارسنجی** می‌کند؛ ثبت در جدولِ `files` و دی‌دوپِ `sha256` فاز ۵ است.
 */

const MIME_EXT: Record<HbAllowedImageMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

export interface AssetServiceConfig {
  /** `ObjectStore`ِ مقید به باکتِ assets (`S3_BUCKET_ASSETS`). */
  objectStore: ObjectStore;
  /** سقفِ سختِ اندازه به بایت — فاز ۵ از `UPLOAD_MAX_BYTES`ِ config می‌آورد. */
  maxBytes: number;
  /** نوع‌های مجاز — پیش‌فرض `HB_ALLOWED_IMAGE_MIME`. */
  allowedMime?: readonly string[];
  /** TTL ثانیه برای URLهای امضاشده؛ پیش‌فرض از خودِ `ObjectStore`. */
  presignTtl?: number;
  /** ساختِ `fileId` — تزریق‌پذیر تا تست قطعی بماند. */
  newFileId?: () => string;
}

/** بافتِ درخواست — از توکن/route می‌آید (فاز ۵)، نه از بدنه‌ی کلاینت. */
export interface PresignContext {
  teamId: string;
  boardId: string;
  /** ★ از توکن؛ کلاینت هرگز تعیینش نمی‌کند. */
  uploadedBy: string;
}

/**
 * ورودیِ `validateUploaded`. `declared` همان چیزی است که کلاینت در presign اعلام کرد؛
 * فاز ۵ از رکوردِ `files`ِ pending می‌آوردش. `key` هم از همان‌جا (اینجا از `presign` نگهش می‌داری).
 */
export interface ValidateUploadedArgs {
  key: string;
  declared: { mimeType: string; sizeBytes: number; sha256: string };
}

/** فاکت‌های **تاییدشده‌ی سرور** — همه از بایت‌های واقعی، هیچ‌کدام از ادعای کلاینت. */
export interface VerifiedUpload {
  mime: HbAllowedImageMime;
  sizeBytes: number;
  sha256: string;
}

export interface AssetService {
  /** اعتبار + ساختِ `fileId`/کلید + presigned POST. `key` در `fields.key` هم هست. */
  presign(req: AssetPresignRequest, ctx: PresignContext): Promise<AssetPresignResponse>;
  /** ★ اعتبارسنجیِ بایت‌های **واقعیِ** آپلودشده: اندازه، نوعِ sniff‌شده، و sha256ِ بازمحاسبه‌شده. */
  validateUploaded(args: ValidateUploadedArgs): Promise<VerifiedUpload>;
  /** URLِ نمایشِ امضاشده برای یک کلید (۳۰۲ به این، در فاز ۵). */
  resolve(key: string): Promise<string>;
}

/** خطای اعتبارسنجیِ دارایی — مسیرِ HTTPِ فاز ۵ آن را به کدِ خطای مناسب نگاشت می‌کند. */
export class AssetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetValidationError";
  }
}

const defaultFileId = (): string => `f_${randomBytes(9).toString("hex")}`;

export function createAssetService(config: AssetServiceConfig): AssetService {
  const allowed = config.allowedMime ?? HB_ALLOWED_IMAGE_MIME;
  const newFileId = config.newFileId ?? defaultFileId;
  const store = config.objectStore;

  return {
    async presign(req, ctx) {
      // اعتبارِ اعلام‌شده — **دفاعِ لایه‌ای** حتی اگر DTO از قبل parse شده باشد.
      if (!allowed.includes(req.mimeType)) {
        throw new AssetValidationError(`نوعِ فایل مجاز نیست: ${req.mimeType}`);
      }
      if (req.sizeBytes > config.maxBytes) {
        throw new AssetValidationError(`اندازه بزرگ‌تر از سقف است: ${req.sizeBytes} > ${config.maxBytes}`);
      }

      const fileId = newFileId();
      const ext = MIME_EXT[req.mimeType as HbAllowedImageMime] ?? "bin";
      const key = `teams/${ctx.teamId}/boards/${ctx.boardId}/${fileId}.${ext}`;

      // سقفِ POST-policy را روی **اندازه‌ی اعلامیِ همین فایل** می‌بندیم (تنگ‌تر از سقفِ سراسری):
      // MinIO آپلودِ بزرگ‌تر از declared را همان لحظه رد می‌کند (probe ۳٫۰).
      const { url, fields } = await store.presignUpload({
        key,
        maxBytes: req.sizeBytes,
        contentType: req.mimeType,
        expiresIn: config.presignTtl,
      });

      return { fileId, url, fields };
    },

    async validateUploaded({ key, declared }) {
      // ۱) اندازه‌ی واقعی از headObject — نه ادعای کلاینت.
      const head = await store.headObject(key);
      if (head === null) throw new AssetValidationError(`فایل در انبار نیست: ${key}`);
      if (head.size > config.maxBytes) {
        throw new AssetValidationError(`فایلِ آپلودشده بزرگ‌تر از سقف است: ${head.size}`);
      }
      if (head.size !== declared.sizeBytes) {
        throw new AssetValidationError(`اندازه‌ی واقعی با اعلام نمی‌خواند: ${head.size} ≠ ${declared.sizeBytes}`);
      }

      // ۲) بایت‌های واقعی برای sha256 و sniff.
      const bytes = await store.getObject(key);
      if (bytes === null) throw new AssetValidationError(`فایل خوانده نشد: ${key}`);

      // ★★ sha256 را **مستقل روی بایت‌های واقعی** بازمحاسبه و با ادعا مقایسه کن (قیدِ مالک).
      const actualSha = createHash("sha256").update(bytes).digest("hex");
      if (actualSha !== declared.sha256) {
        throw new AssetValidationError("sha256ِ بایت‌های واقعی با ادعای کلاینت نمی‌خواند");
      }

      // ۳) نوعِ واقعی از magic-bytes — نه Content-Typeِ اعلامی.
      const actualMime = sniffMime(bytes);
      if (actualMime === null || !allowed.includes(actualMime)) {
        throw new AssetValidationError(`نوعِ واقعیِ بایت‌ها مجاز نیست: ${actualMime ?? "ناشناخته"}`);
      }
      if (actualMime !== declared.mimeType) {
        throw new AssetValidationError(`نوعِ واقعی با اعلام نمی‌خواند: ${actualMime} ≠ ${declared.mimeType}`);
      }

      return { mime: actualMime, sizeBytes: head.size, sha256: actualSha };
    },

    resolve(key) {
      return store.presignGet(key, { expiresIn: config.presignTtl });
    },
  };
}
