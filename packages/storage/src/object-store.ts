/**
 * پورتِ Object Storage سازگار با S3 — abstractionِ P4 ([ADR-013](../../../ARCHITECTURE_DECISIONS.md#adr-013)).
 *
 * ★ **هیچ نامِ سرویسی (`minio`/`arvan`) در این امضا نیست** — سوییچ فقط با env
 * (PLAN §۴). مصرف‌کننده‌ها (`StorageSnapshotStore`ِ گام ۳٫۲، `AssetTransport`ِ گام ۳٫۳،
 * و `apps/realtime`/`apps/api`) فقط این interface را می‌بینند، نه `@aws-sdk` را.
 */

import type { Readable } from "node:stream";

/** متادیتای یک شیء (خروجیِ `headObject`). */
export interface ObjectHead {
  /** اندازه به بایت. */
  size: number;
  /** `undefined` اگر انبار نوعی ثبت نکرده باشد. */
  contentType: string | undefined;
  etag: string | undefined;
  /**
   * ★★ زمانِ آخرین نوشتن — افزوده‌ی M5 فاز ۸ (جاروبِ بلابِ یتیم).
   *
   * ⚠️ **بدونِ این، یک جاروبِ ایمن اصلاً قابلِ نوشتن نبود.** شیئی که در باکت هست و
   * هیچ ردیفی در دیتابیس ندارد، دو چیزِ کاملاً متفاوت می‌تواند باشد: یک زباله‌ی
   * ماه‌ها پیش، یا آپلودی که **همین حالا** تمام شده و ردیفش هنوز commit نشده. تنها
   * چیزی که این دو را از هم جدا می‌کند سنِ خودِ شیء است.
   *
   * ⚠️ `undefined` یعنی «نمی‌دانم» — و جاروب آن را **حذف نمی‌کند**. همان قاعده‌ی
   * [ADR-056](../../../ARCHITECTURE_DECISIONS.md#adr-056): هیچ چیزی روی ابهام باطل
   * نمی‌شود.
   */
  lastModified: Date | undefined;
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

/** آپشن‌های `putObjectStream` — M6/ADR-069. */
export interface PutStreamOptions {
  /**
   * ★ **اجباری.** `PutObject` با بدنه‌ی stream بدونِ `ContentLength` خطا می‌دهد و راهِ
   * SDK برایش (`@aws-sdk/lib-storage`) یک وابستگیِ نو است (P1/قانونِ ۶ی M6). برای
   * آینه/بازیابی طول همیشه از `headObject`/مانیفست در دسترس است؛ استریمِ بی‌طول عمداً
   * پشتیبانی نمی‌شود.
   */
  contentLength: number;
  contentType?: string;
}

/**
 * abstractionِ Object Storage. یک نمونه به **یک باکت** مقید است — مصرف‌کننده به‌ازای
 * هر باکت (snapshots/assets) یک store می‌سازد.
 *
 * ★ **سه متدِ افزایشیِ M6** ([ADR-069](../../../ARCHITECTURE_DECISIONS.md#adr-069)):
 * `getObjectStream`/`putObjectStream`/`iteratePrefix`. متدهای قبلی دست نخورده‌اند —
 * اندازه‌گیریِ فاز ۱ی M6: `getObject` روی شیءِ ۲۰۰MB لحظه‌ای **سه برابرِ** شیء را در
 * `arrayBuffers` می‌نشانَد (SDK بدنه را جمع می‌کند و `transformToByteArray` یک‌بار دیگر
 * کپی می‌کند)؛ استریم +۱۴٫۵MB. برای بورد/دارایی‌های کوچکِ مسیرِ عادی همان `getObject`
 * درست است؛ آینه، بازیابی و جاروب که روی **کلِ** باکت می‌روند، این سه را می‌خواهند.
 */
export interface ObjectStore {
  putObject(key: string, body: Uint8Array, opts?: { contentType?: string }): Promise<void>;
  /** `null` یعنی کلید نیست — نه خطا (بورد/دارایی بدونِ شیء عادی است). */
  getObject(key: string): Promise<Uint8Array | null>;
  deleteObject(key: string): Promise<void>;
  /** `null` یعنی کلید نیست. */
  headObject(key: string): Promise<ObjectHead | null>;
  /** همه‌ی کلیدهای زیرِ یک prefix (با صفحه‌بندیِ داخلی) — ⚠️ همه در حافظه؛ برای کلِ باکت `iteratePrefix`. */
  listPrefix(prefix: string): Promise<string[]>;
  /** URLِ دانلودِ امضاشده (GET). */
  presignGet(key: string, opts?: { expiresIn?: number }): Promise<string>;
  /** ★ آپلودِ امضاشده‌ی POST با سقفِ اندازه/نوع (probe ۳٫۰). */
  presignUpload(opts: PresignUploadOptions): Promise<PresignedUpload>;

  // ── M6 / ADR-069 — افزایشی ─────────────────────────────────────────────
  /** بدنه به‌صورتِ stream (Node `Readable`)؛ `null` یعنی کلید نیست. حافظه: ثابت. */
  getObjectStream(key: string): Promise<Readable | null>;
  /** نوشتن از stream با طولِ **اجباری** (شرح در `PutStreamOptions`). */
  putObjectStream(key: string, body: Readable, opts: PutStreamOptions): Promise<void>;
  /** پیمایشِ کلیدها زیرِ یک prefix، صفحه‌به‌صفحه از انبار — هیچ‌وقت کلِ فهرست در حافظه نیست. */
  iteratePrefix(prefix: string): AsyncIterable<string>;
}
