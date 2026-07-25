import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { HbAsset, HbElement } from "@hamboom/shared-types";

import { bumpVersion } from "../elements/factory";
import { createImage, fitImageBox, validateImageFile } from "../elements/image";
import { toExcalidraw } from "../elements/mapping";
import { viewportCoordsToSceneCoords } from "../engine/coords";
import { commitGesture, commitSystemUpdate } from "../engine/scene-commit";

/**
 * ابزار تصویر — گام ۳٫۶.
 *
 * ── چرا در فاز capture و با stopPropagation ────────────────────────────
 *
 * موتور خودش drag&drop و paste تصویر را می‌گیرد و به شیوه‌ی خودش (خارج از
 * قرارداد `CanvasSyncAdapter` و بدون asset ما) عنصر می‌سازد. برای اینکه مسیر
 * ما جای مسیر موتور را بگیرد، رویداد را در **فاز capture** روی `document`
 * می‌گیریم و `stopPropagation` می‌زنیم تا به هندلر موتور نرسد — همان الگوی
 * `sticky-tool` برای pointer.
 *
 * ── جریان placeholder → saved ─────────────────────────────────────────
 *
 * ۱. اعتبارسنجی (نوع/حجم) → خطا به `onError`.
 * ۲. `requestAssetUpload(file)` → `fileId`.
 * ۳. درج عنصر با `status: "pending"` (موتور placeholder نشان می‌دهد) با
 *    `captureUpdate: "IMMEDIATELY"` — **creation همین‌جا ثبت می‌شود**.
 * ۴. `resolveAssetUrl(fileId)` (کش‌شونده) → `addFiles` روی موتور.
 * ۵. `status: "saved"` با `captureUpdate: "NEVER"` — خطِ پایه جلو می‌رود ولی
 *    ورودی undo تازه ساخته نمی‌شود؛ یک undo کل تصویر را برمی‌دارد و redo آن را
 *    «saved» برمی‌گرداند. ⚠️ ترتیبِ capture مهم است — چرایش کنار خودِ کد
 *    ([ADR-026](../../../../ARCHITECTURE_DECISIONS.md#adr-026)).
 */

/** انتخابگر ریشه‌ی بوم — موتور همیشه این کلاس را می‌گذارد. */
const CANVAS_ROOT = ".excalidraw";

/** زیرمجموعه‌ای از `CanvasOutbound` که این ابزار لازم دارد. */
export interface ImageAssetOutbound {
  requestAssetUpload(file: File): Promise<HbAsset>;
  resolveAssetUrl(fileId: string): Promise<string>;
}

export interface ImageToolOptions {
  api: ExcalidrawImperativeAPI;
  outbound: ImageAssetOutbound;
  authorId: string;
  /**
   * ریشه‌ی رویدادها. پیش‌فرض `document` — رویداد در لحظه با
   * `closest(".excalidraw")` فیلتر می‌شود (چرایش در `sticky-tool`).
   */
  root?: Document | HTMLElement;
  /**
   * خواندن ابعاد طبیعی تصویر. **تزریق‌پذیر** تا orchestration در jsdom هم
   * آزمودنی باشد — بارگذاری واقعی `Image` در jsdom هرگز `onload` نمی‌دهد.
   */
  readImageSize?: (file: File) => Promise<{ width: number; height: number }>;
  /** پیام خطای اعتبارسنجی — مصرف‌کننده معمولاً `api.setToast` می‌زند. */
  onError?: (message: string) => void;
  onInserted?: (element: HbElement) => void;
}

export interface ImageTool {
  /** درج یک فایل تصویر در نقطه‌ی داده‌شده (یا مرکز نما). برای paste و تست هم استفاده می‌شود. */
  ingestFile(file: File, scenePoint?: { x: number; y: number }): Promise<HbElement | null>;
  destroy(): void;
}

/** خواندن ابعاد طبیعی از راه DOM — پیش‌فرض تولید. */
function domReadImageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    if (
      typeof URL === "undefined" ||
      typeof URL.createObjectURL !== "function" ||
      typeof Image === "undefined"
    ) {
      resolve({ width: 0, height: 0 });
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const size = { width: img.naturalWidth, height: img.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(size);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: 0, height: 0 });
    };
    img.src = url;
  });
}

export function createImageTool(options: ImageToolOptions): ImageTool {
  const {
    api,
    outbound,
    authorId,
    root = typeof document === "undefined" ? undefined : document,
    readImageSize = domReadImageSize,
    onError,
    onInserted,
  } = options;

  /** کش URL هر asset در حافظه (TODO ۳٫۶) — تا یک fileId دوبار resolve نشود. */
  const urlCache = new Map<string, string>();

  /** مرکز نمای فعلی در مختصات صحنه — نقطه‌ی پیش‌فرض برای paste. */
  const viewportCenter = (): { x: number; y: number } => {
    const state = api.getAppState() as unknown as {
      offsetLeft?: number;
      offsetTop?: number;
      width?: number;
      height?: number;
    };
    const clientX = (state.offsetLeft ?? 0) + (state.width ?? 0) / 2;
    const clientY = (state.offsetTop ?? 0) + (state.height ?? 0) / 2;
    return viewportCoordsToSceneCoords({ clientX, clientY }, api.getAppState());
  };

  const ingestFile = async (
    file: File,
    scenePoint?: { x: number; y: number },
  ): Promise<HbElement | null> => {
    const validation = validateImageFile(file);
    if (!validation.ok) {
      onError?.(validation.message);
      return null;
    }

    const size = await readImageSize(file);
    const box = fitImageBox(size.width, size.height);

    const center = scenePoint ?? viewportCenter();
    // نقطه‌ی درج وسط تصویر بنشیند، نه گوشه‌اش.
    const x = center.x - box.width / 2;
    const y = center.y - box.height / 2;

    // ۲) آپلود → fileId.
    const asset = await outbound.requestAssetUpload(file);

    // ۳) placeholder — همین‌جا creation ثبت می‌شود (`IMMEDIATELY`).
    //
    // ⚠️ ترتیب capture مهم است و در مرورگر تایید شد: چون هر دو `NEVER` و
    //    `EVENTUALLY` خطِ پایه‌ی تاریخچه را جلو می‌برند، اگر درجِ placeholder را
    //    `NEVER` بگذاریم، آنگاه flip به «saved» با `IMMEDIATELY` فقط تفاوت
    //    وضعیت (pending→saved) را ثبت می‌کند و یک undo تصویر را **پاک نمی‌کند**،
    //    فقط به pending برمی‌گرداند. پس creation باید همین درجِ اول `IMMEDIATELY`
    //    باشد و flip بعدی `NEVER`.
    const pending = createImage({
      fileId: asset.fileId,
      x,
      y,
      width: box.width,
      height: box.height,
      status: "pending",
      authorId,
    });
    commitGesture(api, [...api.getSceneElements(), toExcalidraw(pending)], {
      select: [pending.id],
    });

    // ۴) resolve (کش‌شونده) → ثبت باینری در موتور.
    let url = urlCache.get(asset.fileId);
    if (url === undefined) {
      url = await outbound.resolveAssetUrl(asset.fileId);
      urlCache.set(asset.fileId, url);
    }
    if (url) {
      api.addFiles([
        {
          id: asset.fileId,
          dataURL: url,
          mimeType: file.type || asset.mime,
          created: Date.now(),
        },
      ] as never);
    }

    // ۵) status → saved، بدون ثبت جداگانه (`NEVER`) — خطِ پایه به «saved» جلو
    //    می‌رود ولی ورودی undo تازه نمی‌سازد؛ همان یک ورودیِ creation از گام ۳
    //    کل تصویر را برمی‌گرداند. `bumpVersion` لازم است تا موتور تغییرِ
    //    وضعیت را واقعاً رندر کند (تلهٔ versionNonce).
    const saved = bumpVersion({ ...pending, status: "saved" } as unknown as HbElement);
    // flip سیستمی (نه ژستِ تازه) → `commitSystemUpdate` (NEVER). خطِ پایه جلو
    // می‌رود ولی ورودی undo نمی‌سازد؛ همان creation از مرحله‌ی ۳ کل تصویر را
    // برمی‌گرداند.
    commitSystemUpdate(
      api,
      api.getSceneElements().map((el) => (el.id === pending.id ? toExcalidraw(saved) : el)),
    );

    onInserted?.(saved);
    return saved;
  };

  // ── سیم‌کشی رویداد ─────────────────────────────────────────────

  const imageFilesOf = (list: FileList | null | undefined): File[] =>
    list ? [...list].filter((f) => f.type.startsWith("image/")) : [];

  const onDrop = (event: DragEvent) => {
    const target = event.target as Element | null;
    if (!target?.closest?.(CANVAS_ROOT)) return;
    const images = imageFilesOf(event.dataTransfer?.files);
    if (images.length === 0) return; // درج غیرتصویری (مثلاً .excalidraw) کار موتور است.

    event.preventDefault();
    event.stopPropagation();

    const point = viewportCoordsToSceneCoords(
      { clientX: event.clientX, clientY: event.clientY },
      api.getAppState(),
    );
    // چند فایل با هم: کمی افست تا روی هم نیفتند.
    images.forEach((file, i) => {
      void ingestFile(file, { x: point.x + i * 24, y: point.y + i * 24 });
    });
  };

  const onDragOver = (event: DragEvent) => {
    const target = event.target as Element | null;
    if (!target?.closest?.(CANVAS_ROOT)) return;
    // بدون این، مرورگر رویداد drop را اصلاً نمی‌فرستد.
    if ([...(event.dataTransfer?.types ?? [])].includes("Files")) event.preventDefault();
  };

  const onPaste = (event: ClipboardEvent) => {
    // در حال تایپ داخل استیکی؟ paste متن باید به textarea برود، نه تصویر بسازد.
    const target = event.target as HTMLElement | null;
    if (target?.tagName === "TEXTAREA" || target?.tagName === "INPUT") return;
    const images = imageFilesOf(event.clipboardData?.files);
    if (images.length === 0) return;

    event.preventDefault();
    event.stopPropagation();

    const center = viewportCenter();
    images.forEach((file, i) => {
      void ingestFile(file, { x: center.x + i * 24, y: center.y + i * 24 });
    });
  };

  root?.addEventListener("drop", onDrop as EventListener, { capture: true });
  root?.addEventListener("dragover", onDragOver as EventListener, { capture: true });
  root?.addEventListener("paste", onPaste as EventListener, { capture: true });

  return {
    ingestFile,
    destroy: () => {
      root?.removeEventListener("drop", onDrop as EventListener, { capture: true });
      root?.removeEventListener("dragover", onDragOver as EventListener, { capture: true });
      root?.removeEventListener("paste", onPaste as EventListener, { capture: true });
    },
  };
}
