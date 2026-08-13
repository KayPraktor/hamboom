import {
  assertEmittable,
  type CanvasDocument,
  type CanvasInbound,
  type CanvasOutbound,
  type CanvasPermissions,
  type CanvasSyncAdapter,
  type ElementChangeSet,
  type PeerState,
  type PeerUser,
} from "@hamboom/canvas-core/sync";
import type { HbAsset, HbElement } from "@hamboom/shared-types";
import {
  boardRoots,
  createBoardDoc,
  decodeMessage,
  encodeMessage,
  MSG_TYPES,
  readDocument,
  readElement,
  writeAsset,
  writeElement,
} from "@hamboom/ydoc-schema";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

import type { AssetTransport } from "./assets.ts";
import {
  createPresenceScope,
  type PresenceScope,
  type PresenceThrottleOptions,
} from "./awareness.ts";
import {
  createEmitScheduler,
  LocalOrigin,
  type EmitScheduler,
  type EmitSchedulerOptions,
} from "./emit-local.ts";
import type { SyncTransport, TransportStatus } from "./transport.ts";
import type { LocalDocStore } from "./local-store.ts";
import { createUndoScope, type UndoScope } from "./undo.ts";

/**
 * `YjsSyncAdapter` — پیاده‌سازیِ `CanvasSyncAdapter`ِ M1 روی `Y.Doc`. **قلبِ M2.**
 *
 * مرجعِ رفتاری: [`canvas-core/src/sync/local-adapter.ts`](../../canvas-core/src/sync/local-adapter.ts)
 * و چرخه‌ی عمرِ ۹مرحله‌ایِ [`sync/README.md`](../../canvas-core/src/sync/README.md).
 *
 * ── وضعیتِ گام ۳٫۱ ────────────────────────────────────────────────────
 *
 * این اسکلت است: چرخه‌ی عمر، نگهبانِ echo، و مسیرِ **کاملِ رفت‌وبرگشتِ عنصر** تا
 * بشود ادعای «بومِ بدرفتار» را روی آداپتورِ **واقعی** آزمود. آنچه هنوز نیامده و
 * گامِ خودش را دارد:
 *
 * | چه چیزی | گام |
 * |---|---|
 * | `captureUpdate: "NEVER"` هنگام نوشتنِ remote روی صحنه + گیتِ ESLint | ۳٫۲ ✅ |
 * | `Y.UndoManager` با `trackedOrigins` | ۳٫۴ ✅ |
 * | awareness → `PeerState[]` (مکان‌نما، انتخاب، نما، ابزار، ephemeral) | ۳٫۵ ✅ |
 * | آپلود و URLِ دارایی | ۳٫۶ |
 */

/** originِ updateهایی که از ترابری رسیده‌اند. */
export const REMOTE_ORIGIN = "hamboom:remote";

/**
 * کاربرِ پیش‌فرض — تا وقتی `BoardAuthority` (فاز ۴) هویتِ واقعی را ندهد.
 *
 * همان مقادیرِ [`local-adapter`](../../canvas-core/src/sync/local-adapter.ts)ِ M1،
 * تا دو پیاده‌سازیِ یک قرارداد در دموها متفاوت رفتار نکنند.
 */
export const DEFAULT_PEER_USER: PeerUser = {
  id: "u_local",
  displayName: "کاربر محلی",
  color: "#5B8DEF",
  avatarUrl: null,
};

export interface YjsSyncAdapterOptions {
  /** سندِ موجود (مثلاً بازیابی‌شده از snapshot). پیش‌فرض: سندِ نو. */
  doc?: Y.Doc;
  /** ترابری. نبودش یعنی حالتِ تک‌نفره‌ی آفلاین — سند کار می‌کند، چیزی پخش نمی‌شود. */
  transport?: SyncTransport;
  /**
   * مجوزها. تا وقتی `BoardAuthority` (فاز ۴) نیست، مقدارِ ورودی است نه
   * محاسبه‌شده — و **هرگز** نباید تنها سدِ مجوز باشد: اعمالِ واقعی در سرور است
   * ([ADR-012](../../../ARCHITECTURE_DECISIONS.md#adr-012)، گام ۴٫۵).
   */
  permissions?: CanvasPermissions;
  /**
   * هویتِ این کاربر روی کانالِ حضور. مثلِ `permissions` **ورودی** است نه
   * محاسبه‌شده — منبعِ واقعی‌اش `BoardAuthority`ِ فاز ۴ است.
   */
  user?: PeerUser;
  /**
   * پورتِ دارایی ([`assets.ts`](./assets.ts)). نبودش یعنی آپلود **خطا می‌دهد** —
   * نه اینکه بی‌صدا کار نکند.
   */
  assets?: AssetTransport;
  /** بازنویسیِ اعدادِ جدولِ throttle — **فقط برای تست**. */
  throttle?: EmitSchedulerOptions & PresenceThrottleOptions;
  /**
   * پایداریِ **محلیِ** سند (گام ۵٫۲) — [`local-store.ts`](./local-store.ts).
   *
   * نبودش یعنی سند فقط در حافظه است: بستنِ تب کارِ نرسیده به سرور را می‌بَرد.
   * ⚠️ چرخه‌ی عمرش مالِ **صداکننده** است، نه آداپتور: `disconnect` آن را
   * `destroy` نمی‌کند، چون زیر StrictMode هر mount یک بار باز و بسته‌اش می‌کرد.
   */
  localStore?: LocalDocStore;
}

/** رویدادِ `observeDeep` — تایپِ خودِ Yjs `any` است و اینجا مهارش می‌کنیم. */
type DeepEvent = Y.YEvent<Y.AbstractType<unknown>>;

/**
 * `connect` وسطِ راه لغو شد (یک `disconnect` یا `connect`ِ تازه رسید).
 *
 * ★ این دقیقاً همان چیزی است که **StrictMode** می‌سازد: افکت اجرا می‌شود،
 * `connect` روی اولین `await` معلق می‌مانَد، cleanup فوراً `disconnect` را صدا
 * می‌زند، و بعد افکت دوباره اجرا می‌شود. بدونِ این نگهبان، ادامه‌ی `connect`ِ
 * اول observerهایش را روی سند سوار می‌کرد که هیچ `disconnect`ی سراغشان نمی‌آمد
 * — یک نشتیِ تمام‌عیار که فقط زیر StrictMode ظاهر می‌شود.
 */
export class ConnectionCancelledError extends Error {
  constructor() {
    super("‏[hamboom] اتصال پیش از کامل‌شدن لغو شد (disconnect یا connectِ تازه).");
    this.name = "ConnectionCancelledError";
  }
}

const FULL_PERMISSIONS: CanvasPermissions = {
  canEdit: true,
  canComment: true,
  canExport: true,
  canManageAccess: true,
};

export class YjsSyncAdapter implements CanvasSyncAdapter {
  private readonly doc: Y.Doc;
  private readonly transport: SyncTransport | null;
  private readonly permissions: CanvasPermissions;
  private readonly user: PeerUser;
  private readonly assets: AssetTransport | null;
  private readonly throttle: EmitSchedulerOptions & PresenceThrottleOptions;

  private inbound: CanvasInbound | null = null;
  /** همه‌ی لغوها یک‌جا — `disconnect` نباید هیچ‌کدام را جا بگذارد. */
  private teardown: Array<() => void> = [];
  /** شناسه‌ی عناصری که یک تراکنشِ remote دست زده و هنوز به بوم نرفته‌اند. */
  private readonly pendingRemote = new Set<string>();
  /** شمارنده‌ی نسلِ اتصال — هر `connect`/`disconnect` یکی جلو می‌بردش. */
  private epoch = 0;
  /** صف‌بندیِ مسیرِ محلی — فقط بین `connect` و `disconnect` زنده است. */
  private scheduler: EmitScheduler | null = null;
  /** دامنه‌ی undo — ★ **Yjs صاحبِ undo است، نه موتور** (گام ۳٫۴). */
  private undoScope: UndoScope | null = null;
  /** `gestureId`ِ آخرین commit — مرزِ ورودی‌های undo از همین می‌آید. */
  private lastGestureId: string | undefined;
  /** کانالِ حضور — فقط بین `connect` و `disconnect` زنده است (گام ۳٫۵). */
  private presence: PresenceScope | null = null;
  /** آخرین تعدادِ همتای گزارش‌شده — برای اینکه `setConnectionState` هرزه نشود. */
  private peerCount = 0;
  /**
   * شمارنده‌ی awarenessِ همین `clientId`، **بین اتصال‌ها حفظ می‌شود**.
   *
   * ⚠️ بدونِ این، اتصالِ دوباره برای همتاها **نامرئی** است: `clientId` همان
   * `doc.clientID` است و عوض نمی‌شود، ولی یک `Awareness`ِ تازه از صفر می‌شمارد و
   * هر پیامِ با clockِ کوچک‌تر بی‌صدا دور ریخته می‌شود. توضیحِ کامل در
   * [`awareness.ts`](./awareness.ts) روی گزینه‌ی `clock`.
   */
  private presenceClock = 0;
  /**
   * آیا ترابری همین الان باز است؟
   *
   * ⚠️ **ترابریِ بدونِ کانالِ وضعیت همیشه «باز» است** — یعنی `LocalTransport`ِ
   * فاز ۳، که اصلاً قطع نمی‌شود. بدونِ این پیش‌فرض، همه‌ی تست‌های فاز ۳ به یک
   * کلاینتِ همیشه-آفلاین تبدیل می‌شدند.
   */
  private linkUp = true;
  /**
   * ★★ شناسه‌ی **عناصری** که وقتی سیم قطع بود محلی عوض شدند — ورودیِ
   * `offline{pendingChanges}`.
   *
   * ⚠️ **مجموعه است، نه شمارنده، و این عمدی است.** در گام ۵٫۱ اینجا تعدادِ
   * updateهای نرفته شمرده می‌شد؛ عددش درست بود ولی به کاربر دروغ می‌گفت: یک
   * درگِ ده‌ثانیه‌ای روی **یک** استیکی حدودِ ۲۰۰ update می‌سازد و نوارِ وضعیت
   * «آفلاین — ۲۰۰ تغییرِ معلق» نشان می‌داد. رشته‌ی فارسیِ M1
   * (`connection.offline`) این عدد را **به کاربر نشان می‌دهد**، پس واحدش باید
   * چیزی باشد که کاربر می‌شناسد: عنصر، نه پیامِ پروتکل.
   *
   * ⚠️ **و محدودیتش را بدان:** این «از ابتدای تاریخ» نیست، از لحظه‌ی قطعِ سیم
   * در **همین نشست** است. تبی که آفلاین باز شود کارِ ذخیره‌شده‌ی قبلی را صفر
   * می‌شمارد — چون نمی‌داند آن کار قبلاً به سرور رسیده بود یا نه. جبرانش در
   * `SaveState` است: تا وقتی سیم قطع است **هیچ‌وقت** `saved` گفته نمی‌شود.
   */
  private readonly offlineTouched = new Set<string>();
  /**
   * آخرین وضعیتی که به بوم گفته شد — تا `collectOffline` بداند آیا عددِ
   * `offline{pendingChanges}` روی صفحه هست یا نه.
   */
  private lastConnection: "connecting" | "connected" | "reconnecting" | "offline" | "error" | null =
    null;
  /** پایداریِ محلی (گام ۵٫۲). نبودش یعنی سند فقط در حافظه است. */
  private readonly localStore: LocalDocStore | null;

  constructor(options: YjsSyncAdapterOptions = {}) {
    this.doc = options.doc ?? createBoardDoc();
    this.transport = options.transport ?? null;
    this.permissions = options.permissions ?? FULL_PERMISSIONS;
    this.user = options.user ?? DEFAULT_PEER_USER;
    this.assets = options.assets ?? null;
    this.throttle = options.throttle ?? {};
    this.localStore = options.localStore ?? null;
  }

  /** سندِ زیرین — برای تست و برای دموی دو-نمونه‌ای (گام ۳٫۷). */
  get document(): Y.Doc {
    return this.doc;
  }

  /**
   * دامنه‌ی undo — فقط بین `connect` و `disconnect` وجود دارد.
   *
   * ★ **Yjs صاحبِ undo است، نه موتور** ([ADR-035](../../../ARCHITECTURE_DECISIONS.md#adr-035)).
   * اپ باید `bindUndoShortcuts` را به کار ببرد تا `Ctrl+Z` به اینجا برسد و نه
   * به تاریخچه‌ی موتور — وگرنه یک `Ctrl+Z` دو کار می‌کند.
   *
   * ⚠️ **`undo`/`redo` اینجا پوشیده شده‌اند تا بعدشان `flushRemote` صدا زده شود.**
   * دلیلش یک شکافِ واقعیِ گام ۳٫۱ بود که در ۳٫۴ بیرون آمد: `observeDeep` تغییرِ
   * غیرِمحلی را فقط **جمع** می‌کند و تحویلش به `handleMessage` گره خورده بود.
   * originِ undo نه `LocalOrigin` است و نه از ترابری می‌آید، پس تغییر در صف
   * می‌مانْد و **بوم undoِ خودش را نمی‌دید**.
   *
   * ★ قاعده‌ای که ماند: **هر مسیرِ نوشتنِ تازه‌ای که originش `LocalOrigin` نیست،
   * باید بعدش `flushRemote` را صدا بزند.**
   */
  get undo(): UndoScope | null {
    const scope = this.undoScope;
    if (!scope) return null;
    return {
      ...scope,
      undo: () => {
        scope.undo();
        this.flushRemote();
      },
      redo: () => {
        scope.redo();
        this.flushRemote();
      },
    };
  }

  /**
   * چرخه‌ی عمرِ ۹مرحله‌ای — [`sync/README.md`](../../canvas-core/src/sync/README.md).
   *
   * ★ **دوبار `connect` بدونِ `disconnect` خطا می‌دهد، نه اینکه بی‌صدا دومی را
   * سوار کند.** StrictMode هر افکت را دوبار اجرا می‌کند؛ اگر اینجا ساکت بودیم،
   * دو مجموعه observer روی یک سند می‌نشست و هر تغییرِ remote **دوبار** به بوم
   * می‌رفت — باگی که فقط زیر StrictMode ظاهر می‌شود و رد زدنش تقریباً ناممکن است.
   * الگوی درست (ADR-032) در `useEffect([api])` cleanup برمی‌گرداند، پس این خطا
   * فقط وقتی رخ می‌دهد که کسی از الگو خارج شده باشد.
   */
  async connect(inbound: CanvasInbound): Promise<CanvasOutbound> {
    if (this.inbound) {
      throw new Error(
        "‏[hamboom] YjsSyncAdapter.connect دوبار بدونِ disconnect صدا زده شد. " +
          "اشتراک را در useEffect([api]) ببند و cleanup را برگردان (ADR-032).",
      );
    }

    const token = ++this.epoch;
    this.inbound = inbound;
    this.offlineTouched.clear();
    // ★ ترابریِ دارای کانالِ وضعیت هنوز باز نیست — تا رویدادِ `open` نرسیده،
    //   هر تغییرِ محلی یک `pendingChange` است، نه چیزی که رفته باشد.
    this.linkUp = !this.transport?.onStatus;
    inbound.setConnectionState({ status: "connecting" });

    // ★★ **اول حافظه‌ی محلی، بعد شبکه** — گام ۵٫۲.
    //
    // ⚠️ ترتیبش اجباری است، نه ترجیحی. اگر بعد از دست‌دادن بیاید: (۱) `step2`ِ
    //    ما بدونِ کارِ آفلاین می‌رود و سرور هرگز آن را نمی‌بیند، و (۲) بوم یک
    //    لحظه بوردِ خالی رندر می‌کند و بعد کارِ ذخیره‌شده به‌صورت «تغییرِ remote»
    //    رویش می‌ریزد.
    //
    // ★ و چون observerها **بعد از** این نقطه سوار می‌شوند، بازیابیِ محلی به
    //   شمارنده‌ی `pendingChanges` نمی‌افتد — کارِ ذخیره‌شده «تغییرِ تازه» نیست.
    if (this.localStore) {
      await this.localStore.whenReady;
      // ★ همان قاعده‌ی همیشگی: بعد از هر `await` بررسی کن هنوز همان اتصالیم.
      if (this.epoch !== token) throw new ConnectionCancelledError();
    }

    await this.transport?.connect?.();
    // ★ بعد از **هر** await باید بررسی شود که هنوز همان اتصالیم — StrictMode
    //   دقیقاً همین‌جا `disconnect` را می‌چپاند.
    if (this.epoch !== token) throw new ConnectionCancelledError();

    // ★★ ترتیبِ این چهار خط عمدی است و با تست قفل شده.
    //
    // ۱. ترابری اول وصل شود تا پاسخِ همتا جایی برای نشستن داشته باشد.
    // ۲. **همگام‌سازیِ اولیه قبل از `replaceDocument`** — وگرنه بوم یک لحظه
    //    بوردِ خالی رندر می‌کند و بعد همه‌ی عناصر به‌صورت «تغییرِ remote» رویش
    //    می‌ریزند.
    // ۳. `replaceDocument` با سندِ کامل.
    // ۴. **observer بعد از آن** — هرچه از این لحظه برسد یک تغییرِ واقعی است، نه
    //    بخشی از بارگذاریِ اولیه. بینِ ۳ و ۴ هیچ `await`ی نیست، پس پیامی
    //    نمی‌تواند لای این دو بیفتد.
    this.undoScope = createUndoScope(this.doc);
    this.scheduler = createEmitScheduler(
      {
        commit: (queued) => this.commitChanges(queued),
        has: (id) => boardRoots(this.doc).elements.has(id),
        textOf: (id) => this.currentText(id),
      },
      this.throttle,
    );
    this.wireTransport();
    this.requestInitialSync();
    inbound.replaceDocument(readDocument(this.doc) satisfies CanvasDocument);
    this.wireDocument();
    this.wirePresence();

    inbound.setPermissions(this.permissions);
    // ★★ **«وصل شدم» را فقط وقتی می‌گوییم که کسی خبرِ دقیق‌تری ندارد.**
    //
    // ⚠️ با ترابریِ WebSocket (گام ۵٫۱) سوکت در این لحظه هنوز باز **نشده** —
    //    `connect` عمداً منتظرش نمی‌مانَد. ادعای «connected» اینجا یعنی نوارِ
    //    وضعیت سبز شود در حالی که هیچ بایتی رد و بدل نشده؛ همان دروغِ
    //    خوش‌بینانه‌ای که قراردادِ M1 درباره‌ی `SaveState` منع کرده، یک ردیف
    //    بالاتر. با کانالِ وضعیت، حقیقت از `handleStatus` می‌آید.
    if (!this.transport?.onStatus) {
      // همتاها هنوز نرسیده‌اند — معرفیِ awareness همین الان رفت و پاسخشان یک
      // رفت‌وبرگشت بعد می‌آید، از راهِ `publishPeers`.
      inbound.setConnectionState({ status: "connected", peers: this.peerCount });
    }
    // ★★ **هنوز چیزی تایید نشده** (گام ۴٫۳). سرور بلافاصله بعد از join یک
    //    `HB_ROOM_INFO` می‌فرستد و همان این را به `saved` می‌بَرد. تا آن لحظه —
    //    و برای همیشه اگر سروری در کار نباشد — ادعای «ذخیره شد» دروغ است.
    inbound.setSaveState({ status: "unsaved", pendingChanges: 0 });

    return this.buildOutbound();
  }

  /**
   * ★ **باید همه‌چیز را باز کند.** observerِ جامانده یعنی بعد از unmount هنوز
   * روی `inbound`ِ مرده صدا زده می‌شود — و زیر StrictMode این حالتِ عادی است، نه
   * استثنا. تستش هست: بعد از `disconnect`، تغییرِ remote به بومِ قبلی نمی‌رسد.
   */
  disconnect(): void {
    this.epoch++;
    // ★ **اول flush، بعد قطع** — وگرنه آخرین تیکِ درگ یا آخرین حرفی که کاربر
    //   تایپ کرده در صف می‌مانَد و هرگز روی سند نمی‌نشیند.
    this.scheduler?.dispose();
    this.scheduler = null;
    // ★ **بعد از** flush — وگرنه آخرین ژست جایی برای نشستن در تاریخچه ندارد.
    this.undoScope?.destroy();
    this.undoScope = null;
    this.lastGestureId = undefined;
    // ★★ **قبل از قطعِ ترابری** — آخرین کارِ کانالِ حضور فرستادنِ «رفتم» است و
    //    اگر ترابری از قبل بسته شده باشد، همتاها یک مکان‌نمای یخ‌زده می‌بینند تا
    //    وقتی awareness بعد از ۳۰ ثانیه خودش پاکش کند.
    this.presence?.destroy();
    // ★ **بعد از** `destroy` خوانده می‌شود — خودِ «رفتم» هم شمارنده را یکی جلو
    //   می‌برد و اتصالِ بعدی باید از همان‌جا ادامه دهد.
    this.presenceClock = this.presence?.clock() ?? this.presenceClock;
    this.presence = null;
    this.peerCount = 0;
    for (const off of this.teardown) off();
    this.teardown = [];
    this.pendingRemote.clear();
    this.transport?.disconnect?.();
    this.inbound?.setConnectionState({
      status: "offline",
      pendingChanges: this.offlineTouched.size,
    });
    this.inbound = null;
    this.linkUp = true;
    this.lastConnection = null;
    this.offlineTouched.clear();
  }

  // ── سیم‌کشی ──────────────────────────────────────────────────

  private wireTransport(): void {
    const transport = this.transport;
    if (!transport) return;

    // ★ **گیرنده قبل از کانالِ وضعیت.** رویدادِ `open` بلافاصله دست‌دادن را
    //   راه می‌اندازد و پاسخِ سرور در همان رفت‌وبرگشت برمی‌گردد؛ اگر شنونده‌ی
    //   پیام هنوز سوار نبود، step2ِ سرور بی‌صدا گم می‌شد.
    this.teardown.push(transport.onMessage((data) => this.handleMessage(data)));
    if (transport.onStatus) {
      this.teardown.push(transport.onStatus((status) => this.handleStatus(status)));
    }

    const onUpdate = (update: Uint8Array, origin: unknown): void => {
      // ★ آنچه از همتا رسیده دوباره فرستاده نمی‌شود. بدونِ این، دو کلاینت تا
      //   ابد یک update را به هم پاس می‌دهند — همان حلقه‌ای که هیچ خطایی نمی‌دهد.
      if (origin === REMOTE_ORIGIN) return;
      const encoder = encoding.createEncoder();
      syncProtocol.writeUpdate(encoder, update);
      this.sendSync(encoding.toUint8Array(encoder));
    };
    this.doc.on("update", onUpdate);
    this.teardown.push(() => this.doc.off("update", onUpdate));
  }

  /**
   * ★★ نگاشتِ وضعیتِ ترابری به `ConnectionState`ِ قرارداد — **گام ۵٫۱**.
   *
   * تنها جایی است که این ترجمه انجام می‌شود. نوارِ وضعیتِ M1 از قبل هر پنج
   * حالت را رندر می‌کند، پس هر دروغِ خوش‌بینانه‌ای اینجا **روی صفحه** دیده
   * می‌شود — که دقیقاً چیزی است که از این نگاشت می‌خواهیم.
   */
  private handleStatus(status: TransportStatus): void {
    const inbound = this.inbound;
    if (!inbound) return;

    // ★★ سیم که قطع شد، **هیچ ادعایی درباره‌ی ذخیره‌شدن نمی‌شود کرد** (گام ۵٫۲).
    //    تنها منبعِ «ذخیره شد» پیامِ سرور است؛ وقتی سرور نیست، بدبینی تنها
    //    حالتِ صادق است.
    if (status.phase !== "open" && this.linkUp) {
      this.linkUp = false;
      this.reportUnsaved();
    }
    this.linkUp = status.phase === "open";

    switch (status.phase) {
      case "connecting":
        this.lastConnection = "connecting";
        // ⚠️ فقط تلاشِ **اول** «در حالِ اتصال» است. تلاش‌های بعدی وسطِ یک
        //    سریِ اتصالِ مجددند و پرش به `connecting` فقط شماره‌ی تلاش و
        //    زمان‌سنجِ روی صفحه را پاک می‌کند.
        if (status.attempt === 1) inbound.setConnectionState({ status: "connecting" });
        else this.lastConnection = "reconnecting";
        return;

      case "open":
        // ★★ **دست‌دادن روی هر بار باز شدن، نه فقط اولی.** سرور هیچ حافظه‌ای
        //    از نشستِ قبلی ندارد: نه بردارِ وضعیتِ ما را دارد و نه حضورمان را.
        this.resumeSession();
        this.offlineTouched.clear();
        this.lastConnection = "connected";
        inbound.setConnectionState({ status: "connected", peers: this.peerCount });
        // ★ «در حالِ ذخیره»، نه «ذخیره شد»: دست‌دادن همین الان رفت ولی تاییدِ
        //   سرور (`HB_ROOM_INFO`) هنوز نرسیده.
        inbound.setSaveState({ status: "saving" });
        return;

      case "retrying":
        this.lastConnection = "reconnecting";
        inbound.setConnectionState({
          status: "reconnecting",
          attempt: status.attempt,
          nextRetryMs: status.nextRetryMs,
        });
        return;

      case "stopped":
        this.lastConnection = status.reason === "offline" ? "offline" : "error";
        inbound.setConnectionState(
          status.reason === "offline"
            ? { status: "offline", pendingChanges: this.offlineTouched.size }
            : { status: "error", code: status.code, message: status.message },
        );
        return;
    }
  }

  /**
   * ★★ از سر گرفتنِ نشست بعد از باز شدنِ سوکت.
   *
   * دو کارِ لازم، و هیچ‌کدام اختیاری نیست:
   *
   * ۱. **دست‌دادنِ sync** — سرورِ تازه (یا همان سرور با نشستِ تازه) بردارِ
   *    وضعیتِ ما را نمی‌داند. بدونِ step1/step2 هرچه آفلاین ساخته‌ایم پیشِ
   *    خودمان می‌مانَد و هرچه آن‌ها ساخته‌اند به ما نمی‌رسد — **بی‌صدا**، چون
   *    updateِ افزایشیِ بی‌پیشینه در `pendingStructs` بایگانی می‌شود و خطا نمی‌دهد.
   * ۲. ★ **معرفیِ دوباره‌ی حضور با شمارنده‌ی جلورفته.** سرور با قطعِ سوکت
   *    حذفِ ما را پخش کرده و همتاها آن را با همان clock ثبت کرده‌اند؛ پیامی با
   *    clockِ **مساوی** بی‌صدا دور ریخته می‌شود. یعنی بدونِ این، برگشتنِ ما برای
   *    همه **نامرئی** است — همان تله‌ی گام ۳٫۵، این‌بار از سمتِ شبکه.
   */
  private resumeSession(): void {
    this.requestInitialSync();
    this.presence?.reannounce();
  }

  /**
   * ★★ **همگام‌سازیِ اولیه — بدونِ این، sync بی‌صدا کار نمی‌کند.**
   *
   * این را با probe سنجیدم، بعد از اینکه هفت تست افتادند: اگر فقط updateهای
   * افزایشی رد و بدل شوند، Yjs آن‌ها را در `pendingStructs` **بایگانی می‌کند و
   * اعمال نمی‌کند**، چون opهای قبلیِ همان کلاینت را ندیده — و هیچ خطایی هم
   * نمی‌دهد. اینجا `createBoardDoc` همان اولین op را می‌نویسد
   * (`meta.schemaVersion`)، پس شکافِ علّی از همان اول وجود دارد.
   *
   * راهِ درست همان چیزی است که `y-protocols/sync` برایش ساخته شده:
   *
   * - **step 1** = «بردارِ وضعیتِ من این است، چه چیزی کم دارم؟»
   * - **step 2** = «این هم هرچه من دارم.»
   *
   * هر دو با هم فرستاده می‌شوند تا در **یک رفت‌وبرگشت** همگرا شوند: همتا با
   * step 2ِ خودش به step 1 جواب می‌دهد، و step 2ِ ما را هم اعمال می‌کند.
   * پاسخ به step 2 چیزی نیست، پس زنجیره همان‌جا تمام می‌شود.
   */
  private requestInitialSync(): void {
    if (!this.transport) return;

    const request = encoding.createEncoder();
    syncProtocol.writeSyncStep1(request, this.doc);
    this.sendSync(encoding.toUint8Array(request));

    const offer = encoding.createEncoder();
    syncProtocol.writeSyncStep2(offer, this.doc);
    this.sendSync(encoding.toUint8Array(offer));
  }

  private sendSync(payload: Uint8Array): void {
    this.transport?.send(encodeMessage({ type: MSG_TYPES.SYNC, payload }));
  }

  private handleMessage(data: Uint8Array): void {
    const message = decodeMessage(data);
    // `null` یعنی نوعِ ناشناخته — بی‌صدا نادیده گرفته می‌شود (گام ۲٫۴).
    if (!message) return;

    switch (message.type) {
      case MSG_TYPES.SYNC:
        this.handleSync(message.payload);
        return;
      case MSG_TYPES.AWARENESS:
        this.presence?.receiveAwareness(message.payload);
        return;
      case MSG_TYPES.HB_EPHEMERAL:
        this.presence?.receiveEphemeral(message.clientId, message.payload);
        return;
      case MSG_TYPES.HB_ROOM_INFO:
        // ★★ **تنها منبعِ «ذخیره شد»** (گام ۴٫۳): سرور این را بعد از نوشتنِ
        //    واقعیِ دیتابیس می‌فرستد. اگر خودمان می‌گفتیم، به کاربر دروغ می‌گفتیم.
        this.inbound?.setSaveState(
          message.save === "saved"
            ? { status: "saved", at: Date.now() }
            : { status: message.save === "saving" ? "saving" : "unsaved", pendingChanges: 0 },
        );
        this.inbound?.setConnectionState({ status: "connected", peers: this.peerCount });
        return;
      default:
        // بقیه‌ی کدها (مجوز، اطلاعاتِ اتاق، خطا) کارِ سرورِ فاز ۴ اند.
        return;
    }
  }

  private handleSync(payload: Uint8Array): void {
    const reply = encoding.createEncoder();
    syncProtocol.readSyncMessage(
      decoding.createDecoder(payload),
      reply,
      this.doc,
      REMOTE_ORIGIN,
      (error) => {
        // ⚠️ y-protocols خودش `applyUpdate` را در try/catch گذاشته و خطا را فقط
        //    `console.error` می‌کند. این hook تنها راهی است که یک خرابیِ واقعیِ
        //    اعمال بی‌صدا نماند.
        throw error;
      },
    );
    if (encoding.length(reply) > 0) this.sendSync(encoding.toUint8Array(reply));

    // ★★ **تحویل به بوم بیرونِ تراکنش** — دلیلش پایین، `flushRemote`.
    this.flushRemote();
  }

  private wireDocument(): void {
    const elements = boardRoots(this.doc).elements;
    const observer = (events: DeepEvent[], transaction: Y.Transaction): void => {
      // ★ هرچه از همتا نیامده، **کارِ ماست** — چه از بوم (`LocalOrigin`) و چه از
      //   undo. اگر سیم قطع باشد، هنوز به سرور نرسیده و باید شمرده شود.
      if (transaction.origin !== REMOTE_ORIGIN && !this.linkUp) this.collectOffline(events);
      // تغییرِ خودمان است — بوم از قبل نشانش می‌دهد و برگرداندنش یعنی حلقه.
      if (transaction.origin instanceof LocalOrigin) return;
      this.collectRemote(events);
    };
    elements.observeDeep(observer);
    this.teardown.push(() => elements.unobserveDeep(observer));
  }

  /**
   * کانالِ حضور — [`awareness.ts`](./awareness.ts).
   *
   * ★★ **ترتیبِ سه خطِ آخر با یک باگِ واقعی نوشته شد، نه با سلیقه.**
   *
   * ترابریِ لوکال همزمان است: معرفیِ ما می‌رود، همتا همان‌جا در **همان پشته‌ی
   * فراخوانی** جواب می‌دهد، و جوابش به `handleMessage` می‌رسد. اگر معرفی داخلِ
   * `createPresenceScope` انجام می‌شد، آن جواب وقتی می‌رسید که `this.presence`
   * هنوز `null` بود — و بی‌صدا دور ریخته می‌شد. نشانه‌اش نامتقارن و گیج‌کننده بود:
   * **الف همتا را می‌دید، ب هیچ‌کس را.**
   *
   * ⚠️ با یک WebSocketِ واقعی این جواب async می‌آمد و باگ **پشتِ شبکه پنهان
   * می‌مانْد** — همان دلیلی که فاز ۳ عمداً قبل از فاز ۴ ساخته می‌شود.
   */
  private wirePresence(): void {
    const presence = createPresenceScope({
      doc: this.doc,
      user: this.user,
      throttle: this.throttle,
      clock: this.presenceClock,
      sink: {
        sendAwareness: (payload) =>
          this.transport?.send(encodeMessage({ type: MSG_TYPES.AWARENESS, payload })),
        sendEphemeral: (payload) =>
          this.transport?.send(
            encodeMessage({
              type: MSG_TYPES.HB_EPHEMERAL,
              clientId: this.doc.clientID,
              payload,
            }),
          ),
        onPeersChanged: (peers) => this.publishPeers(peers),
      },
    });

    this.presence = presence;
    presence.announce();
  }

  /**
   * تحویلِ فهرستِ همتاها به بوم.
   *
   * ★ `setConnectionState` فقط وقتی صدا زده می‌شود که **عدد** عوض شده باشد.
   * `applyPeers` روی هر تکانِ مکان‌نما (هر ۴۰ms) می‌آید و آن قرارداداً یک
   * به‌روزرسانیِ پرتکرار است؛ ولی وضعیتِ اتصال معمولاً به یک نشانگرِ ثابتِ رابط
   * وصل است و رندرِ ۲۵بار-در-ثانیه‌اش هزینه‌ی بی‌دلیل است.
   */
  private publishPeers(peers: PeerState[]): void {
    const inbound = this.inbound;
    if (!inbound) return;

    inbound.applyPeers(peers);
    if (peers.length !== this.peerCount) {
      this.peerCount = peers.length;
      // ⚠️ وقتی سیم قطع است این را **نگو**: آخرین کارِ کانالِ حضور هنگام قطع
      //    پاک‌کردنِ همتاهاست، و آن تغییرِ عدد وضعیتِ `reconnecting` را با یک
      //    `connected`ِ دروغین بازمی‌نوشت.
      if (this.linkUp) inbound.setConnectionState({ status: "connected", peers: peers.length });
    }
  }

  /**
   * جمع‌کردنِ شناسه‌ی عناصرِ دست‌خورده — **فقط جمع می‌کند، تحویل نمی‌دهد.**
   *
   * ⚠️ رویدادها **عمیق**اند: تغییرِ `x` روی یک عنصر رویدادی با
   * `path = [elementId]` می‌دهد، و ساخت/حذفِ خودِ عنصر رویدادی با `path = []` و
   * `keysChanged`. هر دو باید به شناسه‌ی همان عنصر برسند، وگرنه تغییرِ همتا
   * می‌رسد ولی بوم چیزی نشان نمی‌دهد.
   */
  /**
   * ★ شناسه‌ی عناصری که آفلاین دست‌خورده‌اند — همان استخراجِ `collectRemote`،
   * مقصدِ متفاوت.
   *
   * و اگر عدد عوض شد و کاربر در حالتِ `offline` است، **دوباره گزارش می‌شود**:
   * آن حالت تنها جایی است که این عدد به کاربر نشان داده می‌شود
   * (`connection.offline` در [`fa.ts`](../../i18n/src/strings/fa.ts))، و عددِ
   * یخ‌زده بدتر از نبودنش است.
   */
  private collectOffline(events: DeepEvent[]): void {
    const before = this.offlineTouched.size;
    for (const event of events) {
      if (event.path.length > 0) {
        this.offlineTouched.add(String(event.path[0]));
      } else if (event instanceof Y.YMapEvent) {
        for (const key of event.keysChanged) this.offlineTouched.add(key);
      }
    }
    if (this.offlineTouched.size === before) return;
    this.reportUnsaved();
  }

  /**
   * ★★ «هنوز ذخیره نشده» — و تا وقتی سیم قطع است، **هیچ‌وقت** چیزِ دیگری.
   *
   * ⚠️ این بدبینی عمدی است و قراردادِ M1 صریحاً می‌خواهدش: تنها منبعِ «ذخیره شد»
   * پیامِ `HB_ROOM_INFO`ِ سرور است (گام ۴٫۳)، و وقتی سرور در دسترس نیست هیچ
   * ادعایی درباره‌ی دیسک نمی‌شود کرد. اگر «ذخیره شد» نشان بدهیم و کاربر تب را
   * ببندد، کارش رفته است.
   */
  private reportUnsaved(): void {
    const pendingChanges = this.offlineTouched.size;
    this.inbound?.setSaveState({ status: "unsaved", pendingChanges });
    if (this.lastConnection === "offline") {
      this.inbound?.setConnectionState({ status: "offline", pendingChanges });
    }
  }

  private collectRemote(events: DeepEvent[]): void {
    for (const event of events) {
      if (event.path.length > 0) {
        this.pendingRemote.add(String(event.path[0]));
      } else if (event instanceof Y.YMapEvent) {
        // ریشه‌ی `elements` خودش عوض شده: عنصر ساخته یا کلیدش کامل رفته.
        for (const key of event.keysChanged) this.pendingRemote.add(key);
      }
    }
  }

  /**
   * ★★ تحویلِ تغییرِ remote به بوم — **بیرونِ تراکنشِ Yjs**.
   *
   * ── چرا نه مستقیم داخلِ observer ──────────────────────────────────────
   *
   * دو دلیلِ سنجیده‌شده، نه سلیقه:
   *
   * ۱. **y-protocols خطاهای داخلِ observer را می‌بلعد.** `readSyncStep2` خودِ
   *    `Y.applyUpdate` را در `try/catch` گذاشته و هر خطایی را فقط
   *    `console.error` می‌کند («This catches errors that are thrown by event
   *    handlers» — کامنتِ خودشان). یعنی اگر `applyRemoteChanges` داخلِ observer
   *    صدا زده می‌شد، **`EchoLoopError` هرگز به هیچ‌کس نمی‌رسید** و کلِ نگهبانِ
   *    M1 به یک خطِ لاگ تنزل پیدا می‌کرد.
   * ۲. **بازگشتی‌بودن.** بوم ممکن است در پاسخ چیزی بنویسد؛ نوشتن داخلِ
   *    cleanupِ تراکنشِ Yjs یعنی تراکنشِ تودرتو.
   */
  private flushRemote(): void {
    const inbound = this.inbound;
    if (!inbound || this.pendingRemote.size === 0) return;

    const touched = [...this.pendingRemote];
    // ★ قبل از صدا زدنِ بوم پاک می‌شود: اگر بوم خطا بدهد، همان شناسه‌ها دوباره
    //   تحویل نمی‌شوند و حلقه‌ی خطا نمی‌سازند.
    this.pendingRemote.clear();

    const elements = boardRoots(this.doc).elements;
    const upserted: HbElement[] = [];
    const deleted: string[] = [];

    for (const id of touched) {
      const map = elements.get(id);
      if (!(map instanceof Y.Map)) {
        // کلید کامل رفته — undoِ یک **ساخت** این کار را می‌کند (سنجیده در ۱٫۴).
        deleted.push(id);
        continue;
      }
      const element = readElement(map);
      // حذفِ نرم: عنصر می‌مانَد ولی بوم باید مثلِ حذف رفتارش کند.
      if (element.isDeleted) deleted.push(id);
      else upserted.push(element);
    }

    const assets = this.assetsOf(upserted);
    inbound.applyRemoteChanges({
      upserted,
      deleted,
      origin: "remote",
      ...(assets.length > 0 ? { assets } : {}),
    });
  }

  // ── outbound ─────────────────────────────────────────────────

  private buildOutbound(): CanvasOutbound {
    return {
      emitElementChanges: (changes) => this.emitElementChanges(changes),

      // ── حضور — گام ۳٫۵ ───────────────────────────────────────
      // اعدادِ throttle داخلِ `PresenceScope` اعمال می‌شوند، از همان
      // `HB_THROTTLE`ی که مسیرِ عنصر هم از آن می‌خوانَد.
      emitPointer: (pointer) => this.presence?.setPointer(pointer),
      emitSelection: (ids) => this.presence?.setSelection(ids),
      emitViewport: (viewport) => this.presence?.setViewport(viewport),
      emitActiveTool: (tool) => this.presence?.setActiveTool(tool),
      emitEphemeral: (payload) => this.presence?.setEphemeral(payload),

      // ── دارایی — گام ۳٫۶ ─────────────────────────────────────
      requestAssetUpload: (file) => this.uploadAsset(file),
      resolveAssetUrl: (fileId) => this.assets?.resolve(fileId) ?? Promise.resolve(""),

      emitReady: () => {},
    };
  }

  private emitElementChanges(changes: ElementChangeSet): void {
    // ★★ اولین خط، غیرقابلِ حذف — [ADR-024](../../../ARCHITECTURE_DECISIONS.md#adr-024):
    //    از `canvas-core` قرض گرفته می‌شود، از نو نوشته نمی‌شود.
    assertEmittable(changes);

    const inbound = this.inbound;
    if (!inbound) return;

    // ★ «در حالِ ذخیره» از همین لحظه درست است: تغییر پذیرفته شده ولی هنوز
    //   ننشسته. جدولِ throttle (گام ۳٫۳) تصمیم می‌گیرد کِی واقعاً بنویسد.
    inbound.setSaveState({ status: "saving" });
    this.scheduler?.push(changes);
  }

  /**
   * نوشتنِ واقعی — **یک تراکنش برای کلِ changeset**.
   *
   * ★ originِ نام‌دار و حاملِ `gestureId`. codecِ `ydoc-schema` عمداً خودش
   * `transact` نمی‌کند و این وظیفه اینجاست — بدونش Yjs هر `set` را جدا با originِ
   * `null` می‌فرستد: هم ترافیکِ چندبرابر، هم همان originی که `UndoManager`
   * پیش‌فرض ردیابی می‌کند (گام ۱٫۴).
   */
  private commitChanges(changes: ElementChangeSet): void {
    // ★★ مرزِ ورودیِ undo. بدونِ این، `Y.UndoManager` هرچه در پنجره‌ی
    //    `captureTimeout` بیفتد را **در یک ورودی** ادغام می‌کند: در گام ۳٫۴
    //    سنجیده شد که ساختِ استیکی و سه ویرایشِ بعدی‌اش همگی یک `Ctrl+Z` شدند و
    //    کلِ بورد پاک شد.
    //
    // ★ ادغام **فقط درونِ یک ژستِ شناسه‌دار** مجاز است — یک درگ باید یک undo
    //   باشد. تغییرِ **بی‌ژست** (ساخت، حذف، تغییرِ استایل) یک کنشِ گسسته است و
    //   هر کدام ورودیِ خودش را می‌گیرد.
    if (changes.gestureId === undefined || changes.gestureId !== this.lastGestureId) {
      this.undoScope?.stopCapturing();
    }
    this.lastGestureId = changes.gestureId;

    const roots = boardRoots(this.doc);
    this.doc.transact(() => {
      for (const element of changes.upserted) writeElement(roots.elements, element);
      for (const id of changes.deleted) this.softDelete(id);
      for (const asset of changes.assets ?? []) writeAsset(roots.assets, asset satisfies HbAsset);
    }, new LocalOrigin(changes.gestureId));

    // ★★ **«ذخیره شد» را دیگر خودمان نمی‌گوییم** (گام ۴٫۳).
    //
    // تا فاز ۳ اینجا `saved` گفته می‌شد، که خوش‌بینی بود نه حقیقت: سند فقط در
    // حافظه بود. حالا سرور بعد از نوشتنِ **واقعیِ** دیتابیس `HB_ROOM_INFO` با
    // `save: "saved"` می‌فرستد و مسیرِ آن پیام این را ست می‌کند.
    //
    // ⚠️ **بدونِ ترابری** هیچ سروری نیست که تایید کند، پس وضعیت `unsaved`
    // می‌مانَد — و این درست است، نه یک نقص: یک بومِ آفلاین واقعاً ذخیره نشده.
    if (!this.transport) {
      this.inbound?.setSaveState({ status: "unsaved", pendingChanges: 0 });
    }
  }

  /**
   * آپلود، و بعد **نوشتنِ متادیتا در سند** — گام ۳٫۶.
   *
   * ★★ **چرا متادیتا را همین‌جا می‌نویسیم و منتظرِ `changes.assets` نمی‌مانیم:**
   * ترتیب. عنصرِ تصویر فقط یک **ارجاع** (`fileId`) است؛ اگر زودتر از متادیتا به
   * همتا برسد، او یک ارجاعِ آویزان دارد و هیچ راهی برای نمایشش. با نوشتن در
   * همین‌جا، متادیتا **قبل از** عنصر روی سیم می‌رود — چون `image-tool` اول
   * `requestAssetUpload` را await می‌کند و بعد عنصر را می‌سازد.
   *
   * مسیرِ `changes.assets` هم زنده می‌مانَد (paste، جریان‌های M3)؛ هر دو به یک
   * `writeAsset` می‌رسند و آن idempotent است.
   *
   * ⚠️ `assets` بیرونِ دامنه‌ی `UndoManager` است (که فقط `elements` را می‌بیند)،
   * پس `Ctrl+Z` متادیتا را برنمی‌گرداند. درست هم همین است: عنصر که برگردد،
   * متادیتای بی‌مصرف می‌مانَد و پاک‌سازی‌اش کارِ GCِ M3 است — ولی اگر undo آن را
   * می‌برد، redo یک عنصرِ بدونِ دارایی می‌ساخت.
   */
  private async uploadAsset(file: File): Promise<HbAsset> {
    const transport = this.assets;
    if (!transport) {
      // ★ مثلِ گام ۳٫۱ اینجا **خطا می‌دهد**، نه یک Promiseِ ساختگی: بوم منتظرِ
      //   `fileId` می‌مانَد و placeholder هرگز جایگزین نمی‌شود.
      throw new Error(
        "‏[hamboom] پورتِ دارایی تنظیم نشده — گزینه‌ی `assets` را به YjsSyncAdapter بده " +
          "(در توسعه: createLocalAssetTransport).",
      );
    }

    const token = this.epoch;
    const asset = await transport.upload(file);
    // ★ همان قاعده‌ی `connect`: بعد از **هر** await باید بررسی شود که هنوز همان
    //   اتصالیم. وگرنه متادیتا روی سندی می‌نشیند که ترابری‌اش رفته و هرگز به
    //   همتا نمی‌رسد — یک واگراییِ بی‌صدا.
    if (this.epoch !== token) throw new ConnectionCancelledError();

    this.doc.transact(() => {
      writeAsset(boardRoots(this.doc).assets, asset);
    }, new LocalOrigin());

    return asset;
  }

  /**
   * متادیتای داراییِ عناصری که به بوم تحویل می‌شوند.
   *
   * ⚠️ بدونِ این، همتا عنصرِ تصویر را می‌گیرد ولی هیچ‌وقت نمی‌فهمد بایت‌ها کجایند —
   * قراردادِ M1 هیچ متدی برای «این فایل را ثبت کن» ندارد و تنها راهش همین
   * فیلدِ `assets`ِ خودِ `ElementChangeSet` است.
   */
  private assetsOf(elements: HbElement[]): HbAsset[] {
    const assets = boardRoots(this.doc).assets;
    const result: HbAsset[] = [];
    const seen = new Set<string>();

    for (const element of elements) {
      const fileId = (element as { fileId?: unknown }).fileId;
      if (typeof fileId !== "string" || seen.has(fileId)) continue;
      seen.add(fileId);
      const map = assets.get(fileId);
      if (map instanceof Y.Map) result.push(map.toJSON() as HbAsset);
    }
    return result;
  }

  /**
   * حذفِ **نرم** — کلید نمی‌رود، فقط `isDeleted` روشن می‌شود.
   *
   * عنصر باید بمانَد تا undo و CRDT چیزی برای برگرداندن داشته باشند. یک `set`ِ
   * تک‌فیلدی است، پس از `writeElement` (که عنصرِ کامل می‌خواهد) نمی‌گذرد.
   */
  /** `originalText`ِ فعلیِ سند — ورودیِ تشخیصِ «فقط متن عوض شده». */
  private currentText(id: string): string | undefined {
    const map = boardRoots(this.doc).elements.get(id);
    if (!(map instanceof Y.Map)) return undefined;
    const value = map.get("originalText");
    return value instanceof Y.Text ? value.toString() : undefined;
  }

  private softDelete(id: string): void {
    const map = boardRoots(this.doc).elements.get(id);
    if (map instanceof Y.Map && map.get("isDeleted") !== true) map.set("isDeleted", true);
  }
}
