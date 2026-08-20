/**
 * پورتِ Object Storage سازگار با S3 — abstractionِ P4 ([ADR-013](../../../ARCHITECTURE_DECISIONS.md#adr-013)).
 *
 * ★ **هیچ نامِ سرویسی (`minio`/`arvan`) در این امضا نیست** — سوییچ فقط با env
 * (PLAN §۴). مصرف‌کننده‌ها (`StorageSnapshotStore`ِ گام ۳٫۲، `AssetTransport`ِ گام ۳٫۳،
 * و `apps/realtime`/`apps/api`) فقط این interface را می‌بینند، نه `@aws-sdk` را.
 */

/** متادیتای یک شیء (خروجیِ `headObject`). */
export interface ObjectHead {
  /** اندازه به بایت. */
  size: number;
  /** `undefined` اگر انبار نوعی ثبت نکرده باشد. */
  contentType: string | undefined;
  etag: string | undefined;
}

/**
 * توصیفِ یک آپلودِ امضاشده‌ی **POST** — کلاینت مستقیم به Object Storage POST می‌کند.
 *
 * ★ چرا POST و نه PUT: probe ۳٫۰ روی MinIO با عدد نشان داد presigned PUT سقفِ
 * اندازه را اعمال نمی‌کند (بدونِ امضای `content-length` هر اندازه‌ای پذیرفته می‌شود)؛
 * فقط policyِ POST با `content-length-range` سقف را سمتِ سرور اعمال می‌کند.
 */
export interface PresignedUpload {
  /** URLی که فرمِ `multipart/form-data` به آن POST می‌شود. */
  url: string;
  /**
   * فیلدهایی که **باید** در فرم بیایند (`Policy`/`X-Amz-Signature`/`key`/`Content-Type`/…).
   * ⚠️ فیلدِ `file` باید **آخرین** فیلد باشد (قاعده‌ی S3 POST).
   */
  fields: Record<string, string>;
}

/** آپشن‌های `presignUpload`. */
export interface PresignUploadOptions {
  key: string;
  /** سقفِ اندازه به بایت — با `content-length-range` سمتِ سرور اعمال می‌شود (probe ۳٫۰). */
  maxBytes: number;
  /** نوعِ مجاز — با `eq $Content-Type` سمتِ سرور اعمال می‌شود. */
  contentType: string;
  /** TTL به ثانیه؛ پیش‌فرض از config (`S3_PRESIGN_TTL_SECONDS`). */
  expiresIn?: number;
}

/**
 * abstractionِ Object Storage. یک نمونه به **یک باکت** مقید است — مصرف‌کننده به‌ازای
 * هر باکت (snapshots/assets) یک store می‌سازد.
 */
export interface ObjectStore {
  putObject(key: string, body: Uint8Array, opts?: { contentType?: string }): Promise<void>;
  /** `null` یعنی کلید نیست — نه خطا (بورد/دارایی بدونِ شیء عادی است). */
  getObject(key: string): Promise<Uint8Array | null>;
  deleteObject(key: string): Promise<void>;
  /** `null` یعنی کلید نیست. */
  headObject(key: string): Promise<ObjectHead | null>;
  /** همه‌ی کلیدهای زیرِ یک prefix (با صفحه‌بندیِ داخلی). */
  listPrefix(prefix: string): Promise<string[]>;
  /** URLِ دانلودِ امضاشده (GET). */
  presignGet(key: string, opts?: { expiresIn?: number }): Promise<string>;
  /** ★ آپلودِ امضاشده‌ی POST با سقفِ اندازه/نوع (probe ۳٫۰). */
  presignUpload(opts: PresignUploadOptions): Promise<PresignedUpload>;
}
