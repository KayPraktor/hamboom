import { hbElement } from "@hamboom/shared-types";
import {
  boardRoots,
  createBoardDoc,
  decodeMessage,
  encodeMessage,
  HB_ERROR_CODES,
  migrateDocument,
  MSG_TYPES,
  readElement,
  type MigrationResult,
} from "@hamboom/ydoc-schema";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

import { createLogger, maskSubject, type Logger } from "./log.ts";
import type { UpdateLog } from "./persistence/update-log.ts";
import { RtProtocolError } from "./protocol-error.ts";
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
}

export function createRoomManager({
  store,
  log,
  limits,
  logger = createLogger(),
}: RoomManagerOptions): RoomManager {
  const rooms = new Map<string, LiveRoom>();
  /** بارگذاری‌های در جریان — دو نشستِ همزمان نباید دو بار سند را بسازند. */
  const loading = new Map<string, Promise<LiveRoom>>();

  function evict(room: LiveRoom): void {
    if (room.sessions.size > 0) return;
    rooms.delete(room.boardId);
    room.doc.destroy();
    logger.info("اتاق از حافظه رفت", { boardId: room.boardId });
  }

  function scheduleEviction(room: LiveRoom): void {
    if (room.idleTimer) clearTimeout(room.idleTimer);
    // ⚠️ `unref` تا یک اتاقِ بی‌کار جلوی خاموش‌شدنِ فرایند را نگیرد.
    room.idleTimer = setTimeout(() => evict(room), limits.idleTimeoutMs);
    room.idleTimer.unref?.();
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

    const { snapshot, updates } = await store.load(boardId);
    const doc = createBoardDoc();

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
    const migration = migrateDocument(doc);
    const quarantined = quarantineInvalid(doc, boardId, logger);

    const bytes = Y.encodeStateAsUpdate(doc).byteLength;
    if (bytes > limits.maxDocBytes) {
      doc.destroy();
      throw new RtProtocolError(
        HB_ERROR_CODES.DOC_TOO_LARGE,
        "این بورد از حدِ مجاز بزرگ‌تر است.",
        `${bytes} > ${limits.maxDocBytes}`,
      );
    }

    const room: LiveRoom = {
      boardId,
      doc,
      report: { migration, quarantined, bytes, pendingStructs },
      sessions: new Set(),
      idleTimer: null,
      seq: log ? await log.latestSeq(boardId) : 0,
      get size() {
        return this.sessions.size;
      },
    };

    wireDocument(room);

    logger.info("اتاق بارگذاری شد", {
      boardId,
      bytes,
      updates: updates.length,
      fromSnapshot: snapshot !== null,
      migrated: migration.changed ? `${migration.from}→${migration.to}` : null,
      quarantined: quarantined.length,
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
      if (!(origin instanceof ClientOrigin)) return;
      void persistAndFanout(room, update, origin.session);
    });
  }

  async function persistAndFanout(
    room: LiveRoom,
    update: Uint8Array,
    from: RtSession,
  ): Promise<void> {
    try {
      if (log) {
        const appended = await log.append(room.boardId, update, from.sub);
        room.seq = appended.seq;
      }
    } catch (cause) {
      // ⚠️ نوشتن نشد → **نمی‌گوییم ذخیره شد**. کلاینت `unsaved` می‌بیند و
      //    می‌داند کارش هنوز در خطر است — این کلِ نکته‌ی ADR-009 است.
      logger.error("نوشتنِ update شکست خورد", { boardId: room.boardId, error: String(cause) });
      broadcast(room, encodeMessage({ type: MSG_TYPES.HB_ROOM_INFO, ...info(room, "unsaved") }));
      return;
    }

    const encoder = encoding.createEncoder();
    syncProtocol.writeUpdate(encoder, update);
    const payload = encodeMessage({
      type: MSG_TYPES.SYNC,
      payload: encoding.toUint8Array(encoder),
    });
    for (const session of room.sessions) {
      if (session !== from) send(session, payload);
    }

    broadcast(room, encodeMessage({ type: MSG_TYPES.HB_ROOM_INFO, ...info(room, "saved") }));
  }

  function handleMessage(room: LiveRoom, session: RtSession, data: Uint8Array): void {
    const message = decodeMessage(data);
    if (!message || message.type !== MSG_TYPES.SYNC) return;

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

  return {
    get size() {
      return rooms.size;
    },

    has: (boardId) => rooms.has(boardId),

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

      const step1 = encoding.createEncoder();
      syncProtocol.writeSyncStep1(step1, room.doc);
      send(session, encodeMessage({ type: MSG_TYPES.SYNC, payload: encoding.toUint8Array(step1) }));

      const step2 = encoding.createEncoder();
      syncProtocol.writeSyncStep2(step2, room.doc);
      send(session, encodeMessage({ type: MSG_TYPES.SYNC, payload: encoding.toUint8Array(step2) }));

      send(session, encodeMessage({ type: MSG_TYPES.HB_ROOM_INFO, ...info(room, "saved") }));

      const leave = (): void => {
        room.sessions.delete(session);
        logger.debug("نشست بسته شد", {
          boardId,
          sub: maskSubject(session.sub),
          remaining: room.sessions.size,
        });
        // ★ آخرین نفر که رفت، ساعتِ تخلیه شروع می‌شود — نه بلافاصله، چون رفرشِ
        //   ساده‌ی صفحه نباید بارگذاریِ کاملِ بورد را دوباره تحمیل کند.
        if (room.sessions.size === 0) scheduleEviction(room);
      };
      session.socket.once("close", leave);
      session.socket.once("error", leave);

      return room;
    },

    close() {
      for (const room of rooms.values()) {
        if (room.idleTimer) clearTimeout(room.idleTimer);
        room.doc.destroy();
      }
      rooms.clear();
      return Promise.resolve();
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
