import type {
  EphemeralPayload,
  PeerState,
  PeerUser,
  PointerState,
  Viewport,
} from "@hamboom/canvas-core/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import type * as Y from "yjs";

import { HB_THROTTLE } from "./emit-local.ts";

/**
 * مسیرِ **حضور** — `y-protocols/awareness` در یک سر، `PeerState[]`ِ قراردادِ M1 در
 * سرِ دیگر.
 *
 * ── ★★ دو کانال، نه یکی ───────────────────────────────────────────────
 *
 * | چه چیزی | کانال | چرا |
 * |---|---|---|
 * | کاربر · مکان‌نما · انتخاب · نما · ابزار | `AWARENESS` (0x01) | **حالت** است: تا وقتی عوض نشده معتبر می‌مانَد |
 * | استروکِ در حالِ کشیدن · لیزر · reaction | `HB_EPHEMERAL` (0x13) | **رویداد** است: یک‌بار دیده می‌شود و تمام |
 *
 * وسوسه‌اش این بود که `PeerState.ephemeral` را هم یک فیلد در همان stateِ awareness
 * بگذاریم — قرارداد که همان یک شیء را می‌خواهد. **سنجیده شد و بد بود**، دلیلش در
 * [ADR-036](../../../ARCHITECTURE_DECISIONS.md#adr-036): `encodeAwarenessUpdate`
 * هر بار **کلِ state** را `JSON.stringify` می‌کند، پس یک استروکِ ۲۰۰نقطه‌ای در
 * state یعنی هر حرکتِ مکان‌نما (هر ۴۰ms) همان استروک را **دوباره کامل** می‌فرستد.
 *
 * ── چه چیزی اینجا **نیست** ────────────────────────────────────────────
 *
 * **رندرِ** حضور (مکان‌نما، هاله‌ی انتخاب، آواتار) و re-project با تغییرِ viewport
 * کارِ گام ۳٫۷ اند (G-1الف). اینجا فقط **کانال** ساخته می‌شود: `PeerState[]` درست
 * و به‌موقع به `applyPeers` می‌رسد.
 */

/** originی که خودِ `y-protocols` روی تغییرِ محلی می‌گذارد — رشته‌ی خودشان است، نه ما. */
const LOCAL_AWARENESS_ORIGIN = "local";

/** نامِ جایگزین وقتی همتا `user` نفرستاده یا خراب فرستاده. */
const UNKNOWN_PEER: Omit<PeerUser, "id"> = {
  displayName: "کاربر ناشناس",
  color: "#8A8A8A",
  avatarUrl: null,
};

/** شکلِ stateِ awareness. کلیدها **روی سیم می‌روند** — عوضشان نکن. */
interface AwarenessFields {
  user: PeerUser;
  pointer: PointerState | null;
  selectedIds: string[];
  viewport: Viewport | null;
  activeTool: string | null;
}

/** رویدادِ `awareness.on("update")` — تایپِ خودِ lib0 `Function` است. */
interface AwarenessChange {
  added: number[];
  updated: number[];
  removed: number[];
}

export interface PresenceSink {
  /** پیامِ awarenessِ محلی، آماده‌ی قاب‌بندی. */
  sendAwareness(payload: Uint8Array): void;
  /** payloadِ ephemeral — برای سرور **مات** است (PLAN بخش ۵٫۳). */
  sendEphemeral(payload: string): void;
  /** فهرستِ همتاها عوض شد — **بدونِ خودمان**. */
  onPeersChanged(peers: PeerState[]): void;
}

/** بازنویسیِ اعدادِ [`HB_THROTTLE`](./emit-local.ts) — **فقط برای تست**. */
export interface PresenceThrottleOptions {
  pointerMs?: number;
  viewportMs?: number;
}

export interface PresenceScopeOptions {
  doc: Y.Doc;
  user: PeerUser;
  sink: PresenceSink;
  throttle?: PresenceThrottleOptions;
  /**
   * ★★ ادامه‌ی شمارنده‌ی همان `clientId` — **بدونِ این، اتصالِ دوباره نامرئی است.**
   *
   * awareness هر همتا را با یک `clock`ِ صعودی می‌شناسد و هر پیامی که clockش از
   * آنچه گیرنده دارد بزرگ‌تر نباشد را **بی‌صدا دور می‌ریزد**. `clientId` از
   * `doc.clientID` می‌آید و بین اتصال‌ها **عوض نمی‌شود**، ولی یک `Awareness`ِ تازه
   * از صفر می‌شمارد. یعنی بعد از `disconnect`/`connect` همتاها ما را با clockِ ۱
   * می‌بینند در حالی که ۲۰۰ ثبت کرده‌اند → ما برای همیشه ناپدید می‌شویم.
   *
   * زیر StrictMode این چرخه در **هر** mount رخ می‌دهد، پس این حالتِ عادی است نه
   * استثنا. در گام ۳٫۵ یک تست همین را گرفت.
   */
  clock?: number;
}

export interface PresenceScope {
  /** همان `doc.clientID` — کلیدِ همتا روی هر دو کانال. */
  readonly clientId: number;
  /**
   * ★★ معرفیِ اولیه — **جدا از ساخت، و این عمدی است.**
   *
   * ترابریِ لوکال **همزمان** است: به محضِ فرستادنِ معرفی، پاسخِ همتا در همان
   * پشته‌ی فراخوانی برمی‌گردد. اگر معرفی داخلِ سازنده انجام می‌شد، آن پاسخ به
   * آداپتوری می‌رسید که هنوز `this.presence` را مقداردهی نکرده — و **بی‌صدا دور
   * ریخته می‌شد**. نتیجه‌اش دقیقاً همان چیزی بود که در گام ۳٫۵ دیدیم: الف همتا را
   * می‌دید، ب هیچ‌کس را.
   *
   * پس صداکننده باید اول دامنه را جایی بنشانَد که پیام‌های ورودی پیدایش کنند،
   * **بعد** `announce()` بزند.
   */
  announce(): void;
  /**
   * ★★ معرفیِ دوباره بعد از اتصالِ مجدد — **حالتِ فعلی را پاک نمی‌کند** (گام ۵٫۱).
   *
   * ⚠️ `announce()` جایش را نمی‌گیرد: آن مکان‌نما و انتخاب و نما را به `null`
   * برمی‌گرداند، یعنی هر اتصالِ مجدد کاربر را برای همتاها به یک آدمِ تازه‌رسیده
   * تبدیل می‌کند.
   *
   * ★ و صرفِ **فرستادنِ دوباره** هم کافی نیست: هنگام قطع، سرور حذفِ ما را پخش
   * کرده و هر همتا آن را با **همان** clock ثبت کرده. `applyAwarenessUpdate`
   * پیامی با clockِ مساوی را بی‌صدا دور می‌ریزد، پس معرفیِ تکراری هیچ اثری
   * ندارد و ما برای همیشه نامرئی می‌مانیم. `setLocalState` شمارنده را
   * **بی‌قید و شرط** یکی جلو می‌برد — و همان تنها چیزی است که این را رفع می‌کند.
   */
  reannounce(): void;
  setPointer(pointer: PointerState | null): void;
  setSelection(ids: string[]): void;
  setViewport(viewport: Viewport): void;
  setActiveTool(tool: string | null): void;
  setEphemeral(payload: EphemeralPayload | null): void;
  /** پیامِ `AWARENESS`ِ رسیده از همتا. */
  receiveAwareness(payload: Uint8Array): void;
  /** پیامِ `HB_EPHEMERAL`ِ رسیده از همتا. */
  receiveEphemeral(clientId: number, payload: string): void;
  /** وضعیتِ فعلیِ همتاها — **بدونِ خودمان**، مرتب بر اساس `clientId`. */
  peers(): PeerState[];
  /** شمارنده‌ی فعلیِ خودمان — ورودیِ `clock`ِ اتصالِ بعدی. */
  clock(): number;
  /** ★ آخرین حرف «رفتم» است — باید **قبل از** قطعِ ترابری صدا زده شود. */
  destroy(): void;
}

/**
 * throttleِ **trailing**ِ تک‌مقداری — همان قاعده‌ی `createEmitScheduler`، یک اندازه
 * کوچک‌تر: آنجا چند عنصر با شناسه ادغام می‌شوند، اینجا فقط **آخرین مقدار** می‌مانَد.
 *
 * ⚠️ `cancel` عمداً flush **نمی‌کند** — برخلافِ `dispose`ِ مسیرِ عنصر. آنجا آخرین
 * تیکِ درگ کارِ کاربر است و گم‌شدنش یعنی از دست رفتنِ داده؛ اینجا آخرین مکان‌نما
 * لحظه‌ای است که همان موقع هم دیگر درست نیست.
 */
function createTrailing(ms: number, run: () => void): { schedule(): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule() {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        run();
      }, ms);
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

function isPointer(value: unknown): value is PointerState {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PointerState>;
  return typeof candidate.x === "number" && typeof candidate.y === "number";
}

function isViewport(value: unknown): value is Viewport {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Viewport>;
  return (
    typeof candidate.scrollX === "number" &&
    typeof candidate.scrollY === "number" &&
    typeof candidate.zoom === "number"
  );
}

function toUser(clientId: number, value: unknown): PeerUser {
  if (typeof value !== "object" || value === null) return { id: `c_${clientId}`, ...UNKNOWN_PEER };
  const candidate = value as Partial<PeerUser>;
  return {
    id: typeof candidate.id === "string" ? candidate.id : `c_${clientId}`,
    displayName:
      typeof candidate.displayName === "string" ? candidate.displayName : UNKNOWN_PEER.displayName,
    color: typeof candidate.color === "string" ? candidate.color : UNKNOWN_PEER.color,
    avatarUrl: typeof candidate.avatarUrl === "string" ? candidate.avatarUrl : null,
  };
}

/**
 * ★ خواندنِ stateِ یک همتا — **هیچ‌چیزش قابلِ اعتماد نیست.**
 *
 * این شیء از `JSON.parse`ِ بایت‌هایی می‌آید که یک کلاینتِ دیگر فرستاده. یک فیلدِ
 * ناقص نباید رندرِ بقیه‌ی همتاها را بشکند، پس هر فیلد جدا اعتبارسنجی می‌شود و
 * جایگزینِ **دیدنی** می‌گیرد (نه حذفِ خودِ همتا — مکان‌نمای گم‌شده تشخیصش سخت‌تر از
 * نامِ «کاربر ناشناس» است).
 */
function toPeerState(
  clientId: number,
  raw: unknown,
  ephemeral: EphemeralPayload | null,
): PeerState {
  const state = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<AwarenessFields>;
  return {
    clientId,
    user: toUser(clientId, state.user),
    pointer: isPointer(state.pointer) ? state.pointer : null,
    selectedIds: Array.isArray(state.selectedIds)
      ? state.selectedIds.filter((id): id is string => typeof id === "string")
      : [],
    viewport: isViewport(state.viewport) ? state.viewport : null,
    activeTool: typeof state.activeTool === "string" ? state.activeTool : null,
    ephemeral,
  };
}

/** سه `kind`ِ [ADR-022](../../../ARCHITECTURE_DECISIONS.md#adr-022). */
const EPHEMERAL_KINDS: ReadonlySet<string> = new Set(["draw-stroke", "laser", "reaction"]);

/**
 * ★ **اگر نفهمیدیم، پاکش می‌کنیم.**
 *
 * سه حالت به یک نتیجه می‌رسند: `null`ِ صریح (پایانِ استروک)، JSONِ خراب، و
 * `kind`ی که این نسخه نمی‌شناسد (کلاینتِ **جدیدتر**). گزینه‌ی دیگر «نگه‌داشتنِ
 * مقدارِ قبلی» بود که یک استروکِ نیمه‌کاره را تا ابد روی بومِ همه جا می‌گذاشت.
 *
 * سکوت اینجا همان سکوتِ «نوعِ پیامِ ناشناخته» در گام ۲٫۴ است: کلاینتِ قدیمی نباید
 * با رسیدنِ یک ephemeralِ تازه بشکند.
 */
function parseEphemeral(payload: string): EphemeralPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const kind = (value as { kind?: unknown }).kind;
  if (typeof kind !== "string" || !EPHEMERAL_KINDS.has(kind)) return null;
  return value as EphemeralPayload;
}

export function createPresenceScope({
  doc,
  user,
  sink,
  throttle = {},
  clock = 0,
}: PresenceScopeOptions): PresenceScope {
  const awareness = new awarenessProtocol.Awareness(doc);
  const pointerMs = throttle.pointerMs ?? HB_THROTTLE.pointerMs;
  const viewportMs = throttle.viewportMs ?? HB_THROTTLE.viewportMs;

  // ⚠️ `meta` یک فیلدِ **عمومی**ِ `Awareness` است (در `.d.ts`ِ خودشان)، ولی
  //    نوشتن رویش کارِ رایجی نیست. اگر روزی نسخه‌ی بعدیِ y-protocols شکلش را عوض
  //    کند، تستِ «اتصالِ دوباره دیده می‌شود» فوراً قرمز می‌شود — که دقیقاً همان
  //    چیزی است که از یک نگهبان می‌خواهیم.
  if (clock > 0) {
    awareness.meta.set(awareness.clientID, { clock, lastUpdated: Date.now() });
  }

  /** ephemeralِ همتاها — **هرگز داخلِ سند نمی‌رود** (ADR-022). */
  const ephemeral = new Map<number, EphemeralPayload>();

  let pendingPointer: PointerState | null = null;
  let pendingViewport: Viewport | null = null;

  const pointerThrottle = createTrailing(pointerMs, () => {
    awareness.setLocalStateField("pointer", pendingPointer);
  });
  const viewportThrottle = createTrailing(viewportMs, () => {
    awareness.setLocalStateField("viewport", pendingViewport);
  });

  function peers(): PeerState[] {
    const result: PeerState[] = [];
    for (const [clientId, raw] of awareness.getStates()) {
      if (clientId === awareness.clientID) continue;
      result.push(toPeerState(clientId, raw, ephemeral.get(clientId) ?? null));
    }
    // ترتیبِ `Map` ترتیبِ **ورود** است و روی هر کلاینت فرق می‌کند؛ با مرتب‌سازی
    // همه یک فهرست می‌بینند — همان دلیلی که `readDocument` با `index` مرتب می‌کند.
    return result.sort((first, second) => first.clientId - second.clientId);
  }

  const onUpdate = (change: AwarenessChange, origin: unknown): void => {
    if (origin === LOCAL_AWARENESS_ORIGIN) {
      const touched = [...change.added, ...change.updated, ...change.removed];
      sink.sendAwareness(awarenessProtocol.encodeAwarenessUpdate(awareness, touched));
    } else if (change.added.some((clientId) => clientId !== awareness.clientID)) {
      // ★★ همتای تازه رسید — **خودمان را معرفی می‌کنیم.**
      //
      // awareness هیچ پیامِ «چه کسانی هستید؟» ندارد: هرکس فقط تغییرِ خودش را پخش
      // می‌کند. بدونِ این پاسخ، کسی که دیرتر آمده تا اولین تکانِ مکان‌نمای ما
      // **نامرئی** می‌مانَد. همان الگوی step1/step2ِ گام ۳٫۱، یک لایه بالاتر.
      //
      // حلقه نمی‌سازد: پاسخِ ما با clockِ فعلی می‌رود و گیرنده همان clock را از
      // قبل دارد، پس `applyAwarenessUpdate` هیچ رویدادی نمی‌دهد و زنجیره می‌ایستد.
      sink.sendAwareness(awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID]));
    }

    // ★ خروجِ همتا باید ephemeralش را هم ببرد، وگرنه یک استروکِ نیمه‌کاره تا ابد
    //   روی بوم می‌مانَد — و صاحبش دیگر آنجا نیست که پاکش کند.
    for (const clientId of change.removed) ephemeral.delete(clientId);

    sink.onPeersChanged(peers());
  };

  awareness.on("update", onUpdate);

  function announce(): void {
    // از همین مسیرِ `onUpdate` پخش می‌شود — observer از قبل سوار است.
    awareness.setLocalState({
      user,
      pointer: null,
      selectedIds: [],
      viewport: null,
      activeTool: null,
    } satisfies AwarenessFields);
  }

  return {
    clientId: awareness.clientID,

    announce,

    reannounce() {
      const current = awareness.getLocalState();
      // هنوز چیزی نگفته‌ایم (یا `destroy` پاکش کرده) → معرفیِ کامل.
      if (!current) {
        announce();
        return;
      }
      // همان حالت، ولی با شمارنده‌ی یکی جلوتر — چراییِ کامل بالای `reannounce`.
      awareness.setLocalState(current);
    },

    setPointer(pointer) {
      pendingPointer = pointer;
      // ★ خروجِ مکان‌نما از بوم **فوری** است، مثلِ حذف در مسیرِ عنصر: یک رویدادِ
      //   گسسته است، نه یک نمونه از جریانِ پیوسته. با throttle، مکان‌نمای همتا تا
      //   ۴۰ms بعد از خروج هنوز روی بوم می‌مانْد.
      if (pointer === null) {
        pointerThrottle.cancel();
        awareness.setLocalStateField("pointer", null);
        return;
      }
      pointerThrottle.schedule();
    },

    setSelection(ids) {
      // PLAN ۷٫۴: انتخاب **فوری** است — کم‌فرکانس و مستقیماً دیدنی.
      awareness.setLocalStateField("selectedIds", [...ids]);
    },

    setViewport(viewport) {
      pendingViewport = viewport;
      viewportThrottle.schedule();
    },

    setActiveTool(tool) {
      awareness.setLocalStateField("activeTool", tool);
    },

    setEphemeral(payload) {
      // بدونِ throttle: نرخش را خودِ بوم تعیین می‌کند (یک نقطه در هر فریمِ کشیدن)،
      // و throttle کردنش یعنی استروکِ همتا تکه‌تکه دیده شود.
      sink.sendEphemeral(JSON.stringify(payload));
    },

    receiveAwareness(payload) {
      awarenessProtocol.applyAwarenessUpdate(awareness, payload, "hamboom:remote");
    },

    receiveEphemeral(clientId, payload) {
      if (clientId === awareness.clientID) return;
      const value = parseEphemeral(payload);
      if (value === null) ephemeral.delete(clientId);
      else ephemeral.set(clientId, value);
      sink.onPeersChanged(peers());
    },

    peers,

    clock: () => awareness.meta.get(awareness.clientID)?.clock ?? 0,

    destroy() {
      pointerThrottle.cancel();
      viewportThrottle.cancel();
      // ★★ ترتیب مهم است: `setLocalState(null)` **قبل از** برداشتنِ observer، تا
      //    «رفتم» از همان مسیرِ همیشگی پخش شود. برعکسش یعنی همتاها یک مکان‌نمای
      //    یخ‌زده می‌بینند تا وقتی awareness بعد از ۳۰ ثانیه خودش پاکش کند.
      awareness.setLocalState(null);
      awareness.off("update", onUpdate);
      ephemeral.clear();
      // ⚠️ `Awareness` یک `setInterval` دارد (تازه‌کردنِ clock + جاروی همتاهای
      //    کهنه). بدونِ این `destroy`، هر چرخه‌ی mount/unmountِ StrictMode یکی
      //    جا می‌گذارد.
      awareness.destroy();
      // ⚠️ **آنچه این پاک نمی‌کند:** سازنده‌ی `Awareness` یک شنونده روی
      //    `doc.on("destroy")` می‌گذارد و ارجاعش را جایی نمی‌دهد، پس هر اتصال
      //    یکی به سندِ مشترک اضافه می‌کند. تا وقتی خودِ سند destroy نشود، آن
      //    نمونه‌های مرده رهاشدنی نیستند. اندازه‌اش ناچیز است (دو `Map`ِ خالی) و
      //    راهی برای برداشتنش از API عمومی نیست — ثبت شده تا اگر روزی یک
      //    نشتِ حافظه‌ی واقعی دیدیم، اول اینجا را نگاه کنیم.
    },
  };
}
