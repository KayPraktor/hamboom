import { encodeMessage, MSG_TYPES } from "@hamboom/ydoc-schema";
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import type * as Y from "yjs";

import { createLogger, maskSubject, type Logger } from "./log.ts";
import type { RtSession } from "./server.ts";

/**
 * حضور و داده‌ی موقتِ سمتِ سرور — گام ۴٫۶،
 * [ADR-022](../../../ARCHITECTURE_DECISIONS.md#adr-022) و
 * [ADR-036](../../../ARCHITECTURE_DECISIONS.md#adr-036).
 *
 * ── ★★ چرا سرور یک `Awareness`ِ واقعی نگه می‌دارد و صرفاً بازپخش نمی‌کند ──
 *
 * بازپخشِ خالی ساده‌تر است و **دو چیز را می‌شکند**:
 *
 * ۱. **کلاینتِ تازه هیچ‌کس را نمی‌بیند.** حضور در پیامِ *تغییر* می‌آید؛ کسی که
 *    وسطِ کار وصل شود تا اولین تکانِ مکان‌نمای هر همتا او را نمی‌بیند — و همتای
 *    ساکن ممکن است هرگز تکان نخورد. سرور باید **وضعیتِ فعلی** را تحویل بدهد.
 * ۲. **قطعِ ناگهانی مکان‌نما را جا می‌گذارد.** پاک‌کردنِ حضورِ یک کلاینت یعنی
 *    فرستادنِ یک به‌روزرسانیِ awareness با clockِ **بعدی** برای همان `clientID`.
 *    بدونِ نگه‌داشتنِ clockها این پیام ساختنی نیست، و همتاها یک مکان‌نمای یخ‌زده
 *    تا ابد می‌بینند.
 *
 * ⚠️ **درسِ ثبت‌شده‌ی گام ۳٫۵ اینجا جواب می‌گیرد:** آنجا نوشتیم جاروی ۳۰ثانیه‌ای
 * با زمان‌بندِ ساختگی آزمودنی نیست چون `lib0/time` مقدارِ `Date.now` را در لحظه‌ی
 * بارگذاریِ ماژول می‌گیرد — و «مسیرِ واقعی این است که در فاز ۴ **سرور** قطعِ سوکت
 * را می‌بیند و حذف را پخش می‌کند». همان مسیر همین‌جاست، و برخلافِ جارو **فوری**
 * است: کاربر منتظرِ ۳۰ ثانیه نمی‌مانَد تا مکان‌نمای رفته پاک شود.
 *
 * ── ★ سرور خودش حضور ندارد ────────────────────────────────────────────
 *
 * `setLocalState(null)`: این `Awareness` یک **دفترِ ثبت** است، نه یک شرکت‌کننده.
 * بدونش سرور به‌عنوان یک کاربرِ نامرئی در فهرستِ همه ظاهر می‌شد.
 */

/** یک ثبتِ حضور برای یک اتاق. */
export interface RoomPresence {
  /** وضعیتِ فعلیِ همه — برای کلاینتِ تازه. `null` یعنی هنوز کسی حضور نداده. */
  snapshot(): Uint8Array | null;
  /** پیامِ `AWARENESS`ِ رسیده از یک نشست. پخش از راهِ `broadcast` انجام می‌شود. */
  receive(session: RtSession, payload: Uint8Array): void;
  /**
   * ★ آیا این `clientId` واقعاً مالِ همین نشست است؟
   *
   * ⚠️ **fail-open و عمدی:** تا وقتی نشست حضورش را اعلام نکرده، مالکیتی نمی‌دانیم
   * و جلوی چیزی را نمی‌گیریم — وگرنه اولین ephemeralِ یک کلاینتِ سالم (که ممکن
   * است زودتر از awarenessش برسد) بی‌دلیل دور ریخته می‌شد.
   */
  ownsClient(session: RtSession, clientId: number): boolean;
  /**
   * حضوری که از **نودِ دیگر** آمده (گام ۴٫۷).
   *
   * ⚠️ عمداً از `receive` جداست: مالکیتِ `clientID` را ثبت **نمی‌کند**. آن کلاینت
   * روی نودِ دیگری نشسته و پاک‌کردنش کارِ همان نود است — اگر اینجا هم مالکش
   * می‌شدیم، بستنِ یک نشستِ محلی حضورِ یک کاربرِ **زنده‌ی** نودِ دیگر را پاک می‌کرد.
   */
  receiveRemote(payload: Uint8Array): void;
  /** نشست رفت → حضورش پاک و حذف به بقیه پخش می‌شود. */
  forget(session: RtSession): void;
}

export interface RoomPresenceOptions {
  doc: Y.Doc;
  /** پخش به همه‌ی نشست‌های **این نود** به‌جز `except`. */
  broadcast: (payload: Uint8Array, except: RtSession | null) => void;
  /**
   * انتشار برای نودهای دیگر (گام ۴٫۷) — فقط برای تغییرهای **محلی**.
   *
   * ⚠️ اگر تغییرِ رسیده از گذرگاه را دوباره منتشر کنیم، یک حلقه‌ی بی‌پایان بینِ
   * دو نود می‌شود. برچسبِ `nodeId` سدِ دوم است؛ سدِ اول همین‌جاست.
   */
  publish?: (payload: Uint8Array) => void;
  logger?: Logger;
}

/** originِ حذفِ ناشی از قطعِ اتصال — تا از به‌روزرسانیِ خودِ کلاینت جدا بماند. */
const LEAVE_ORIGIN = "hamboom:leave";

/** originِ حضوری که از نودِ دیگر آمده — **دوباره منتشر نمی‌شود**. */
const REMOTE_ORIGIN = "hamboom:remote";

export function createRoomPresence({
  doc,
  broadcast,
  publish,
  logger = createLogger(),
}: RoomPresenceOptions): RoomPresence {
  const awareness = new Awareness(doc);
  // ★ سرور شرکت‌کننده نیست (بالا).
  awareness.setLocalState(null);

  /** کدام `clientID`ها مالِ کدام نشست‌اند — برای پاک‌سازی و برای مالکیت. */
  const owned = new Map<RtSession, Set<number>>();
  const owner = new Map<number, RtSession>();

  awareness.on(
    "update",
    (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      const changed = [...added, ...updated, ...removed];
      if (changed.length === 0) return;

      const from = origin as RtSession | string | null;
      const session = typeof from === "object" && from !== null ? from : null;

      if (session) {
        // ★ مالکیت از **خودِ به‌روزرسانی** یاد گرفته می‌شود، نه از یک اعلامِ جدا:
        //   هر چیزِ دیگری یک منبعِ دومِ حقیقت بود که می‌تواند واگرا شود.
        const ids = owned.get(session) ?? new Set<number>();
        for (const id of [...added, ...updated]) {
          ids.add(id);
          owner.set(id, session);
        }
        for (const id of removed) {
          ids.delete(id);
          if (owner.get(id) === session) owner.delete(id);
        }
        owned.set(session, ids);
      }

      // ⚠️ **از حالتِ فعلیِ دفتر encode می‌شود، نه بازپخشِ بایت‌های ورودی.** برای
      //    `removed` اصلاً بایتِ ورودی‌ای وجود ندارد (حذف را خودِ سرور می‌سازد)،
      //    و برای بقیه هم این تضمین می‌کند آنچه پخش می‌شود همان چیزی است که در
      //    دفتر نشسته — نه چیزی که فرستنده *ادعا* کرده.
      const update = encodeAwarenessUpdate(awareness, changed);
      broadcast(encodeMessage({ type: MSG_TYPES.AWARENESS, payload: update }), session);

      // ★ فقط تغییرِ **محلی** به نودهای دیگر می‌رود. آنچه از گذرگاه آمده
      //   (`REMOTE_ORIGIN`) همین‌جا می‌ایستد — سدِ اولِ ضدِ حلقه.
      if (from !== REMOTE_ORIGIN) publish?.(update);
    },
  );

  return {
    snapshot() {
      const clients = [...awareness.getStates().keys()];
      if (clients.length === 0) return null;
      return encodeMessage({
        type: MSG_TYPES.AWARENESS,
        payload: encodeAwarenessUpdate(awareness, clients),
      });
    },

    receive(session, payload) {
      // ⚠️ خطای اینجا نباید اتاق را بیندازد: یک کلاینتِ باگ‌دار (یا بدخواه)
      //    می‌تواند بایتِ خراب بفرستد، و حضور آن‌قدر مهم نیست که کلِ نشست را
      //    به‌خاطرش ببندیم. هیچ‌چیز هم پایدار نمی‌شود، پس سطحِ خطرش کوچک است.
      try {
        applyAwarenessUpdate(awareness, payload, session);
      } catch (cause) {
        logger.warn("به‌روزرسانیِ حضور خوانده نشد", {
          sub: maskSubject(session.sub),
          error: String(cause),
        });
      }
    },

    ownsClient(session, clientId) {
      const holder = owner.get(clientId);
      return holder === undefined || holder === session;
    },

    receiveRemote(payload) {
      try {
        applyAwarenessUpdate(awareness, payload, REMOTE_ORIGIN);
      } catch (cause) {
        logger.warn("حضورِ رسیده از گذرگاه خوانده نشد", { error: String(cause) });
      }
    },

    forget(session) {
      const ids = owned.get(session);
      owned.delete(session);
      if (!ids || ids.size === 0) return;

      for (const id of ids) owner.delete(id);
      // ★ حذف از راهِ خودِ `Awareness` تا clock درست جلو برود؛ رویدادِ `update`
      //   بالا پخشش می‌کند. `origin` یک نشست نیست، پس به **همه** می‌رود.
      removeAwarenessStates(awareness, [...ids], LEAVE_ORIGIN);
    },
  };
}
