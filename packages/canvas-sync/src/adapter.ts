import {
  assertEmittable,
  type CanvasDocument,
  type CanvasInbound,
  type CanvasOutbound,
  type CanvasPermissions,
  type CanvasSyncAdapter,
  type ElementChangeSet,
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

import {
  createEmitScheduler,
  LocalOrigin,
  type EmitScheduler,
  type EmitSchedulerOptions,
} from "./emit-local.ts";
import type { SyncTransport } from "./transport.ts";
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
 * | `captureUpdate: "NEVER"` هنگام نوشتنِ remote روی صحنه + گیتِ ESLint | ۳٫۲ |
 * | `Y.UndoManager` با `trackedOrigins` | ۳٫۴ |
 * | awareness → `PeerState[]` (مکان‌نما، انتخاب، نما، ابزار، ephemeral) | ۳٫۵ |
 * | آپلود و URLِ دارایی | ۳٫۶ |
 */

/** originِ updateهایی که از ترابری رسیده‌اند. */
export const REMOTE_ORIGIN = "hamboom:remote";

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
  /** بازنویسیِ اعدادِ جدولِ throttle — **فقط برای تست**. */
  throttle?: EmitSchedulerOptions;
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
  private readonly throttle: EmitSchedulerOptions;

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

  constructor(options: YjsSyncAdapterOptions = {}) {
    this.doc = options.doc ?? createBoardDoc();
    this.transport = options.transport ?? null;
    this.permissions = options.permissions ?? FULL_PERMISSIONS;
    this.throttle = options.throttle ?? {};
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
    inbound.setConnectionState({ status: "connecting" });

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

    inbound.setPermissions(this.permissions);
    // ⚠️ `peers` تا گام ۳٫۵ (awareness) همیشه صفر است — عددِ واقعی از آنجا می‌آید.
    inbound.setConnectionState({ status: "connected", peers: 0 });
    inbound.setSaveState({ status: "saved", at: Date.now() });

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
    for (const off of this.teardown) off();
    this.teardown = [];
    this.pendingRemote.clear();
    this.transport?.disconnect?.();
    this.inbound?.setConnectionState({ status: "offline", pendingChanges: 0 });
    this.inbound = null;
  }

  // ── سیم‌کشی ──────────────────────────────────────────────────

  private wireTransport(): void {
    const transport = this.transport;
    if (!transport) return;

    this.teardown.push(transport.onMessage((data) => this.handleMessage(data)));

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
    if (!message || message.type !== MSG_TYPES.SYNC) return;

    const reply = encoding.createEncoder();
    syncProtocol.readSyncMessage(
      decoding.createDecoder(message.payload),
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
      // تغییرِ خودمان است — بوم از قبل نشانش می‌دهد و برگرداندنش یعنی حلقه.
      if (transaction.origin instanceof LocalOrigin) return;
      this.collectRemote(events);
    };
    elements.observeDeep(observer);
    this.teardown.push(() => elements.unobserveDeep(observer));
  }

  /**
   * جمع‌کردنِ شناسه‌ی عناصرِ دست‌خورده — **فقط جمع می‌کند، تحویل نمی‌دهد.**
   *
   * ⚠️ رویدادها **عمیق**اند: تغییرِ `x` روی یک عنصر رویدادی با
   * `path = [elementId]` می‌دهد، و ساخت/حذفِ خودِ عنصر رویدادی با `path = []` و
   * `keysChanged`. هر دو باید به شناسه‌ی همان عنصر برسند، وگرنه تغییرِ همتا
   * می‌رسد ولی بوم چیزی نشان نمی‌دهد.
   */
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

    inbound.applyRemoteChanges({ upserted, deleted, origin: "remote" });
  }

  // ── outbound ─────────────────────────────────────────────────

  private buildOutbound(): CanvasOutbound {
    return {
      emitElementChanges: (changes) => this.emitElementChanges(changes),

      // ── awareness — گام ۳٫۵ ──────────────────────────────────
      // عمداً no-op و **نه throw**: throw کردن بوم را غیرقابل‌استفاده می‌کند و
      // این‌ها در هر حرکتِ ماوس صدا زده می‌شوند. تستِ «هنوز پیاده نشده» در
      // `adapter.test.ts` این وضعیت را پین کرده تا با گام ۳٫۵ قرمز شود.
      emitPointer: () => {},
      emitSelection: () => {},
      emitViewport: () => {},
      emitActiveTool: () => {},
      emitEphemeral: () => {},

      // ── دارایی — گام ۳٫۶ ─────────────────────────────────────
      requestAssetUpload: () => {
        // اینجا برخلافِ بالا throw می‌کند: مسیرِ آپلود **نتیجه** برمی‌گرداند و
        // یک Promiseِ ساختگی یعنی بوم برای همیشه منتظرِ `fileId` می‌مانَد.
        return Promise.reject(
          new Error("‏[hamboom] آپلودِ دارایی هنوز پیاده نشده — گام ۳٫۶ (AssetTransport)."),
        );
      },
      resolveAssetUrl: () => Promise.resolve(""),

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

    // ⚠️ **این «ذخیره شد» فقط تا وقتی راست است که سند در حافظه باشد.** قرارداد M1
    //    می‌گوید `SaveState` باید حقیقت را بگوید نه خوش‌بینی؛ گام ۴٫۳ باید
    //    `saved` را پشتِ نوشتنِ **واقعیِ** دیتابیس ببرد.
    this.inbound?.setSaveState({ status: "saved", at: Date.now() });
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
