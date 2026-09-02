import type { AssetTransport } from "@hamboom/canvas-sync";
import { HB_ALLOWED_IMAGE_MIME, type HbAllowedImageMime, type HbAsset } from "@hamboom/shared-types";

import { api } from "../api/client.ts";

/**
 * `AssetTransport`ِ **واقعی** روی storageِ M3 — جایگزینِ `createLocalAssetTransport`ِ توسعه
 * (فاز ۱۱٫۲؛ درجِ تصویر که در گام ۹٫۱ به همین‌جا موکول شده بود).
 *
 * جریان (PLAN §۵٫۲، [ADR-044](../../../../ARCHITECTURE_DECISIONS.md#adr-044)): `presign` →
 * **POST مستقیمِ** فرمِ POST-policy به Object Storage (فیلدِ `file` **آخر**) → `commit` که سرور
 * `sha256`/mime را روی بایتِ واقعی **بازمی‌سنجد**. متادیتای برگشتی `HbAsset` است که در سند می‌نشیند.
 *
 * ★ همان interfaceِ پورت (`AssetTransport`) که دموی M2 با `LocalAssetTransport` اثباتش کرده بود؛
 *   اینجا فقط پیاده‌سازیِ backing عوض می‌شود (blobِ محلی → storageِ واقعی). صفر تغییرِ در ماشینِ
 *   image-tool/binding (ADR-024). `resolve` یک URLِ **امضاشده‌ی http** می‌دهد؛ `registerSceneAssets`
 *   همان را (مثلِ blob: در M2) به `addFiles` می‌دهد و موتور رندرش می‌کند.
 */
export function createApiAssetTransport({
  boardId,
  uploadedBy,
}: {
  boardId: string;
  /** هویتِ نمایشی در متادیتای سند؛ رکوردِ معتبرِ سرور از توکن می‌آید (نه این). */
  uploadedBy: string;
}): AssetTransport {
  return {
    async upload(file) {
      // ★ اعتبارسنجیِ زودهنگام — سرور هم دوباره می‌سنجد (مرزِ اعتماد آنجاست).
      if (!(HB_ALLOWED_IMAGE_MIME as readonly string[]).includes(file.type)) {
        throw new Error(`‏[hamboom] نوعِ فایل پشتیبانی نمی‌شود: ${file.type || "نامشخص"}`);
      }

      const [size, sha256] = await Promise.all([decodeImageSize(file), sha256Hex(file)]);

      // ۱) presign — سرور `fileId` را می‌سازد و فرمِ POST-policy را امضا می‌کند.
      const presign = await api.assets.presign(boardId, {
        mimeType: file.type as HbAllowedImageMime,
        sizeBytes: file.size,
        sha256,
      });

      // ۲) POST مستقیم به انبار — همه‌ی فیلدهای امضاشده، بعد `file` **آخر** (قیدِ POST-policy).
      const form = new FormData();
      for (const [key, value] of Object.entries(presign.fields)) form.append(key, value);
      form.append("file", file);
      const uploadRes = await fetch(presign.url, { method: "POST", body: form });
      if (!uploadRes.ok) {
        throw new Error(`‏[hamboom] بارگذاریِ فایل به انبار ناموفق بود (${String(uploadRes.status)}).`);
      }

      // ۳) commit — سرور بایت را می‌سنجد (sha256/mime/اندازه) و رکورد را نهایی می‌کند.
      const committed = await api.assets.commit(boardId, presign.fileId);

      // ۴) `HbAsset` برای سند. bucket/key اطلاعاتی‌اند (همتا با fileId resolve می‌کند)؛
      //    ابعاد از decodeِ محلی چون commit آن‌ها را برنمی‌گرداند.
      return {
        fileId: committed.fileId,
        bucket: presign.fields.bucket ?? "assets",
        key: presign.fields.key ?? committed.fileId,
        mime: committed.mimeType,
        width: size.width,
        height: size.height,
        sizeBytes: committed.sizeBytes,
        sha256: committed.sha256,
        uploadedBy,
        createdAt: Date.now(),
      } satisfies HbAsset;
    },

    async resolve(fileId) {
      // ★ هرگز reject نمی‌کند (مسیرِ رندر) — رشته‌ی خالی یعنی «الان نمی‌شود»، placeholder می‌مانَد.
      // بایت‌ها را از sdk می‌گیریم (که ۳۰۲ را در مرورگر **درست** دنبال می‌کند؛ auth/۴۰۱-refresh آنجاست، پس
      // خط‌قرمزِ «فقط sdk» هم نمی‌شکند) و به **data:URI** می‌دهیم — فرمتِ نیتیوی که موتور در `addFiles` رندر
      // می‌کند (blob: را در مرورگر **قابِ خالی** نشان داد؛ در بارگذاریِ سند/همتا اثبات شد). هم‌مبدأ، بی‌وابستگی
      // به CORS/taintِ Object Storage (برای export فاز بعد هم مهم).
      try {
        return await blobToDataUrl(await api.assets.resolveBlob(fileId));
      } catch {
        return "";
      }
    },
  };
}

/** ابعادِ واقعی از بایت‌ها؛ SVG/نبودِ decoder → ۱×۱ (نه ۰ — `hbAsset` ابعادِ مثبت می‌خواهد). */
async function decodeImageSize(file: File): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap !== "function") return { width: 1, height: 1 };
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return size.width > 0 && size.height > 0 ? size : { width: 1, height: 1 };
  } catch {
    return { width: 1, height: 1 };
  }
}

/** Blob → data:URI (base64) — فرمتِ نیتیوِ excalidraw برای `addFiles` (blob: را رندر نمی‌کند). */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

/** SHA-256ِ hex از بایت‌های فایل — ادعای کلاینت؛ سرور در commit مستقلاً بازمی‌سنجد. */
async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
