import { hbElement } from "@hamboom/shared-types";
import {
  boardRoots,
  decodeMessage,
  encodeMessage,
  HB_ERROR_CODES,
  migrateDocument,
  MSG_TYPES,
  readElement,
  SCHEMA_VERSION,
  type BoardRole,
  type MigrationResult,
} from "@hamboom/ydoc-schema";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

import { createRoomPresence, type RoomPresence } from "./awareness.ts";
import { createLogger, maskSubject, type Logger } from "./log.ts";
import { mayBroadcastPresence, mayWriteDocument } from "./permission.ts";
import type { Compactor } from "./persistence/compactor.ts";
import type { UpdateLog } from "./persistence/update-log.ts";
import { RtProtocolError } from "./protocol-error.ts";
import { BUS_KINDS, type BoardBus, type BusEnvelope, type BusKind } from "./pubsub/board-bus.ts";
import { OWNER_LEASE_SECONDS, type OwnerLock } from "./pubsub/owner-lock.ts";
import type { BoardStore } from "./store/board-store.ts";
import type { RtSession } from "./server.ts";

/**
 * چرخه‌ی عمرِ اتاق — گام ۴٫۲.
 *
 * بارگذاری (snapshot + updateهای بعدش) → `Y.Doc` در حافظه → تخلیه بعد از
 * بی‌کاری. یک اتاق به ازای هر بورد، مشترک بینِ همه‌ی نشست‌های همان بورد.
 *
 * ── ★★ مرزِ اعتماد اینجاست، و فقط اینجا ───────────────────────────────
 *
 * پینِ گام ۲٫۱: `readElement` عمداً اعتبارسنجی **نمی‌کند**، چون مسیرِ داغِ هر
 * تغییرِ remote است (ده‌ها بار در ثانیه). پس یک جا باید بررسی شود، و آن جا
 * **همین‌جاست**: جایی که سند از دیتابیس می‌آید و هنوز به هیچ کلاینتی نرسیده.
 *
 * ★ رفتارِ انتخاب‌شده: عنصرِ نامعتبر **قرنطینه** می‌شود — از سندِ درون‌حافظه‌ای
 * برداشته، **شمرده** و **لاگ** می‌شود. سه گزینه بود و دو تایش بد بودند:
 *
 * | گزینه | چرا نه |
 * |---|---|
 * | نگه‌داشتن و سرو کردن | مرزِ اعتماد را بی‌معنا می‌کند: هر کلاینت باید خودش دفاع کند، در حالی که `readElement`ِ کلاینت هم اعتبارسنجی نمی‌کند |
 * | ردِ کلِ بورد | یک عنصرِ خراب کلِ بورد را از دسترس خارج می‌کند — صریحاً همان چیزی که TODO منع کرده |
 *
 * ⚠️ **هزینه‌ی پذیرفته‌شده:** قرنطینه یعنی حذف، و حذف یعنی از دست رفتنِ آن عنصر.
 * ولی «بی‌صدا رد شود» چیزی است که پین صریحاً منعش کرده — پس حذف **با شمارش و
 * لاگ** انجام می‌شود. برای گام ۴٫۴ ثبت شد: snapshot از سندِ قرنطینه‌شده، پاک‌سازی
 * را **دائمی** می‌کند؛ آن‌جا باید تصمیم گرفته شود که آیا این مطلوب است یا باید
 * قبلش نسخه‌ی خام آرشیو شود.
 */

/**
 * originِ حذفِ قرنطینه.
 *
 * ★★ **این origin عمداً پایدار نمی‌شود** (تصمیمِ گام ۴٫۳). قرنطینه یک **نمای
 * زمانِ بارگذاری** است، نه یک ویرایشِ کاربر: لاگِ update حقیقتِ خام را نگه
 * می‌دارد و هر بار که اتاق بالا می‌آید دوباره پالایش انجام می‌شود (ارزان و
 * idempotent).
 *
 * ⚠️ این همان نگرانیِ «حذف یعنی از دست رفتن» در گام ۴٫۲ را **حل می‌کند**: داده
 * از لاگ پاک نمی‌شود، فقط سرو نمی‌شود. اگر روزی معلوم شد اعتبارسنجی بیش‌ازحد
 * سخت‌گیر بوده، اصلِ داده هنوز هست.
 * ★ قیدِ گام ۴٫۴: snapshot **نباید** از سندِ قرنطینه‌شده گرفته شود، وگرنه همین
 * تضمین می‌شکند.
 */
export const QUARANTINE_ORIGIN = "hamboom:quarantine";

/**
 * originِ updateی که از **نودِ دیگر** آمده — گام ۴٫۷.
 *
 * ★ دو چیز را همزمان می‌گوید: «دوباره منتشرش نکن» (ضدِ حلقه) و «اگر صاحبی،
 * پایدارش کن». اگر مثلِ بارگذاری بی‌نشان می‌ماند، updateهای نودهای دیگر هرگز
 * نوشته نمی‌شدند.
 */
const REMOTE_UPDATE_ORIGIN = "hamboom:bus";

/** payloadِ خالی — برای پیام‌هایی که فقط یک عدد حمل می‌کنند (`SAVED`). */
const EMPTY = new Uint8Array(0);

/** originِ تراکنشی که از یک نشستِ کلاینت آمده — تنها چیزی که پایدار می‌شود. */
class ClientOrigin {
  readonly session: RtSession;

  constructor(session: RtSession) {
    this.session = session;
  }
}

export interface RoomLimits {
  /** `RT_MAX_ROOMS_PER_NODE`. */
  maxRoomsPerNode: number;
  /** `RT_MAX_DOC_BYTES`. */
  maxDocBytes: number;
  /** `RT_ROOM_IDLE_TIMEOUT_MS`. */
  idleTimeoutMs: number;
}

export interface RoomManagerOptions {
  store: BoardStore;
  /**
   * لاگِ پایداری. **بدونش اتاق فقط در حافظه است** و هیچ ادعای «ذخیره شد» نمی‌کند
   * — همان حالتی که تا گام ۴٫۲ داشتیم.
   */
  log?: UpdateLog;
  /**
   * فشرده‌سازی — گام ۴٫۴. بدونش لاگ برای همیشه رشد می‌کند (رفتارِ تا ۴٫۳).
   *
   * ★ اتاق فقط **ماشه** را می‌کشد و `boardId` می‌دهد؛ سندِ خودش را نمی‌دهد و
   * نمی‌تواند بدهد. دلیلش در [`compactor.ts`](./persistence/compactor.ts) است:
   * سندِ اتاق **قرنطینه‌شده** است و snapshot گرفتن از آن، پاک‌سازی را دائمی
   * می‌کند — همان تصمیمِ معلقِ گام ۴٫۲.
   */
  compactor?: Compactor;
  /**
   * گذرگاهِ بینِ نودها — گام ۴٫۷. بدونش سرور تک‌نودی است (فاز ۱ در ADR-006) و
   * همه‌چیز مثلِ قبل کار می‌کند.
   */
  bus?: BoardBus;
  /**
   * قفلِ صاحب. ⚠️ **بدونِ `bus` معنا ندارد** و بدونِ **آن** هم چندنودی امن نیست:
   * اگر گذرگاه باشد و قفل نباشد، دو نود همزمان روی `board_updates` می‌نویسند.
   */
  ownerLock?: OwnerLock;
  /** شناسه‌ی این نود — برچسبِ ضدِ حلقه. */
  nodeId?: string;
  limits: RoomLimits;
  logger?: Logger;
}

/** گزارشِ بارگذاری — برای لاگ و برای تست، نه برای کلاینت. */
export interface RoomLoadReport {
  migration: MigrationResult;
  /** شناسه‌ی عناصری که از مرزِ اعتماد رد نشدند. */
  quarantined: string[];
  bytes: number;
  /**
   * ★★ آیا updateهای بارگذاری‌شده **شکافِ علّی** داشتند؟
   *
   * ⚠️ اگر لاگِ update با snapshot پشتِ سرِ هم نباشد، Yjs آن‌ها را در
   * `pendingStructs` بایگانی می‌کند و **هیچ خطایی نمی‌دهد** — بورد ناقص بالا
   * می‌آید و هیچ‌کس نمی‌فهمد. همان تله‌ی گام ۳٫۱، این‌بار سمتِ پایداری. مرزِ
   * اعتماد همان‌قدر که به **شکلِ** عنصر اهمیت می‌دهد باید به این هم بدهد.
   */
  pendingStructs: boolean;
}

export interface Room {
  readonly boardId: string;
  readonly doc: Y.Doc;
  readonly report: RoomLoadReport;
  /** تعدادِ نشست‌های زنده. */
  readonly size: number;
}

export interface RoomManager {
  join(session: RtSession): Promise<Room>;
  /**
   * ★★ تغییرِ نقش **وسطِ session** — گام ۴٫۵.
   *
   * ADR-012 نقش را یک مقدارِ **محاسبه‌شده** می‌داند که هر لحظه می‌تواند عوض شود
   * (تنزل در تیم، برداشته‌شدن از `board_members`، ابطالِ لینک). این متد همان
   * لحظه را به نشست‌های زنده می‌رسانَد: نقش عوض می‌شود، `HB_PERMISSION` می‌رود، و
   * **updateِ بعدی با نقشِ تازه سنجیده می‌شود**.
   *
   * ⚠️ عمداً **push** است نه polling: هیچ پنجره‌ی «تا انقضای کش» وجود ندارد که
   * در آن یک کاربرِ تنزل‌داده‌شده هنوز بنویسد. صداکننده‌اش امروز تست است و در
   * گام ۴٫۷ کانالِ Redis (و در M3، خودِ API).
   *
   * @returns تعدادِ نشست‌هایی که واقعاً عوض شدند.
   */
  applyRoleChange(boardId: string, sub: string, role: BoardRole): number;
  /** اتاق‌های **در حافظه** — تستِ تخلیه همین را می‌خواند. */
  readonly size: number;
  has(boardId: string): boolean;
  close(): Promise<void>;
}

interface LiveRoom extends Room {
  sessions: Set<RtSession>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** آخرین `seq`ِ پایدارشده — در `HB_ROOM_INFO` به کلاینت می‌رود. */
  seq: number;
  /** `seq`ی که آخرین snapshot تا آن را دارد — مبدأِ شمارشِ آستانه‌ی فشرده‌سازی. */
  compactedSeq: number;
  /** زمانِ آخرین فشرده‌سازی — مبدأِ `RT_SNAPSHOT_EVERY_MS`. */
  compactedAt: number;
  /** ★ یک فشرده‌سازی در هر لحظه؛ دو تای همزمان روی یک بورد به هم می‌رسند. */
  compacting: boolean;
  /** دفترِ حضور — گام ۴٫۶. هیچ‌چیزش پایدار نمی‌شود (ADR-022). */
  presence: RoomPresence;
  /** ★ آیا این نود صاحبِ بورد است؟ **فقط صاحب در دیتابیس می‌نویسد.** */
  owner: boolean;
  /** برداشتنِ اشتراکِ گذرگاه هنگام تخلیه. */
  unsubscribe: (() => void) | null;
  /** تمدید (یا تلاش برای گرفتنِ) اجاره‌ی صاحبی. */
  ownerTimer: ReturnType<typeof setInterval> | null;
}

export function createRoomManager({
  store,
  log,
  compactor,
  bus,
  ownerLock,
  nodeId = "node-1",
  limits,
  logger = createLogger(),
}: RoomManagerOptions): RoomManager {
  const rooms = new Map<string, LiveRoom>();
  /** بارگذاری‌های در جریان — دو نشستِ همزمان نباید دو بار سند را بسازند. */
  const loading = new Map<string, Promise<LiveRoom>>();
  /** نوشتن‌های در جریان — خاموشیِ مودبانه منتظرشان می‌مانَد (گام ۴٫۸). */
  const inFlight = new Set<Promise<void>>();

  function evict(room: LiveRoom): void {
    if (room.sessions.size > 0) return;
    rooms.delete(room.boardId);
    releaseRoom(room);
    room.doc.destroy();
    logger.info("اتاق از حافظه رفت", { boardId: room.boardId });
  }

  /**
   * رهاکردنِ منابعِ خوشه‌ای.
   *
   * ★ **قفل داوطلبانه پس داده می‌شود** و منتظرِ انقضای اجاره نمی‌مانیم: نودِ بعدی
   * فوراً صاحب می‌شود، نه بعد از ۳۰ ثانیه‌ای که در آن هیچ‌کس نمی‌نویسد.
   */
  function releaseRoom(room: LiveRoom): void {
    if (room.ownerTimer) clearInterval(room.ownerTimer);
    room.ownerTimer = null;
    room.unsubscribe?.();
    room.unsubscribe = null;
    if (room.owner) void ownerLock?.release(room.boardId).catch(() => undefined);
    room.owner = false;
  }

  function scheduleEviction(room: LiveRoom): void {
    if (room.idleTimer) clearTimeout(room.idleTimer);
    // ⚠️ `unref` تا یک اتاقِ بی‌کار جلوی خاموش‌شدنِ فرایند را نگیرد.
    room.idleTimer = setTimeout(() => evict(room), limits.idleTimeoutMs);
    room.idleTimer.unref?.();
  }

  /**
   * ★★ پیامی که از نودِ دیگر رسید.
   *
   * ⚠️ **اولین خط، ضدِ حلقه است** (ADR-006): پیامِ خودمان را دوباره پردازش
   * نمی‌کنیم. بدونش هر update بی‌پایان بینِ دو نود رفت‌وبرگشت می‌کند — و چون
   * Yjs idempotent است، هیچ‌وقت هم *خراب* نمی‌شود؛ فقط شبکه و CPU را می‌خورد،
   * که بدترین نوعِ باگ است: کار می‌کند و آرام‌آرام سرور را می‌کشد.
   */
  function handleBus(room: LiveRoom, envelope: BusEnvelope): void {
    if (envelope.node === nodeId) return;

    switch (envelope.kind) {
      case BUS_KINDS.UPDATE:
        // ★ با originِ **گذرگاه**: `wireDocument` از رویش می‌فهمد که نباید دوباره
        //   منتشرش کند، ولی اگر صاحب باشیم **باید** پایدارش کند.
        Y.applyUpdate(room.doc, envelope.payload, REMOTE_UPDATE_ORIGIN);
        return;

      case BUS_KINDS.AWARENESS:
        room.presence.receiveRemote(envelope.payload);
        return;

      case BUS_KINDS.EPHEMERAL:
        // ⚠️ بایتِ خام، بدونِ باز کردن — همان قراردادِ محلی.
        for (const session of room.sessions) send(session, envelope.payload);
        return;

      case BUS_KINDS.SAVED:
        // ⚠️ `max`: پیام‌های گذرگاه ترتیب ندارند و «ذخیره شد» نباید عقب برود.
        if (envelope.seq <= room.seq) return;
        room.seq = envelope.seq;
        broadcast(room, encodeMessage({ type: MSG_TYPES.HB_ROOM_INFO, ...info(room, "saved") }));
        return;

      case BUS_KINDS.STATE_REQUEST:
        // ★★ نودی تازه این اتاق را باز کرده — حالتِ کاملمان را بده (F-2،
        //    [ADR-041](../../../ARCHITECTURE_DECISIONS.md#adr-041)).
        //
        // ⚠️ **حالتِ کامل، نه دیف.** پرسنده بردارِ وضعیتش را نفرستاده و ما هم
        //    نمی‌دانیم چه چیزی کم دارد؛ Yjs opهای تکراری را دور می‌ریزد، پس
        //    بدترین هزینه‌اش پهنای باند است — در برابرِ گم‌شدنِ کارِ کاربر.
        //
        // ★ و **جواب دوباره جواب نمی‌گیرد**: پاسخ از نوعِ `UPDATE` است و
        //   `UPDATE` هیچ‌وقت پرسش تولید نمی‌کند. حلقه ساختاراً ممکن نیست.
        publishToBus(room, BUS_KINDS.UPDATE, Y.encodeStateAsUpdate(room.doc), 0);
        return;

      default:
        return;
    }
  }

  /**
   * ★★ گرفتن یا از دست دادنِ صاحبی — و کاری که هنگام **گرفتن** باید کرد.
   *
   * ⚠️ نودی که تازه صاحب می‌شود ممکن است updateهایی در حافظه داشته باشد که
   * **هیچ‌وقت پایدار نشده‌اند**: صاحبِ قبلی مرده و بینِ مرگش تا انقضای اجاره،
   * updateها فقط روی گذرگاه پخش شده‌اند. پس اولین کارِ صاحبِ تازه نوشتنِ
   * **حالتِ کاملِ** سند است. Yjs idempotent است، پس بدترین هزینه‌اش یک ردیفِ
   * تکراری است — در برابرِ از دست رفتنِ کارِ کاربر.
   */
  async function refreshOwnership(room: LiveRoom, initial = false): Promise<void> {
    if (!ownerLock) return;
    const was = room.owner;
    try {
      room.owner = was
        ? await ownerLock.renew(room.boardId)
        : await ownerLock.acquire(room.boardId);
    } catch (cause) {
      // ⚠️ Redisِ در دسترس نبودن **نباید** به یک صاحبِ خیالی تبدیل شود: اگر
      //    نمی‌دانیم صاحبیم یا نه، نمی‌نویسیم (fail closed).
      logger.error("بررسیِ قفلِ صاحب شکست خورد", {
        boardId: room.boardId,
        error: String(cause),
      });
      room.owner = false;
      return;
    }

    if (room.owner === was) return;
    logger.info(room.owner ? "صاحبِ بورد شدیم" : "صاحبیِ بورد از دست رفت", {
      boardId: room.boardId,
      nodeId,
    });

    // ⚠️ **نه در اولین گرفتن.** آنجا اتاق همین الان از دیتابیس خوانده شده، پس
    //    چیزی برای جبران نیست — و نوشتنِ حالتِ کامل در **هر باز شدنِ اتاق** یعنی
    //    یک ردیفِ بزرگِ بی‌فایده به‌ازای هر اتاق، که کارِ فشرده‌سازی را خنثی می‌کند.
    //    (اولین نسخه همین را می‌کرد و تست‌های خوشه با ردیف‌های اضافه قرمز شدند.)
    if (room.owner && log && !initial) {
      // ★ نوشتنِ جبرانی — بالا.
      void persistAndFanout(room, Y.encodeStateAsUpdate(room.doc), null).catch(() => undefined);
    }
  }

  async function open(boardId: string): Promise<LiveRoom> {
    // ★ سقفِ نود **قبل از** بارگذاری بررسی می‌شود: بعدش یعنی سند را از دیتابیس
    //   کشیده‌ایم و بعد دور انداخته‌ایم.
    if (rooms.size >= limits.maxRoomsPerNode) {
      throw new RtProtocolError(
        HB_ERROR_CODES.SERVER_BUSY,
        "سرور شلوغ است؛ چند لحظه بعد دوباره تلاش کنید.",
        `سقفِ اتاقِ نود پر است (${limits.maxRoomsPerNode})`,
      );
    }

    /**
     * ★★ **اشتراک قبل از خواندن از دیتابیس** — و بافر کردنِ آنچه در این فاصله
     * می‌رسد.
     *
     * ⚠️ ترتیبِ برعکس یک شکافِ **دائمی** می‌سازد: updateای که بینِ `store.load` و
     * `subscribe` منتشر شود، نه در آن خواندن هست و نه به این نود می‌رسد. Redis
     * pub/sub تحویل را تضمین نمی‌کند و پیامِ از دست رفته **هرگز** برنمی‌گردد؛
     * پس آن بورد روی این نود تا ابد ناقص می‌مانْد.
     *
     * ★ و بافر لازم است چون خودِ `handleBus` به اتاقی نیاز دارد که هنوز ساخته
     * نشده.
     */
    const buffered: BusEnvelope[] = [];
    let deliver = (envelope: BusEnvelope): void => {
      buffered.push(envelope);
    };
    const unsubscribe = bus
      ? await bus.subscribe(boardId, (envelope) => {
          deliver(envelope);
        })
      : null;

    const { snapshot, updates, seqUpto } = await store.load(boardId);

    /**
     * ★★★ **سرور هیچ opی نمی‌نویسد — نه اینجا، نه در migration.**
     *
     * گام ۴٫۴ نصفِ این را فهمید (فقط بوردِ نو `createBoardDoc` بگیرد)؛ گام ۴٫۶
     * نصفِ دیگرش را با یک flakeِ واقعی نشان داد. زنجیره‌اش این بود:
     *
     * ۱. سرور برای بوردِ نو `meta.schemaVersion` را با `clientID`ِ **خودش**
     *    می‌نوشت. آن op هرگز پایدار نمی‌شد (originش `ClientOrigin` نیست).
     * ۲. کلاینت هم `meta.schemaVersion`ِ خودش را داشت. دو نوشتن روی **یک کلید**
     *    یعنی یکی برنده و دیگری **حذف** می‌شود.
     * ۳. اگر opِ سرور برنده می‌شد، کلاینت opِ خودش را حذف‌شده علامت می‌زد — و
     *    آن **delete** در updateِ بعدیِ کلاینت **پایدار می‌شد**.
     * ۴. نتیجه: لاگ opِ meta را دارد ولی حذف‌شده. `getSchemaVersion` می‌شد
     *    `undefined`، پس هر بارگذاریِ بعدی دوباره **مهر** می‌زد — یعنی باز هم یک
     *    opِ سرور، و بازگشت به همان چرخه.
     *
     * ⚠️ **بی‌صدا بود:** عناصر همه سالم بودند و sync کار می‌کرد؛ فقط نسخه‌ی
     * schemaِ بورد بی‌سر و صدا گم می‌شد. سنجه‌ی فشرده‌سازی گرفتش، چون state
     * vectorِ کلاینتِ تازه یک مدخلِ اضافه داشت که در دیتابیس نبود.
     *
     * ★ رفع، هم‌راستا با مرزی که گام ۴٫۲ کشید (**فقط کلاینت‌ها می‌نویسند**):
     * سند همیشه خالی ساخته می‌شود و migration روی سندِ **تهی** اجرا نمی‌شود —
     * چیزی برای مهاجرت ندارد و تنها اثرش همان مهرِ مسئله‌ساز بود. اولین کلاینت
     * `meta` را با خودش می‌آورد و **آن** پایدار می‌شود.
     */
    const doc = new Y.Doc();

    // ⚠️ در **یک** تراکنش: هر update جداگانه یک رویداد است و بارگذاریِ یک بوردِ
    //    بزرگ را به هزاران رویدادِ بی‌فایده تبدیل می‌کند.
    doc.transact(() => {
      if (snapshot) Y.applyUpdate(doc, snapshot);
      for (const update of updates) Y.applyUpdate(doc, update);
    });

    // ★★ شکافِ علّی را **قبل از** هر چیز دیگری ببین: اگر updateها اعمال نشده
    //    باشند، سند ناقص است و هر ادعای بعدی (migration، اعتبارسنجی، حجم) روی
    //    یک بوردِ نصفه انجام می‌شود.
    const pendingStructs = hasPendingStructs(doc);
    if (pendingStructs) {
      logger.error("شکافِ علّی در لاگِ update — بورد ناقص بارگذاری شد", {
        boardId,
        updates: updates.length,
        fromSnapshot: snapshot !== null,
      });
    }

    // ★ migration **در سرور**، نه کلاینت (PLAN ۷٫۵) — تا همه یک نسخه ببینند.
    //   ⚠️ ولی **نه روی سندِ تهی**: آنجا چیزی برای مهاجرت نیست و تنها کارش
    //      نوشتنِ یک مهر با `clientID`ِ سرور است — دقیقاً همان چیزی که بالا
    //      توضیح داده شد.
    const migration = isDocumentEmpty(doc)
      ? { from: SCHEMA_VERSION, to: SCHEMA_VERSION, applied: [], changed: false }
      : migrateDocument(doc);
    const quarantined = quarantineInvalid(doc, boardId, logger);

    const bytes = Y.encodeStateAsUpdate(doc).byteLength;
    if (bytes > limits.maxDocBytes) {
      doc.destroy();
      unsubscribe?.();
      throw new RtProtocolError(
        HB_ERROR_CODES.DOC_TOO_LARGE,
        "این بورد از حدِ مجاز بزرگ‌تر است.",
        `${bytes} > ${limits.maxDocBytes}`,
      );
    }

    const seq = log ? await log.latestSeq(boardId) : 0;
    const room: LiveRoom = {
      boardId,
      doc,
      report: { migration, quarantined, bytes, pendingStructs },
      sessions: new Set(),
      idleTimer: null,
      seq,
      // ★ مبدأ از **کاتالوگ** می‌آید، نه از `seq`ِ جاری و نه از صفر: بوردی که با
      //   ۴۹۹ updateِ فشرده‌نشده بالا می‌آید باید با یکی دو updateِ بعدی به آستانه
      //   برسد، نه اینکه ۵۰۰ تای **دیگر** صبر کند.
      compactedSeq: seqUpto,
      // ⚠️ زمانِ **بارگذاری** است نه زمانِ واقعیِ snapshot (که در `created_at`
      //    کاتالوگ است). یعنی آستانه‌ی `everyMs` از لحظه‌ی بالا آمدنِ اتاق شمرده
      //    می‌شود؛ محافظه‌کارانه است — دیرتر فشرده می‌کند، نه زودتر.
      compactedAt: Date.now(),
      compacting: false,
      // ★ بعد از ساختِ اتاق پر می‌شود: خودِ `presence` برای پخش به اتاق نیاز دارد.
      presence: null as unknown as RoomPresence,
      // ⚠️ **پیش‌فرض `false` است، نه `true`:** تا وقتی قفل را نگرفته‌ایم نمی‌نویسیم.
      //    بدونِ قفل (تک‌نودی) `true` می‌شود، پایین.
      owner: ownerLock === undefined,
      unsubscribe,
      ownerTimer: null,
      get size() {
        return this.sessions.size;
      },
    };

    room.presence = createRoomPresence({
      doc,
      // ⚠️ `except` عمداً به خودِ نشست گره خورده، نه به `clientID`: یک نشست
      //    می‌تواند بیش از یک `clientID` داشته باشد (StrictMode، تبِ دوباره‌بازشده)
      //    و فرستنده نباید صدای خودش را پس بگیرد.
      broadcast: (payload, except) => {
        for (const target of room.sessions) {
          if (target !== except) send(target, payload);
        }
      },
      publish: (payload) => {
        publishToBus(room, BUS_KINDS.AWARENESS, payload, 0);
      },
      logger,
    });

    wireDocument(room);

    // ★ از حالا پیام‌های گذرگاه مستقیم پردازش می‌شوند؛ آنچه در فاصله رسیده بود
    //   همین‌جا تخلیه می‌شود (به همان ترتیبِ رسیدن).
    deliver = (envelope) => {
      handleBus(room, envelope);
    };
    for (const envelope of buffered) handleBus(room, envelope);

    /**
     * ★★ **و از بقیه‌ی نودها بپرس حالتِ تازه‌تری دارند یا نه** — یافته‌ی F-2،
     * [ADR-041](../../../ARCHITECTURE_DECISIONS.md#adr-041).
     *
     * ⚠️ خواندن از دیتابیس فقط چیزی را می‌آورد که **پایدار شده**. اگر بینِ مرگِ
     * صاحبِ قبلی و انقضای اجاره، کلاینتی روی نودِ دیگری نوشته باشد، آن update
     * **هیچ‌جا پایدار نشده** و تنها نسخه‌اش حافظه‌ی همان نود است. بدونِ این
     * پرسش، این اتاق برای همیشه ناقص بالا می‌آمد — بی‌خطا، و شبیهِ درست.
     *
     * ★ جایش عمداً **بعد از** تخلیه‌ی بافر است: تا اینجا `handleBus` زنده است،
     * پس جوابی که برمی‌گردد جایی برای نشستن دارد.
     */
    publishToBus(room, BUS_KINDS.STATE_REQUEST, EMPTY, 0);

    await refreshOwnership(room, true);
    if (ownerLock) {
      // ⚠️ فاصله عمداً **یک‌سومِ** اجاره است: با تمدیدِ دقیقاً سرِ ۳۰ ثانیه، اولین
      //    کندیِ شبکه یعنی اجاره منقضی شده و بورد بی‌صاحب مانده.
      room.ownerTimer = setInterval(
        () => void refreshOwnership(room),
        (OWNER_LEASE_SECONDS * 1000) / 3,
      );
      room.ownerTimer.unref?.();
    }

    logger.info("اتاق بارگذاری شد", {
      boardId,
      bytes,
      updates: updates.length,
      fromSnapshot: snapshot !== null,
      migrated: migration.changed ? `${migration.from}→${migration.to}` : null,
      quarantined: quarantined.length,
      owner: room.owner,
    });

    return room;
  }

  /**
   * ★★ **دوام قبل از ack** — قلبِ گام ۴٫۳.
   *
   * هر تراکنشی که originش یک نشستِ کلاینت باشد، **قبل از** اینکه به کسی گفته
   * شود «ذخیره شد» روی دیتابیس می‌نشیند. ترتیب عمدی است و با تست قفل شده:
   *
   * ۱. `await log.append(...)` — وقتی برگشت، دوام دارد.
   * ۲. پخش به بقیه‌ی نشست‌ها.
   * ۳. `HB_ROOM_INFO{ save: "saved", seq }` به همه.
   *
   * ⚠️ پخش هم **بعد** از نوشتن است. هزینه‌اش یک رفت‌وبرگشتِ دیتابیس در مسیرِ
   * پخش است (اندازه‌گیری‌اش در PROGRESS)، و سودش این است که هیچ‌وقت همتایی
   * چیزی نمی‌بیند که سرور آن را از دست بدهد.
   */
  function wireDocument(room: LiveRoom): void {
    room.doc.on("update", (update: Uint8Array, origin: unknown) => {
      const from = origin instanceof ClientOrigin ? origin.session : null;
      const fromBus = origin === REMOTE_UPDATE_ORIGIN;

      // ⚠️ هر originِ دیگری (بارگذاری، قرنطینه، migration) **این نود را ترک
      //    نمی‌کند**: نه پخش می‌شود، نه پایدار، نه منتشر. مرزِ گام ۴٫۲.
      if (!from && !fromBus) return;

      // ★★ **updateِ محلی به نودهای دیگر می‌رود، رسیده از گذرگاه نه.**
      //    سدِ اولِ ضدِ حلقه؛ برچسبِ `nodeId` سدِ دوم است (ADR-006).
      if (from) publishToBus(room, BUS_KINDS.UPDATE, update, 0);

      // ★★ **نوشتنِ در جریان شمرده می‌شود** — گام ۴٫۸.
      //
      // ⚠️ بدونِ این، `SIGTERM` می‌توانست وسطِ یک `append` برسد و فرایند قبل از
      //    نشستنِ آن روی دیسک تمام شود. کلاینت هنوز «ذخیره شد» ندیده، پس
      //    ADR-009 فنی نقض نمی‌شد — ولی کارِ کاربر **بی‌صدا** می‌رفت، و معیارِ
      //    پذیرشِ این گام صریح است: «هیچ updateای گم نمی‌شود».
      const task = persistAndFanout(room, update, from);
      inFlight.add(task);
      void task.finally(() => inFlight.delete(task));
    });
  }

  async function persistAndFanout(
    room: LiveRoom,
    update: Uint8Array,
    from: RtSession | null,
  ): Promise<void> {
    // ★★ **فقط صاحب می‌نویسد** (ADR-006 فاز ۲). نودِ غیرِ صاحب پخشِ محلی را
    //    انجام می‌دهد ولی حق ندارد بگوید «ذخیره شد» — حقیقتش را صاحب با
    //    `BUS_KINDS.SAVED` می‌فرستد.
    if (!room.owner) {
      fanoutLocal(room, update, from);
      if (from) {
        broadcast(room, encodeMessage({ type: MSG_TYPES.HB_ROOM_INFO, ...info(room, "saving") }));
      }
      return;
    }

    try {
      if (log) {
        const appended = await log.append(room.boardId, update, from?.sub ?? null);
        // ⚠️ `max` و نه انتساب: ترتیبِ رسیدنِ ackها با ترتیبِ `seq` یکی نیست و
        //    عددِ «ذخیره شد» هرگز نباید عقب برود.
        room.seq = Math.max(room.seq, appended.seq);
      }
    } catch (cause) {
      // ⚠️ نوشتن نشد → **نمی‌گوییم ذخیره شد**. کلاینت `unsaved` می‌بیند و
      //    می‌داند کارش هنوز در خطر است — این کلِ نکته‌ی ADR-009 است.
      logger.error("نوشتنِ update شکست خورد", { boardId: room.boardId, error: String(cause) });
      broadcast(room, encodeMessage({ type: MSG_TYPES.HB_ROOM_INFO, ...info(room, "unsaved") }));
      return;
    }

    fanoutLocal(room, update, from);
    broadcast(room, encodeMessage({ type: MSG_TYPES.HB_ROOM_INFO, ...info(room, "saved") }));

    // ★ و به نودهای دیگر بگو **تا کجا** پایدار شده — تنها راهی که کلاینتِ نشسته
    //   روی نودِ غیرِ صاحب می‌تواند «ذخیره شد»ِ صادق ببیند (ADR-009).
    publishToBus(room, BUS_KINDS.SAVED, EMPTY, room.seq);

    // ★ **بعد** از ack — فشرده‌سازی یک بهینه‌سازیِ پس‌زمینه است و هیچ‌وقت نباید
    //   بینِ کاربر و «ذخیره شد» بایستد.
    maybeCompact(room);
  }

  /** پخشِ یک updateِ سند به نشست‌های **همین نود**. */
  function fanoutLocal(room: LiveRoom, update: Uint8Array, from: RtSession | null): void {
    const encoder = encoding.createEncoder();
    syncProtocol.writeUpdate(encoder, update);
    const payload = encodeMessage({
      type: MSG_TYPES.SYNC,
      payload: encoding.toUint8Array(encoder),
    });
    for (const session of room.sessions) {
      if (session !== from) send(session, payload);
    }
  }

  function publishToBus(room: LiveRoom, kind: BusKind, payload: Uint8Array, seq: number): void {
    bus?.publish(room.boardId, { node: nodeId, kind, payload, seq });
  }

  /**
   * ماشه‌ی فشرده‌سازی.
   *
   * ⚠️ **شکستش اتاق را نمی‌شکند.** بدترین حالتِ یک فشرده‌سازیِ ناموفق این است که
   * لاگ بزرگ‌تر می‌مانَد؛ ولی اگر خطایش بالا برود، مسیرِ پخش را می‌اندازد — یعنی
   * یک بهینه‌سازی به یک قطعیِ همگام‌سازی تبدیل می‌شود.
   *
   * ★ و **در بازه‌ی `everyMs` هم فقط روی update نگاه می‌شود**، نه با تایمر. یعنی
   * بوردی که کاملاً ساکت شده فشرده نمی‌شود — که اشکالی ندارد: چیزی برای فشردن
   * ندارد و اتاقش هم به‌زودی تخلیه می‌شود. تایمرِ اضافه فقط یک مسیرِ خطای دیگر
   * می‌ساخت.
   */
  function maybeCompact(room: LiveRoom): void {
    // ⚠️ **فقط صاحب فشرده می‌کند.** فشرده‌سازی می‌نویسد **و حذف می‌کند**؛ دو نود
    //    که همزمان این کار را بکنند، دقیقاً همان چیزی است که ترتیبِ امنِ گام ۴٫۴
    //    فرض کرده هرگز رخ نمی‌دهد.
    if (!compactor || room.compacting || !room.owner) return;
    if (
      !compactor.shouldCompact({
        seq: room.seq,
        sinceSeq: room.compactedSeq,
        sinceAt: room.compactedAt,
      })
    ) {
      return;
    }

    // ★ هدف را **همین‌جا** قفل کن: بعد از این `await` باز هم update می‌آید و
    //   `room.seq` جلو می‌رود؛ snapshot نباید ادعا کند شامل چیزی است که ندیده.
    const target = room.seq;
    room.compacting = true;
    void compactor
      .compact(room.boardId, target)
      .then((result) => {
        if (!result) return;
        room.compactedSeq = result.seqUpto;
        room.compactedAt = Date.now();
      })
      .catch((cause: unknown) => {
        logger.error("فشرده‌سازی شکست خورد؛ لاگ دست‌نخورده مانْد", {
          boardId: room.boardId,
          target,
          error: String(cause),
        });
      })
      .finally(() => {
        room.compacting = false;
      });
  }

  /**
   * ★★ **مرزِ مجوز — گام ۴٫۵، [ADR-012](../../../ARCHITECTURE_DECISIONS.md#adr-012).**
   *
   * ADR-012 صریح است: «سرور realtime باید نقش را **در هر update** بررسی کند، نه
   * فقط هنگام اتصال». پس بررسی اینجاست، در مسیرِ هر پیام — نه در `join`.
   *
   * ⚠️ **و باید قبل از `readSyncMessage` باشد.** بعدش دیر است: Yjs عقب‌گرد ندارد،
   * پس هر updateی که اعمال شود در سند مانده — حتی اگر بلافاصله خطا بدهیم، پخش
   * نکنیم و پایدار نکنیم. «اعمال کن، بعد پشیمان شو» در CRDT وجود ندارد.
   *
   * ── ★ چرا `step1` استثناست ────────────────────────────────────────
   *
   * پیامِ syncِ Yjs سه زیرنوع دارد و فقط دوتاشان **نوشتن** اند:
   *
   * | زیرنوع | چه می‌کند | `viewer` |
   * |---|---|---|
   * | `step1` | «چه چیزی کم دارم؟» — فقط بردارِ وضعیت می‌فرستد | ✔ مجاز |
   * | `step2` · `update` | opهای فرستنده را روی سند **می‌نشاند** | ✘ رد |
   *
   * اگر `step1` را هم می‌بستیم، `viewer` اصلاً بورد را **نمی‌دید** — یعنی نقشِ
   * تماشاگر بی‌معنا می‌شد.
   */
  function handleMessage(room: LiveRoom, session: RtSession, data: Uint8Array): void {
    const message = decodeMessage(data);
    if (!message) return;

    // ── حضور و داده‌ی موقت — گام ۴٫۶ ────────────────────────────────
    //
    // ★★ **هیچ‌کدام از این دو مسیر به `log` نمی‌رسند** و این تنها تضمینِ
    //    «ephemeral هرگز پایدار نمی‌شود» است (ADR-022): پایداری به
    //    `doc.on("update")` گره خورده، و اینجا اصلاً به سند دست نمی‌زنیم.
    if (message.type === MSG_TYPES.AWARENESS) {
      // ⚠️ حضور برای **همه‌ی** نقش‌ها باز است، حتی `viewer` — تماشاگری که دیده
      //    نمی‌شود از نظرِ بقیه در اتاق نیست (تصمیمِ گام ۴٫۵).
      if (mayBroadcastPresence(session.role)) room.presence.receive(session, message.payload);
      return;
    }

    if (message.type === MSG_TYPES.HB_EPHEMERAL) {
      if (!mayBroadcastPresence(session.role)) return;
      // ★ جعلِ `clientId` را رد کن: بدونِ این، یک همتا می‌تواند استروک یا لیزر را
      //   به نامِ **کاربرِ دیگری** بکشد. مالکیت از دفترِ حضور می‌آید و تا وقتی
      //   نشست حضورش را اعلام نکرده، سخت‌گیری نمی‌کنیم (fail-open، عمدی).
      if (!room.presence.ownsClient(session, message.clientId)) {
        logger.debug("ephemeral با clientIdِ غیرِ خودی دور ریخته شد", {
          sub: maskSubject(session.sub),
          clientId: message.clientId,
        });
        return;
      }
      // ⚠️ **بایت‌های خام بازپخش می‌شوند.** `payload` برای سرور مات است — نه
      //    parse، نه اعتبارسنجی، نه ذخیره (قراردادِ `protocol.ts`).
      for (const target of room.sessions) {
        if (target !== session) send(target, data);
      }
      // ★ و به نودهای دیگر هم می‌رود، وگرنه استروکِ زنده فقط برای کسانی دیده
      //   می‌شود که تصادفاً روی همان نود نشسته‌اند.
      publishToBus(room, BUS_KINDS.EPHEMERAL, data, 0);
      return;
    }

    if (message.type !== MSG_TYPES.SYNC) return;

    // ⚠️ decoderِ **جدا** برای سرک کشیدن: `readVarUint` نشانگر را جلو می‌برد و
    //    اگر همین decoder را به `readSyncMessage` بدهیم، زیرنوع را دوباره
    //    نمی‌خوانَد و پیام را غلط تفسیر می‌کند.
    const peek = decoding.createDecoder(message.payload);
    const kind = decoding.readVarUint(peek);
    const isWrite =
      kind === syncProtocol.messageYjsSyncStep2 || kind === syncProtocol.messageYjsUpdate;

    if (isWrite && !mayWriteDocument(session.role)) {
      // ★★ **updateِ تهی نوشتن نیست** — و این یک ریزه‌کاریِ آرایشی نیست.
      //
      // ⚠️ سنجه‌ی زنده نشان داد هر کلاینتِ `viewer` **هنگام اتصال** یک `FORBIDDEN`
      // می‌گیرد: پروتکلِ sync ایجاب می‌کند که به step1ِ سرور با step2 جواب بدهد،
      // و آن step2 برای تماشاگرِ تازه **صفر op** دارد. رد کردنش فنی درست بود ولی
      // در عمل یک هشدارِ امنیتیِ کاذب به‌ازای هر اتصالِ سالم می‌ساخت — و هشداری که
      // همیشه می‌آید، همان هشداری است که کسی نمی‌خوانَد.
      //
      // ★ هزینه‌ی این بررسی فقط روی مسیرِ **ردشده** است: کسی که حقِ نوشتن دارد
      //   هرگز از اینجا رد نمی‌شود.
      if (isEmptyUpdate(peek)) return;
      denyWrite(room, session);
      return;
    }

    const reply = encoding.createEncoder();
    // ★ origin نشستِ فرستنده است: هم پخش را از خودش جدا می‌کند، هم مشخص می‌کند
    //   که این تغییر **باید پایدار شود** (برخلافِ بارگذاری و قرنطینه).
    syncProtocol.readSyncMessage(
      decoding.createDecoder(message.payload),
      reply,
      room.doc,
      new ClientOrigin(session),
      () => {},
    );
    if (encoding.length(reply) > 0) {
      send(session, encodeMessage({ type: MSG_TYPES.SYNC, payload: encoding.toUint8Array(reply) }));
    }
  }

  /**
   * ردِ یک نوشتنِ بی‌مجوز.
   *
   * ⚠️ **اتصال بسته نمی‌شود، و این عمدی است** ([ADR-038](../../../ARCHITECTURE_DECISIONS.md#adr-038)):
   * تنزلِ نقش وسطِ کار یک حالتِ **عادی** است، نه حمله. کاربری که همین الان
   * `viewer` شده باید بورد را ببیند؛ پرت کردنش بیرون هم بی‌فایده است و هم
   * بی‌اثر — با همان توکن دوباره وصل می‌شود.
   *
   * ★ و `HB_PERMISSION` **همراهش** می‌رود، نه فقط خطا: کلاینت باید بفهمد
   * **چرا** رد شد و UIاش را به فقط-خواندنی ببرد (کارِ گام ۵٫۳)، وگرنه کاربر
   * می‌نویسد و هر بار بی‌صدا شکست می‌خورد.
   */
  function denyWrite(room: LiveRoom, session: RtSession): void {
    logger.warn("نوشتنِ بی‌مجوز رد شد", {
      boardId: room.boardId,
      sub: maskSubject(session.sub),
      role: session.role,
    });
    send(session, encodeMessage({ type: MSG_TYPES.HB_PERMISSION, role: session.role }));
    send(
      session,
      encodeMessage({
        type: MSG_TYPES.HB_ERROR,
        code: HB_ERROR_CODES.FORBIDDEN,
        message: "با نقشِ فعلی اجازه‌ی ویرایشِ این بورد را ندارید.",
      }),
    );
  }

  return {
    get size() {
      return rooms.size;
    },

    has: (boardId) => rooms.has(boardId),

    applyRoleChange(boardId, sub, role) {
      const room = rooms.get(boardId);
      if (!room) return 0;

      let changed = 0;
      for (const session of room.sessions) {
        if (session.sub !== sub || session.role === role) continue;
        // ★ **خودِ نشست عوض می‌شود**، نه یک نقشه‌ی کنارِ آن: `handleMessage` روی
        //   `session.role` قضاوت می‌کند، پس هر نگه‌داریِ موازی یک منبعِ دومِ
        //   حقیقت می‌شد که می‌تواند واگرا شود.
        session.role = role;
        changed++;
        send(session, encodeMessage({ type: MSG_TYPES.HB_PERMISSION, role }));
      }

      if (changed > 0) {
        logger.info("نقش وسطِ session عوض شد", {
          boardId,
          sub: maskSubject(sub),
          role,
          sessions: changed,
        });
      }
      return changed;
    },

    async join(session) {
      const boardId = session.boardId;
      let room = rooms.get(boardId);

      if (!room) {
        // ★ دو نشستِ همزمانِ یک بورد نباید دو بار بارگذاری کنند — و بدترش، دو
        //   `Y.Doc`ِ جدا بسازند که هرگز به هم نمی‌رسند.
        const pending =
          loading.get(boardId) ??
          open(boardId).finally(() => {
            loading.delete(boardId);
          });
        loading.set(boardId, pending);
        room = await pending;
        // ممکن است در همین فاصله اتاق ساخته شده باشد؛ اولی برنده است.
        const existing = rooms.get(boardId);
        if (existing && existing !== room) {
          room.doc.destroy();
          room = existing;
        } else {
          rooms.set(boardId, room);
        }
      }

      if (room.idleTimer) {
        clearTimeout(room.idleTimer);
        room.idleTimer = null;
      }
      room.sessions.add(session);

      // ★ همگام‌سازیِ اولیه از سمتِ **سرور** هم شروع می‌شود: کلاینت step1/step2
      //   خودش را می‌فرستد، ولی اگر سرور منتظرِ آن بمانَد، بوردی که کلاینت هیچ
      //   خبری ازش ندارد هرگز نمی‌رسد.
      session.socket.on("message", (data: ArrayLike<number> | ArrayBuffer) => {
        handleMessage(room, session, new Uint8Array(data as ArrayBuffer));
      });

      // ★ **اول نقش، بعد سند.** کلاینت باید پیش از فرستادنِ هر چیزی بداند
      //   `viewer` است — وگرنه step2ِ خودش را می‌فرستد، `FORBIDDEN` می‌گیرد، و
      //   یک اتصالِ کاملاً سالم با یک خطا شروع می‌شود.
      send(session, encodeMessage({ type: MSG_TYPES.HB_PERMISSION, role: session.role }));

      const step1 = encoding.createEncoder();
      syncProtocol.writeSyncStep1(step1, room.doc);
      send(session, encodeMessage({ type: MSG_TYPES.SYNC, payload: encoding.toUint8Array(step1) }));

      const step2 = encoding.createEncoder();
      syncProtocol.writeSyncStep2(step2, room.doc);
      send(session, encodeMessage({ type: MSG_TYPES.SYNC, payload: encoding.toUint8Array(step2) }));

      // ★★ **حضورِ کسانی که از قبل اینجا بودند** — گام ۴٫۶.
      //
      // ⚠️ بدونِ این، تازه‌وارد تا **اولین تکانِ** هر همتا او را نمی‌بیند؛ و همتای
      //    ساکن ممکن است اصلاً تکان نخورد. یعنی یک بومِ پر از آدم، خالی به نظر
      //    می‌رسید.
      const present = room.presence.snapshot();
      if (present) send(session, present);

      // ★ و بقیه باید بدانند یک نفر اضافه شد: `users` باید **همیشه** درست باشد،
      //   نه فقط بعد از نوشتنِ بعدی.
      broadcast(room, encodeMessage({ type: MSG_TYPES.HB_ROOM_INFO, ...info(room, "saved") }));

      const leave = (): void => {
        // ⚠️ **اول از فهرست بردار، بعد حضور را پاک کن**: `forget` پخش می‌کند و
        //    نباید به سوکتی که همین الان بسته شده هم بفرستد.
        room.sessions.delete(session);
        // ★★ همان چیزی که گام ۳٫۵ نتوانست بیازماید: قطعِ اتصال، مکان‌نمای رفته را
        //    **فوری** پاک می‌کند — نه بعد از جاروی ۳۰ثانیه‌ای awareness.
        room.presence.forget(session);
        logger.debug("نشست بسته شد", {
          boardId,
          sub: maskSubject(session.sub),
          remaining: room.sessions.size,
        });
        if (room.sessions.size > 0) {
          broadcast(room, encodeMessage({ type: MSG_TYPES.HB_ROOM_INFO, ...info(room, "saved") }));
        }
        // ★ آخرین نفر که رفت، ساعتِ تخلیه شروع می‌شود — نه بلافاصله، چون رفرشِ
        //   ساده‌ی صفحه نباید بارگذاریِ کاملِ بورد را دوباره تحمیل کند.
        if (room.sessions.size === 0) scheduleEviction(room);
      };
      session.socket.once("close", leave);
      session.socket.once("error", leave);

      return room;
    },

    /**
     * ★★ خاموشیِ مودبانه — گام ۴٫۸. **ترتیب کلِ ادعاست.**
     *
     * ۱. **تخلیه:** صبر تا پایانِ نوشتن‌های در جریان. صداکننده باید سوکت‌ها را
     *    از قبل با `1001` بسته باشد، وگرنه ورودیِ تازه ادامه دارد و این صف
     *    هیچ‌وقت خالی نمی‌شود.
     * ۲. **snapshot:** فقط برای اتاق‌هایی که **صاحبشان** هستیم — قاعده‌ی ۴٫۷.
     *    نودِ بعدی بورد را از snapshot می‌خوانَد، نه از هزاران update.
     * ۳. **رهاکردنِ قفل:** تا بورد ۳۰ ثانیه بی‌صاحب نمانَد.
     */
    async close() {
      // ۱) تخلیه
      if (inFlight.size > 0) {
        logger.info("خاموشی: صبر برای نوشتن‌های در جریان", { pending: inFlight.size });
        await Promise.allSettled([...inFlight]);
      }

      // ۲) snapshot
      for (const room of rooms.values()) {
        if (!room.owner || !compactor) continue;
        try {
          const result = await compactor.compact(room.boardId, room.seq);
          if (result) {
            logger.info("خاموشی: snapshot گرفته شد", {
              boardId: room.boardId,
              seqUpto: result.seqUpto,
            });
          }
        } catch (cause) {
          // ⚠️ شکستِ snapshot نباید جلوی خاموشی را بگیرد: داده در لاگ هست و
          //    نودِ بعدی از همان می‌خوانَد — فقط کندتر.
          logger.error("خاموشی: snapshot نشد", {
            boardId: room.boardId,
            error: String(cause),
          });
        }
      }

      // ۳) رهاکردن
      for (const room of rooms.values()) {
        if (room.idleTimer) clearTimeout(room.idleTimer);
        releaseRoom(room);
        room.doc.destroy();
      }
      rooms.clear();
      await bus?.close();
      await ownerLock?.close();
    },
  };
}

// ─────────────────────────────────────────────────────────────
// ارسال
// ─────────────────────────────────────────────────────────────

/** فیلدهای `HB_ROOM_INFO` — یک جا، تا `users`/`seq` هیچ‌وقت از هم عقب نیفتند. */
function info(room: LiveRoom, save: "saved" | "saving" | "unsaved") {
  return { users: room.sessions.size, seq: room.seq, save } as const;
}

function broadcast(room: LiveRoom, payload: Uint8Array): void {
  for (const session of room.sessions) send(session, payload);
}

/**
 * ارسالِ امن.
 *
 * ⚠️ سوکتی که همین الان بسته شده هنوز چند لحظه در `sessions` است؛ `send` رویش
 * خطا می‌دهد و بدونِ این محافظ، یک قطعِ عادی کلِ پخش را می‌انداخت.
 */
function send(session: RtSession, payload: Uint8Array): void {
  try {
    session.socket.send(payload);
  } catch {
    // اتصال رفته — `close` خودش نشست را برمی‌دارد.
  }
}

// ─────────────────────────────────────────────────────────────
// مرزِ اعتماد
// ─────────────────────────────────────────────────────────────

/**
 * ★★ هر عنصر را با `hbElement` بسنج؛ ناسالم‌ها را **بشمار، لاگ کن، و بردار**.
 *
 * ⚠️ سه نوع ناسالمی با هم گرفته می‌شوند و هر سه در عمل دیده می‌شوند:
 *
 * ۱. مقداری که اصلاً `Y.Map` نیست (کلاینتِ باگ‌دار چیزِ دیگری نوشته).
 * ۲. `readElement` روی آن **بترکد** — پس در `try` است؛ وگرنه یک عنصرِ خراب کلِ
 *    بارگذاری را می‌انداخت، دقیقاً همان چیزی که نباید بشود.
 * ۳. شکلش با `hbElement` نخواند.
 *
 * ★ و یک بررسیِ چهارم که در schema نیست: **کلیدِ نقشه باید با `element.id` یکی
 *   باشد.** ناهمخوانی‌اش یعنی سند از دو مسیرِ متفاوت نوشته شده و هر ارجاعی
 *   (`frameId`، `boundElements`) می‌تواند به جای اشتباه برود.
 */
function quarantineInvalid(doc: Y.Doc, boardId: string, logger: Logger): string[] {
  const elements = boardRoots(doc).elements;
  const invalid: { id: string; reason: string }[] = [];

  for (const [id, value] of [...elements.entries()]) {
    const reason = inspectElement(id, value);
    if (reason) invalid.push({ id, reason });
  }

  if (invalid.length === 0) return [];

  doc.transact(() => {
    for (const { id } of invalid) elements.delete(id);
  }, QUARANTINE_ORIGIN);

  // ★ **شمرده و لاگ‌شده، نه بی‌صدا** — پینِ گام ۲٫۱. شناسه‌ی عنصر PII نیست، پس
  //   خام لاگ می‌شود؛ همان چیزی است که برای بازیابیِ دستی لازم است.
  logger.warn("عنصرِ نامعتبر قرنطینه شد", {
    boardId,
    count: invalid.length,
    elements: invalid.slice(0, 20),
  });

  return invalid.map((entry) => entry.id);
}

/**
 * آیا این سند **هیچ** opی ندارد؟
 *
 * ★ «تهی» یعنی هیچ کلاینتی چیزی ننوشته — نه اینکه محتوایش خالی به نظر برسد.
 * بوردی که همه‌ی عناصرش حذف شده‌اند تهی **نیست** و باید migrate شود.
 */
function isDocumentEmpty(doc: Y.Doc): boolean {
  return doc.store.clients.size === 0;
}

/**
 * آیا این updateِ Yjs **هیچ** تغییری ندارد؟
 *
 * ⚠️ به شکلِ بایتیِ «۰۰ ۰۰» تکیه نمی‌کند: آن یک جزئیاتِ پیاده‌سازیِ codec است.
 * `decodeUpdate` خودِ Yjs را می‌پرسد. اگر هر روز خواندنش شکست خورد، **تهی
 * نیست** برمی‌گردانیم — یعنی به مسیرِ رد می‌رود، نه به مسیرِ اجازه.
 */
function isEmptyUpdate(decoder: decoding.Decoder): boolean {
  try {
    const update = decoding.readVarUint8Array(decoder);
    const meta = Y.decodeUpdate(update);
    return meta.structs.length === 0 && meta.ds.clients.size === 0;
  } catch {
    return false;
  }
}

/**
 * آیا Yjs updateای را بایگانی کرده که نتوانسته اعمال کند؟
 *
 * ⚠️ `store.pendingStructs` **API عمومی نیست**، ولی تنها راهِ دیدنِ این حالت است
 * و Yjs هیچ رویداد یا خطایی برایش نمی‌دهد. دسترسی محافظت‌شده است تا اگر روزی
 * شکلش عوض شد، اینجا `false` برگردد نه اینکه بارگذاری بترکد — و تستِ صریحِ
 * «شکافِ علّی بی‌صدا نمی‌مانَد» همان موقع قرمز می‌شود و خبرمان می‌کند.
 */
function hasPendingStructs(doc: Y.Doc): boolean {
  const store = (doc as unknown as { store?: { pendingStructs?: unknown } }).store;
  return Boolean(store && store.pendingStructs);
}

/** `null` یعنی سالم؛ رشته یعنی دلیلِ ردشدن. */
function inspectElement(id: string, value: unknown): string | null {
  if (!(value instanceof Y.Map)) return "مقدارِ ریشه‌ی elements یک Y.Map نیست";

  let raw: unknown;
  try {
    raw = readElement(value as Y.Map<unknown>);
  } catch (cause) {
    return `readElement شکست خورد: ${String(cause)}`;
  }

  const parsed = hbElement.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return first ? `${first.path.join(".") || "<ریشه>"}: ${first.message}` : "شکلِ نامعتبر";
  }
  if (parsed.data.id !== id) return `کلید (${id}) با element.id (${parsed.data.id}) نمی‌خواند`;

  return null;
}
