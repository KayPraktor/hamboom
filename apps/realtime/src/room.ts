import { hbElement } from "@hamboom/shared-types";
import {
  boardRoots,
  createBoardDoc,
  HB_ERROR_CODES,
  migrateDocument,
  readElement,
  type MigrationResult,
} from "@hamboom/ydoc-schema";
import * as Y from "yjs";

import { createLogger, maskSubject, type Logger } from "./log.ts";
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

/** originِ حذفِ قرنطینه — تا گام ۴٫۳ بتواند تصمیم بگیرد این را لاگ کند یا نه. */
export const QUARANTINE_ORIGIN = "hamboom:quarantine";

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
}

export function createRoomManager({
  store,
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
      get size() {
        return this.sessions.size;
      },
    };

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
