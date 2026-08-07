import { HB_ALLOWED_IMAGE_MIME, type HbAsset } from "@hamboom/shared-types";

/**
 * پورتِ دارایی — [ADR-031](../../../ARCHITECTURE_DECISIONS.md#adr-031).
 *
 * ── چرا پورت و نه پیاده‌سازیِ مستقیم ──────────────────────────────────
 *
 * مسیرِ واقعیِ آپلود (presigned URL از `POST /api/v1/assets`) به `apps/api` و
 * `packages/storage` نیاز دارد که **هیچ‌کدام هنوز وجود ندارند** (کارِ M3). دو
 * راه بود: صبر، یا نوشتنِ همان مسیر اینجا و بعداً جایگزینی. دومی یعنی یک
 * پیاده‌سازیِ دوم که با M3 واگرا می‌شود (ADR-024) — و P4 هم می‌گوید هیچ ماژولی
 * جز `packages/storage` حق ندارد به Object Storage دست بزند.
 *
 * پس M2 پشتِ همین پورت با دنیا حرف می‌زند و یک پیاده‌سازیِ **توسعه** دارد.
 *
 * ⚠️ **`uploadedBy` را کلاینت تعیین نمی‌کند.** در تولید سرور آن را از توکن
 * درمی‌آورد و در پاسخ برمی‌گرداند؛ اگر کلاینت بفرستدش، هرکس می‌تواند فایل را به
 * نامِ دیگری بالا بگذارد. پیاده‌سازیِ توسعه هم برای همین آن را **در سازنده**
 * می‌گیرد، نه در `upload` — تا شکلِ پورت با نسخه‌ی واقعی یکی بماند.
 */
export interface AssetTransport {
  /**
   * بالا بردنِ فایل و برگرداندنِ **متادیتا**. `fileId` را سمتِ دیگر می‌سازد،
   * نه کلاینت.
   */
  upload(file: File): Promise<HbAsset>;
  /**
   * URLِ قابلِ نمایش برای یک `fileId`.
   *
   * ★ **هرگز reject نمی‌کند.** این متد در مسیرِ **رندر** صدا زده می‌شود و یک
   * فایلِ گمشده نباید کلِ بورد را بشکند؛ رشته‌ی خالی یعنی «الان نمی‌شود نشانش
   * داد» و موتور placeholder را نگه می‌دارد.
   */
  resolve(fileId: string): Promise<string>;
}

/**
 * ★ جای **Object Storage** در فاز ۳ — مشترک بینِ همه‌ی کلاینت‌ها، دقیقاً مثلِ
 * [`LocalTransportHub`](./transport.ts) که جای سرور را می‌گیرد.
 *
 * ⚠️ **اشتراکش تشریفاتی نیست:** بدونِ آن، کلاینتِ ب یک `fileId` می‌گیرد که هیچ
 * جا سراغش را ندارد و `resolve` رشته‌ی خالی برمی‌گرداند — یعنی تصویرِ همتا هرگز
 * دیده نمی‌شود. همان چیزی که در تولید، سرور حلش می‌کند.
 */
export interface LocalAssetStoreOptions {
  /**
   * ساختِ URL از فایل.
   *
   * ⚠️ **تزریق‌پذیر است، و بدونش این مسیر آزمودنی نبود:** `URL.createObjectURL`
   * فقط داخلِ یک documentِ مرورگر وجود دارد — نه در Node و نه در jsdom. بدونِ
   * این قلاب، تستِ «همتا همان URL را می‌گیرد» به مقایسه‌ی دو رشته‌ی خالی تبدیل
   * می‌شد، یعنی یک سبزِ توخالی. همان دلیلی که `image-tool`ِ M1 هم
   * `readImageSize` را تزریق‌پذیر کرد.
   */
  createUrl?: (file: File) => string;
  revokeUrl?: (url: string) => void;
}

export class LocalAssetStore {
  private readonly urls = new Map<string, string>();
  /** بایت‌ها فقط برای همین حالتِ توسعه نگه داشته می‌شوند، نه برای سند. */
  private readonly files = new Map<string, File>();
  private readonly createUrl: (file: File) => string;
  private readonly revokeUrl: (url: string) => void;

  constructor({ createUrl, revokeUrl }: LocalAssetStoreOptions = {}) {
    this.createUrl =
      createUrl ??
      ((file) => (typeof URL?.createObjectURL === "function" ? URL.createObjectURL(file) : ""));
    this.revokeUrl =
      revokeUrl ??
      ((url) => {
        if (typeof URL?.revokeObjectURL === "function") URL.revokeObjectURL(url);
      });
  }

  put(fileId: string, file: File): string {
    const url = this.createUrl(file);
    this.urls.set(fileId, url);
    this.files.set(fileId, file);
    return url;
  }

  /** رشته‌ی خالی یعنی «نمی‌شناسمش» — همان قراردادِ `AssetTransport.resolve`. */
  urlOf(fileId: string): string {
    return this.urls.get(fileId) ?? "";
  }

  fileOf(fileId: string): File | undefined {
    return this.files.get(fileId);
  }

  get size(): number {
    return this.urls.size;
  }

  /**
   * آزادکردنِ `objectURL`ها.
   *
   * ⚠️ عمداً روی **انبار** است نه روی هر کلاینت: اگر با `disconnect`ِ یک کلاینت
   * صدا زده می‌شد، تصویر روی بومِ **همتا** هم سفید می‌شد. مالکِ انبار (اپ یا
   * تست) تصمیم می‌گیرد کِی تمام شده است.
   */
  dispose(): void {
    for (const url of this.urls.values()) if (url) this.revokeUrl(url);
    this.urls.clear();
    this.files.clear();
  }
}

export interface LocalAssetTransportOptions {
  /** هویتی که در تولید **سرور** از توکن درمی‌آورد. */
  uploadedBy: string;
  bucket?: string;
  /** ساختِ شناسه — تزریق‌پذیر تا تست قطعی بماند. */
  newFileId?: () => string;
  /** خواندنِ ابعادِ واقعی — پیش‌فرض `createImageBitmap` (فقط مرورگر). */
  readImageSize?: (file: File) => Promise<{ width: number; height: number }>;
}

const randomFileId = (): string => `f_local_${Math.random().toString(36).slice(2, 10)}`;

/**
 * ★★ ابعادِ جایگزین وقتی decoder نداریم — **۱، نه ۰**.
 *
 * `hbAsset` صریحاً `width`/`height` را **مثبت** می‌خواهد و حق هم دارد: یک
 * داراییِ صفر در صفر یعنی هیچ. این را با تست فهمیدیم، نه با خواندنِ schema —
 * اولین نسخه‌ی این پورت صفر می‌فرستاد و `writeAsset` با `ZodError` افتاد.
 *
 * ⚠️ **و همین صفر امروز در [`canvas-core/dev/App.tsx`](../../canvas-core/dev/App.tsx)
 * هست** (شبیه‌سازیِ داراییِ دموی M1). آنجا هرگز به سند نمی‌رسد پس خطا نمی‌دهد،
 * ولی اگر روزی به یک آداپتورِ واقعی وصل شود، آپلود می‌شکند. ثبت شد، دست نخورد —
 * دامنه‌ی M1 است.
 */
const PLACEHOLDER_SIZE = { width: 1, height: 1 } as const;

/**
 * ابعاد را همان‌طور که **سرور** می‌کند از خودِ بایت‌ها درمی‌آورد.
 *
 * ⚠️ `createImageBitmap` بیرونِ مرورگر (و در jsdom) وجود ندارد، و در بعضی
 * مرورگرها SVG را decode نمی‌کند — هر دو حالت به `PLACEHOLDER_SIZE` می‌افتند تا
 * یک تصویرِ سالم به‌خاطرِ نبودِ decoder رد نشود.
 */
async function decodeImageSize(file: File): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap !== "function") return PLACEHOLDER_SIZE;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return size.width > 0 && size.height > 0 ? size : PLACEHOLDER_SIZE;
  } catch {
    return PLACEHOLDER_SIZE;
  }
}

/**
 * پیاده‌سازیِ **توسعه** — `URL.createObjectURL` جای Object Storage.
 *
 * همان کاری که [`local-adapter`](../../canvas-core/src/sync/local-adapter.ts)ِ M1
 * و دموی `canvas-core` می‌کنند، این‌بار پشتِ پورت و **مشترک** بینِ کلاینت‌ها.
 */
export function createLocalAssetTransport(
  store: LocalAssetStore,
  {
    uploadedBy,
    bucket = "local",
    newFileId = randomFileId,
    readImageSize = decodeImageSize,
  }: LocalAssetTransportOptions,
): AssetTransport {
  return {
    async upload(file) {
      // ★ اعتبارسنجی **اینجا هم** انجام می‌شود، با اینکه `image-tool`ِ M1 قبلش
      //   انجامش داده: در تولید سرور مرزِ اعتماد است و هر نوعی را نمی‌پذیرد. یک
      //   پورتِ توسعه‌ای که همه‌چیز را قبول کند، خطا را به **تولید** موکول می‌کند.
      if (!(HB_ALLOWED_IMAGE_MIME as readonly string[]).includes(file.type)) {
        throw new Error(`‏[hamboom] نوعِ فایل پشتیبانی نمی‌شود: ${file.type || "نامشخص"}`);
      }

      const size = await readImageSize(file);
      const fileId = newFileId();
      store.put(fileId, file);
      return {
        fileId,
        bucket,
        key: `${bucket}/${fileId}`,
        mime: file.type,
        ...size,
        sizeBytes: file.size,
        // `sha256` کارِ سرور است — کلاینت نمی‌تواند تضمینش کند.
        sha256: null,
        uploadedBy,
        createdAt: Date.now(),
      } satisfies HbAsset;
    },

    resolve(fileId) {
      return Promise.resolve(store.urlOf(fileId));
    },
  };
}
