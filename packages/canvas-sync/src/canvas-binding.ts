import type { CanvasInbound } from "@hamboom/canvas-core/sync";

import { applyRemoteChangesToScene, replaceSceneDocument, type CanvasApi } from "./apply-remote.ts";

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
}

export function createCanvasBinding({ api, ui = {} }: CanvasBindingOptions): CanvasInbound {
  return {
    applyRemoteChanges: (changes) => applyRemoteChangesToScene(api, changes),
    replaceDocument: (document) => replaceSceneDocument(api, document),

    applyPeers: (peers) => ui.applyPeers?.(peers),
    setConnectionState: (state) => ui.setConnectionState?.(state),
    setSaveState: (state) => ui.setSaveState?.(state),
    setPermissions: (permissions) => ui.setPermissions?.(permissions),
    focusOn: (target) => ui.focusOn?.(target),
  };
}
