import type { CanvasInbound } from "@hamboom/canvas-core/sync";
import type { HbAsset } from "@hamboom/shared-types";

import {
  applyRemoteChangesToScene,
  registerSceneAssets,
  replaceSceneDocument,
  type AssetResolver,
  type CanvasApi,
} from "./apply-remote.ts";

/**
 * ساختِ `CanvasInbound` از دسته‌ی امریِ موتور — سمتِ **بوم**ِ قرارداد M1.
 *
 * ── چرا اینجا و نه در `canvas-core` ───────────────────────────────────
 *
 * M1 قرارداد و چوک‌پوینتِ نوشتن (`commitSystemUpdate`) را ساخت ولی **هیچ‌کس
 * `CanvasInbound` را پیاده نکرده بود** — `HamboomCanvas` فقط `onReady(api)`
 * می‌دهد. وصل‌کردنِ آن دسته به یک آداپتور دقیقاً تعریفِ «binder» است، و طبق
 * [ADR-029](../../../ARCHITECTURE_DECISIONS.md#adr-029) تنها پکیجی که حق دارد
 * هر دو سر را ببیند همین است.
 *
 * ── چرا بقیه‌ی متدها callback می‌گیرند ────────────────────────────────
 *
 * `applyRemoteChanges` و `replaceDocument` روی **صحنه** می‌نویسند، پس اینجا
 * جایشان است. بقیه (حضور، وضعیتِ اتصال و ذخیره، مجوز، پرشِ نما) **حالتِ رابط**
 * اند و مالکشان اپ است. اگر اینجا پیاده می‌شدند، binder به یک لایه‌ی UI تبدیل
 * می‌شد که نه تست‌پذیر است نه قابلِ استفاده در دو اپِ متفاوت.
 */
export interface CanvasBindingOptions {
  api: CanvasApi;
  /** بخش‌هایی از قرارداد که **رابط** مالکشان است. نبودشان یعنی نادیده گرفته می‌شود. */
  ui?: Partial<Omit<CanvasInbound, "applyRemoteChanges" | "replaceDocument">>;
  /**
   * ★ همان پورتی که به آداپتور داده شده — گام ۳٫۶.
   *
   * نبودش یعنی عنصرِ تصویرِ همتا روی صحنه می‌نشیند ولی **قابِ خالی** می‌مانَد،
   * چون موتور فایلی به آن `fileId` نمی‌شناسد. اختیاری است تا بایندینگ‌های بدونِ
   * تصویر مجبور نباشند پورت بسازند.
   */
  assets?: AssetResolver;
  /**
   * خطای ثبتِ یک دارایی. قراردادِ M1 برای این کانالی ندارد و بدونِ این، تنها
   * نشانه‌ی خرابی یک قابِ خالیِ بی‌توضیح است.
   */
  onAssetError?: (asset: HbAsset, cause: unknown) => void;
}

export function createCanvasBinding({
  api,
  ui = {},
  assets,
  onAssetError,
}: CanvasBindingOptions): CanvasInbound {
  /**
   * ⚠️ **fire-and-forget، و این عمدی است.** `applyRemoteChanges` در قرارداد
   * `void` برمی‌گرداند و صداکننده‌اش (`flushRemote`) بیرونِ تراکنشِ Yjs است؛
   * منتظرِ شبکه ماندن یعنی نشستنِ کلِ مسیرِ remote پشتِ یک آپلود. عناصر همان
   * لحظه رندر می‌شوند و بایت‌ها که رسیدند جایگزینِ placeholder می‌شوند.
   */
  const register = (list: readonly HbAsset[]): void => {
    if (!assets || list.length === 0) return;
    void registerSceneAssets(api, list, assets, onAssetError);
  };

  return {
    applyRemoteChanges: (changes) => {
      applyRemoteChangesToScene(api, changes);
      register(changes.assets ?? []);
    },
    replaceDocument: (document) => {
      replaceSceneDocument(api, document);
      register(document.assets);
    },

    applyPeers: (peers) => ui.applyPeers?.(peers),
    setConnectionState: (state) => ui.setConnectionState?.(state),
    setSaveState: (state) => ui.setSaveState?.(state),
    setPermissions: (permissions) => ui.setPermissions?.(permissions),
    focusOn: (target) => ui.focusOn?.(target),
  };
}
