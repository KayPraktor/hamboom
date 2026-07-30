import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { HbElement } from "@hamboom/shared-types";

import { pasteElements, textToStickies } from "../elements/clipboard";
import { collectWithBoundText } from "../elements/duplicate";
import { fromExcalidraw, toExcalidraw } from "../elements/mapping";
import { deleteElements } from "../elements/operations";
import { viewportCoordsToSceneCoords } from "../engine/coords";
import { commitGesture } from "../engine/scene-commit";

/**
 * ابزارِ کلیپ‌بورد — گام ۵٫۳.
 *
 * ── چرا در فاز capture (مثل image-tool) ────────────────────────────────
 * موتور خودش Ctrl+C/X/V را می‌گیرد. رویدادها را در **فاز capture** روی `document`
 * می‌گیریم و برای دادهٔ خودمان `preventDefault + stopImmediatePropagation` می‌زنیم
 * تا مسیرِ ما جای موتور بنشیند (هم‌کلاسِ drop/paste — در ۳٫۶ تایید شد).
 *
 * ── هماهنگی با image-tool ──────────────────────────────────────────────
 * هر دو روی `paste` (capture) گوش می‌دهند. تصویر کارِ image-tool است؛ اینجا اگر
 * کلیپ‌بورد **تصویر** داشت، **کاری نمی‌کنیم و برنمی‌گردانیم** (defer) تا image-tool
 * آن را بگیرد.
 *
 * ── داخلی در برابر خارجی ───────────────────────────────────────────────
 * کلیپ‌بوردِ عناصر **درون‌حافظه‌ای** است (دادهٔ کامل، شاملِ متنِ مقید). موقعِ کپی یک
 * **نشانه (token)** روی متنِ کلیپ‌بوردِ سیستم می‌گذاریم؛ موقعِ paste اگر متن همان
 * token بود یعنی دادهٔ ماست → عناصر را paste کن؛ وگرنه متنِ خارجی است → استیکی.
 *
 * ── منبعِ واحد ─────────────────────────────────────────────────────────
 * paste روی همان `cloneElements`ِ تکثیر و `createSticky` سوار است (ADR-024). حذفِ
 * cut از `deleteElements`ِ مشترک. همان تابع‌هایی که منوی راست‌کلیک صدا می‌زند.
 */

/** نشانه‌ی کلیپ‌بوردِ داخلی — کاراکترهای نامرئی + یک id یکتا. */
const HB_MARK = "⁣hb-clip⁣";
const PASTE_STEP = 16;

export interface ClipboardToolOptions {
  api: ExcalidrawImperativeAPI;
  authorId: string;
  root?: Document | HTMLElement;
  textDirection?: "rtl" | "ltr";
  onChanged?: () => void;
}

export interface ClipboardTool {
  /** کنشِ منوی راست‌کلیک/میانبر — همان مسیرِ رویدادِ کلیپ‌بورد. */
  copySelection(): boolean;
  cutSelection(): void;
  pasteFromStore(): void;
  hasClip(): boolean;
  destroy(): void;
}

export function createClipboardTool(options: ClipboardToolOptions): ClipboardTool {
  const {
    api,
    authorId,
    root = typeof document === "undefined" ? undefined : document,
    textDirection = "rtl",
    onChanged,
  } = options;

  /** کلیپ‌بوردِ درون‌حافظه‌ای — دادهٔ کاملِ عناصرِ کپی‌شده. */
  let store: HbElement[] = [];
  let token = "";
  /** شمارنده‌ی paste تا کپی‌های پشت‌سرهم آبشاری آفست شوند، نه روی هم. */
  let pasteCount = 0;

  const sceneHb = (): HbElement[] =>
    api.getSceneElements().map((el) => fromExcalidraw(el as never));
  const selectedIds = (): Set<string> => new Set(Object.keys(api.getAppState().selectedElementIds));

  const isTyping = (target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null;
    return el?.tagName === "TEXTAREA" || el?.tagName === "INPUT";
  };

  /** مرکزِ نمای فعلی در مختصاتِ صحنه — نقطه‌ی درجِ متن. */
  const viewportCenter = (): { x: number; y: number } => {
    const s = api.getAppState() as unknown as {
      offsetLeft?: number;
      offsetTop?: number;
      width?: number;
      height?: number;
    };
    return viewportCoordsToSceneCoords(
      {
        clientX: (s.offsetLeft ?? 0) + (s.width ?? 0) / 2,
        clientY: (s.offsetTop ?? 0) + (s.height ?? 0) / 2,
      },
      api.getAppState(),
    );
  };

  /** انتخاب را در store بگذار؛ اگر چیزی نبود false. */
  const grab = (): boolean => {
    const source = collectWithBoundText(sceneHb(), selectedIds());
    if (source.length === 0) return false;
    store = source;
    token = HB_MARK + Math.random().toString(36).slice(2);
    pasteCount = 0;
    return true;
  };

  const doPasteStore = (): void => {
    if (store.length === 0) return;
    const offset = PASTE_STEP * ++pasteCount; // آبشاری: paste دومِ همان کپی، دو پله آن‌طرف‌تر
    const { elements, newIds } = pasteElements(sceneHb(), store, { offset });
    commitGesture(api, elements.map(toExcalidraw), { select: newIds });
    onChanged?.();
  };

  const doDeleteSelection = (): void => {
    const next = deleteElements(sceneHb(), selectedIds());
    commitGesture(api, next.map(toExcalidraw));
    onChanged?.();
  };

  const doTextPaste = (text: string): void => {
    const c = viewportCenter();
    const { elements, ids } = textToStickies(text, {
      authorId,
      x: c.x,
      y: c.y,
      textDirection,
    });
    if (ids.length === 0) return;
    commitGesture(api, [...api.getSceneElements(), ...elements.map(toExcalidraw)], { select: ids });
    onChanged?.();
  };

  // ── سیم‌کشیِ رویداد ────────────────────────────────────────────
  const onCopy = (event: ClipboardEvent) => {
    if (isTyping(event.target)) return; // تایپ داخل استیکی → کپیِ متن دستِ ویرایشگر
    if (!grab()) return;
    event.clipboardData?.setData("text/plain", token);
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onCut = (event: ClipboardEvent) => {
    if (isTyping(event.target)) return;
    if (!grab()) return;
    event.clipboardData?.setData("text/plain", token);
    event.preventDefault();
    event.stopImmediatePropagation();
    doDeleteSelection();
  };

  const onPaste = (event: ClipboardEvent) => {
    if (isTyping(event.target)) return; // paste داخل ویرایشگر
    // تصویر → کارِ image-tool؛ دست نمی‌زنیم (defer).
    const hasImage = [...(event.clipboardData?.files ?? [])].some((f) =>
      f.type.startsWith("image/"),
    );
    if (hasImage) return;

    const text = event.clipboardData?.getData("text/plain") ?? "";
    // دادهٔ داخلیِ ما (token) → عناصر را paste کن.
    if (store.length > 0 && text === token) {
      event.preventDefault();
      event.stopImmediatePropagation();
      doPasteStore();
      return;
    }
    // متنِ خارجی → استیکی (رفتار میرو).
    if (text.trim()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      doTextPaste(text);
    }
  };

  root?.addEventListener("copy", onCopy as EventListener, { capture: true });
  root?.addEventListener("cut", onCut as EventListener, { capture: true });
  root?.addEventListener("paste", onPaste as EventListener, { capture: true });

  return {
    copySelection: grab,
    cutSelection: () => {
      if (grab()) doDeleteSelection();
    },
    pasteFromStore: doPasteStore,
    hasClip: () => store.length > 0,
    destroy: () => {
      root?.removeEventListener("copy", onCopy as EventListener, { capture: true });
      root?.removeEventListener("cut", onCut as EventListener, { capture: true });
      root?.removeEventListener("paste", onPaste as EventListener, { capture: true });
    },
  };
}
