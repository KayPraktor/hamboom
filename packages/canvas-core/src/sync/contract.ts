import type { HbAppState, HbAsset, HbElement } from "@hamboom/shared-types";

/**
 * قرارداد رسمی بین بوم و لایه‌ی همگام‌سازی.
 *
 * **این تنها سطح تماس `canvas-core` با دنیای بیرون است.** ماژول M2
 * (`realtime-sync`) دقیقاً همین interface را پیاده می‌کند و هیچ‌چیز دیگری از
 * این پکیج را نمی‌بیند. متقابلاً بوم هیچ‌چیز از Yjs، شبکه یا احراز هویت
 * نمی‌داند — یک قاعده‌ی ESLint این را اعمال می‌کند.
 *
 * ── چرا این مرز اینقدر سفت است ────────────────────────────────────────
 *
 * بوم باید بدون سرور قابل اجرا و تست باشد. هر نشتی از مفاهیم شبکه به داخل
 * بوم یعنی از آن به بعد برای تست کردن یک استیکی‌نوت به یک WebSocket نیاز داریم.
 * `local-adapter.ts` همین را ثابت می‌کند: یک پیاده‌سازی کامل بدون هیچ I/O.
 */

// ─────────────────────────────────────────────────────────────
// واحدهای انتقال
// ─────────────────────────────────────────────────────────────

/**
 * منشأ یک تغییر.
 *
 * حیاتی‌ترین فیلد کل قرارداد: بدون آن، تغییری که از راه دور می‌رسد دوباره
 * به بیرون فرستاده می‌شود و یک حلقه‌ی بی‌نهایت می‌سازد.
 */
export type ChangeOrigin = "local-user" | "remote" | "undo" | "system";

export interface ElementChangeSet {
  /** عناصر ساخته‌شده یا تغییریافته — همیشه شیء کامل، نه patch. */
  upserted: HbElement[];
  /** شناسه‌ی عناصر حذف‌شده (حذف نرم: `isDeleted = true`). */
  deleted: string[];
  /** متادیتای فایل‌های تازه ارجاع‌شده. */
  assets?: HbAsset[];
  origin: ChangeOrigin;
  /**
   * برچسب ژست کاربر — همه‌ی تغییرات یک درگ یک `gestureId` می‌گیرند.
   * undo/redo کل ژست را یک واحد می‌بیند و پایداری می‌تواند batch کند.
   */
  gestureId?: string;
}

export interface PointerState {
  x: number;
  y: number;
  visible: boolean;
}

export interface Viewport {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export interface PeerUser {
  id: string;
  displayName: string;
  color: string;
  avatarUrl: string | null;
}

export interface PeerState {
  clientId: number;
  user: PeerUser;
  pointer: PointerState | null;
  selectedIds: string[];
  viewport: Viewport | null;
  activeTool: string | null;
  ephemeral?: EphemeralPayload | null;
}

/**
 * داده‌ی موقت که **هرگز ذخیره نمی‌شود** — [ADR-022](../../../../ARCHITECTURE_DECISIONS.md#adr-022).
 *
 * یک استروک قلم ۲۰۰ تا ۵۰۰ نقطه دارد. اگر هر نقطه یک تغییر ماندگار باشد،
 * یک خط ساده صدها ورودی در تاریخچه می‌سازد که هرگز جمع نمی‌شود.
 */
export type EphemeralPayload =
  | { kind: "draw-stroke"; points: [number, number][]; color: string; width: number }
  | { kind: "laser"; points: [number, number][] }
  | { kind: "reaction"; emoji: string; x: number; y: number };

export type ConnectionState =
  | { status: "connecting" }
  | { status: "connected"; peers: number }
  | { status: "reconnecting"; attempt: number; nextRetryMs: number }
  | { status: "offline"; pendingChanges: number }
  | { status: "error"; code: string; message: string };

/**
 * وضعیت ذخیره‌سازی.
 *
 * ⚠️ باید **حقیقت** را نشان دهد، نه خوش‌بینی. اگر `saved` نمایش داده شود در
 * حالی که هنوز روی دیسک ننشسته، کاربر تب را می‌بندد و کارش را از دست می‌دهد.
 */
export type SaveState =
  | { status: "saved"; at: number }
  | { status: "saving" }
  | { status: "unsaved"; pendingChanges: number };

export interface CanvasPermissions {
  canEdit: boolean;
  canComment: boolean;
  canExport: boolean;
  canManageAccess: boolean;
}

export interface CanvasDocument {
  elements: HbElement[];
  assets: HbAsset[];
  appState: HbAppState;
}

export type FocusTarget = { kind: "peer"; clientId: number } | { kind: "element"; id: string };

// ─────────────────────────────────────────────────────────────
// بوم → لایه‌ی sync
// ─────────────────────────────────────────────────────────────

/**
 * چیزی که بوم صدا می‌زند.
 *
 * throttle **در بوم** انجام می‌شود، نه در آداپتور — چون بوم می‌داند یک ژست
 * کی تمام می‌شود. جدول فرکانس: [PLAN بخش ۷٫۴](../../../../PLAN.md).
 */
export interface CanvasOutbound {
  /** تغییر عناصر توسط کاربر محلی. */
  emitElementChanges(changes: ElementChangeSet): void;
  /** حرکت مکان‌نما — throttle ۴۰ms. `null` یعنی خروج از بوم. */
  emitPointer(pointer: PointerState | null): void;
  emitSelection(ids: string[]): void;
  /** throttle ۱۰۰ms — برای قابلیت «دنبال‌کردن کاربر». */
  emitViewport(viewport: Viewport): void;
  emitActiveTool(tool: string | null): void;
  /** داده‌ی موقت — بدون ذخیره. `null` یعنی پایان. */
  emitEphemeral(payload: EphemeralPayload | null): void;
  /** بوم منتظر `fileId` می‌ماند و تا آن موقع placeholder نشان می‌دهد. */
  requestAssetUpload(file: File): Promise<HbAsset>;
  /** URL قابل نمایش برای یک فایل موجود (کش‌شونده تا انقضا). */
  resolveAssetUrl(fileId: string): Promise<string>;
  /** بوم آماده شد و اولین رندر انجام شد. */
  emitReady(): void;
}

// ─────────────────────────────────────────────────────────────
// لایه‌ی sync → بوم
// ─────────────────────────────────────────────────────────────

/** چیزی که آداپتور روی بوم صدا می‌زند. */
export interface CanvasInbound {
  /** تغییرات از راه دور. `origin` همیشه `"remote"` است. */
  applyRemoteChanges(changes: ElementChangeSet): void;
  applyPeers(peers: PeerState[]): void;
  setConnectionState(state: ConnectionState): void;
  setSaveState(state: SaveState): void;
  setPermissions(permissions: CanvasPermissions): void;
  /** جایگزینی کامل سند — فقط بارگذاری اولیه یا بازگردانی نسخه. */
  replaceDocument(document: CanvasDocument): void;
  /** پرش نما به یک کاربر یا عنصر. */
  focusOn(target: FocusTarget): void;
}

// ─────────────────────────────────────────────────────────────
// آداپتور
// ─────────────────────────────────────────────────────────────

/** چیزی که ماژول M2 پیاده می‌کند. */
export interface CanvasSyncAdapter {
  /**
   * بوم هنگام mount این را صدا می‌زند و `inbound` خودش را می‌دهد؛
   * آداپتور `outbound` برمی‌گرداند.
   */
  connect(inbound: CanvasInbound): Promise<CanvasOutbound>;
  disconnect(): void;
}

// ─────────────────────────────────────────────────────────────
// نگهبان حلقه‌ی echo
// ─────────────────────────────────────────────────────────────

/**
 * خطای نقض قرارداد — وقتی تغییری با منشأ `remote` دوباره به بیرون فرستاده شود.
 *
 * این رایج‌ترین و بدترین باگ در این نوع معماری است: تغییری که از راه دور رسیده
 * دوباره پخش می‌شود، طرف مقابل هم همین کار را می‌کند، و دو کلاینت تا ابد به هم
 * پیام می‌دهند. چون هر پیام «معتبر» است، هیچ‌جا خطایی دیده نمی‌شود — فقط CPU و
 * پهنای باند می‌سوزد و سند بی‌دلیل رشد می‌کند.
 *
 * پس به‌جای اعتماد به بوم، آداپتور در مرز چک می‌کند.
 */
export class EchoLoopError extends Error {
  constructor(gestureId?: string) {
    super(
      '‏[hamboom] نقض قرارداد sync: تغییری با origin="remote" دوباره emit شد. ' +
        "تغییراتی که با applyRemoteChanges می‌رسند نباید به emitElementChanges برگردند — " +
        "این یک حلقه‌ی بی‌نهایت می‌سازد که هیچ خطایی نمی‌دهد." +
        (gestureId ? ` (gestureId: ${gestureId})` : ""),
    );
    this.name = "EchoLoopError";
  }
}

/**
 * آیا این تغییر مجاز است به بیرون فرستاده شود؟
 *
 * فقط منشأهایی که از **کاربر محلی** می‌آیند. `system` هم مجاز است چون برای
 * migration و اصلاحات خودکار لازم است، ولی `remote` هرگز.
 */
export function isEmittableOrigin(origin: ChangeOrigin): boolean {
  return origin !== "remote";
}

/** اگر منشأ مجاز نباشد خطا می‌دهد. آداپتورها باید این را در `emitElementChanges` صدا بزنند. */
export function assertEmittable(changes: ElementChangeSet): void {
  if (!isEmittableOrigin(changes.origin)) {
    throw new EchoLoopError(changes.gestureId);
  }
}
