import { boardRoots } from "@hamboom/ydoc-schema";
import * as Y from "yjs";

import { createLogger, type Logger } from "../log.ts";
import type { SnapshotCatalog } from "./snapshot-catalog.ts";
import { snapshotKey, type SnapshotStore } from "./snapshot-store.ts";
import type { UpdateLog } from "./update-log.ts";

/**
 * فشرده‌سازی — گام ۴٫۴، [ADR-009](../../../../ARCHITECTURE_DECISIONS.md#adr-009).
 *
 * لاگِ تفاضلی جای نوشتنِ stateِ کامل در هر تغییر را می‌گیرد، ولی اگر هرگز فشرده
 * نشود بارگذاریِ بوردِ قدیمی کند می‌شود. پس هر `RT_SNAPSHOT_EVERY_UPDATES` update
 * یا `RT_SNAPSHOT_EVERY_MS` میلی‌ثانیه (هرکدام زودتر)، سند فشرده و updateهای
 * قدیمی‌تر حذف می‌شوند.
 *
 * ═══ ★★ دو ارثیه‌ی این گام، و اینکه هرکدام چطور مهار شده ═══════════════
 *
 * ── ۱) «قرنطینه + snapshot» (معلق از گام ۴٫۲) ──
 *
 * گام ۴٫۲ عنصرِ نامعتبر را از سندِ **درون‌حافظه‌ای** برمی‌دارد و گام ۴٫۳ تصمیم
 * گرفت که آن حذف **پایدار نشود** (`QUARANTINE_ORIGIN`): لاگ حقیقتِ خام را نگه
 * می‌دارد و قرنطینه هر بار سرِ بارگذاری دوباره اجرا می‌شود. حالا فشرده‌سازی این
 * را تهدید می‌کند: اگر snapshot از سندِ **قرنطینه‌شده** گرفته شود و updateها حذف
 * شوند، آن پاک‌سازی **دائمی** می‌شود و دیگر راهی به داده‌ی خام نیست.
 *
 * ★ **مهارش ساختاری است، نه قاعده‌ای:** این ماژول هیچ راهی به `Y.Doc`ِ اتاق
 * ندارد — امضایش فقط `boardId` می‌گیرد. سند را **از نو** و مستقیماً از لاگ
 * می‌سازد. پس «اشتباهاً از سندِ زنده snapshot گرفتن» چیزی نیست که یادت برود؛
 * چیزی است که **نمی‌شود** نوشت.
 * ⚠️ اگر روزی کسی برای «بهینه‌سازی» سندِ اتاق را به اینجا پاس داد، همان لحظه
 * این تضمین شکسته است.
 *
 * سودِ دومِ همین ساختار: snapshot از **همان مسیری** ساخته می‌شود که بارگذاری
 * می‌سازد، پس «آنچه ذخیره شد» و «آنچه بعداً بارگذاری می‌شود» یک کد است.
 *
 * ── ۲) حذفِ updateها همان تله‌ی **شکافِ علّی** را مسلح می‌کند ──
 *
 * Yjs updateِ بی‌پیشینه را در `pendingStructs` بایگانی می‌کند و **هیچ خطایی
 * نمی‌دهد** (تله‌ی گام ۳٫۱، سه بار تا حالا). تا وقتی همه‌ی updateها در لاگ‌اند،
 * بدترین حالت کندی است. بعد از `prune`، اگر مرزِ snapshot یک بایت جابه‌جا باشد،
 * بورد **بی‌خطا ناقص** بالا می‌آید و راهِ برگشتی نیست.
 *
 * ★ پس ترتیب زیر عمدی است و هر مرحله‌اش تست دارد:
 *
 *   ۱. بازسازیِ سند از `[snapshotِ قبلی + updateهای (قبلی, target]]`
 *   ۲. ★ **اگر همین بازسازی شکافِ علّی داشت، هیچ کاری نکن** — snapshot گرفتن از
 *      یک سندِ ناقص، نقص را دائمی می‌کند
 *   ۳. نوشتنِ بایت‌ها در `SnapshotStore`
 *   ۴. ★ **بازخواندنشان از همان انبار** و مقایسه‌ی state vector — نه از حافظه
 *   ۵. ثبتِ رکورد در کاتالوگ ← **نقطه‌ی commit**
 *   ۶. و تازه حالا `prune`
 *
 * ⚠️ هر شکستی قبل از مرحله‌ی ۵ یعنی «هیچ اتفاقی نیفتاد»: نه رکوردی هست، نه
 * updateای پاک شده. بدترین باقی‌مانده یک فایلِ یتیم است.
 * ⚠️ و شکست **بینِ** ۵ و ۶ هم بی‌خطر است: updateهای پاک‌نشده دوباره روی snapshot
 * اعمال می‌شوند و Yjs نسبت به تکرار idempotent است. ترتیبِ برعکس (`prune` قبل از
 * ثبت) تنها ترتیبی است که داده را از بین می‌برد.
 */

export interface CompactionThresholds {
  /** `RT_SNAPSHOT_EVERY_UPDATES`. */
  everyUpdates: number;
  /** `RT_SNAPSHOT_EVERY_MS`. */
  everyMs: number;
}

export interface CompactorOptions {
  log: UpdateLog;
  store: SnapshotStore;
  catalog: SnapshotCatalog;
  thresholds: CompactionThresholds;
  logger?: Logger;
  /** تزریق‌پذیر برای تست — وگرنه ساعتِ دیوار. */
  now?: () => number;
}

export interface CompactionResult {
  /** `seq`ی که snapshot تا آن را در خود دارد. */
  seqUpto: number;
  byteSize: number;
  elementCount: number;
  /** چند ردیف از `board_updates` حذف شد. */
  pruned: number;
}

export interface Compactor {
  /**
   * آیا با این وضعیت باید فشرده کرد؟ **بدونِ هیچ I/O** — روی مسیرِ داغِ هر update
   * صدا زده می‌شود.
   */
  shouldCompact(state: { seq: number; sinceSeq: number; sinceAt: number }): boolean;
  /**
   * فشرده‌سازیِ بورد تا `targetSeq`.
   *
   * ★ ورودی‌اش عمداً `boardId` است و نه `Y.Doc` — دلیلش بالا («ارثیه‌ی ۱»).
   * `null` یعنی کاری انجام نشد (چیزی برای فشردن نبود، یا شکافِ علّی دیده شد).
   */
  compact(boardId: string, targetSeq: number): Promise<CompactionResult | null>;
}

export function createCompactor({
  log,
  store,
  catalog,
  thresholds,
  logger = createLogger(),
  now = Date.now,
}: CompactorOptions): Compactor {
  return {
    shouldCompact({ seq, sinceSeq, sinceAt }) {
      const pending = seq - sinceSeq;
      // ⚠️ **هیچ‌وقت روی صفر** — یک snapshotِ خالی چیزی را کوچک نمی‌کند و فقط یک
      //    ردیف و یک فایلِ اضافه می‌سازد. `everyMs` هم زیرِ همین شرط است.
      if (pending <= 0) return false;
      return pending >= thresholds.everyUpdates || now() - sinceAt >= thresholds.everyMs;
    },

    async compact(boardId, targetSeq) {
      const previous = await catalog.latest(boardId);
      const fromSeq = previous?.seqUpto ?? 0;
      if (targetSeq <= fromSeq) return null;

      // ── ۱) بازسازی از لاگ — **نه از سندِ اتاق** ─────────────────────
      const updates = await log.since(boardId, fromSeq, targetSeq);
      const base = previous ? await store.get(previous.storageKey) : null;
      if (previous && base === null) {
        // ⚠️ رکورد هست ولی بایت‌ها نیستند: انبار و کاتالوگ از هم واگرا شده‌اند.
        //    ادامه دادن یعنی snapshotِ تازه‌ای که پیشینه‌اش را ندارد.
        logger.error("بایت‌های snapshotِ قبلی پیدا نشد؛ فشرده‌سازی رها شد", {
          boardId,
          storageKey: previous.storageKey,
        });
        return null;
      }

      // ★★ **`new Y.Doc()` و نه `createBoardDoc()`** — این یکی از آن تصمیم‌هایی
      //    است که برعکسش هم کاملاً کار می‌کند و بی‌صدا خراب می‌شود:
      //    `createBoardDoc` هر بار `meta.schemaVersion` را با یک `clientID`ِ
      //    **تازه** می‌نویسد. آن op وارد `encodeStateAsUpdate` می‌شود، یعنی هر
      //    فشرده‌سازی یک مدخلِ کلاینتِ دیگر به state vector اضافه می‌کند —
      //    **برای همیشه**. بعد از هزار فشرده‌سازی، هزار مدخل؛ رشدِ بی‌کران در
      //    دقیقاً همان ساختاری که این ماژول برای کوچک کردنش هست.
      //    ⚠️ سند اینجا از لاگ بازسازی می‌شود و `meta` از قبل در آن هست؛ ساختنِ
      //    دوباره‌اش نه لازم است نه بی‌ضرر.
      const doc = new Y.Doc();
      try {
        doc.transact(() => {
          if (base) Y.applyUpdate(doc, base);
          for (const update of updates) Y.applyUpdate(doc, update);
        });

        // ── ۲) ★ شکافِ علّی؟ پس دست نگه دار ─────────────────────────
        if (hasPendingStructs(doc)) {
          logger.error("شکافِ علّی در بازسازیِ فشرده‌سازی — snapshot گرفته نشد", {
            boardId,
            fromSeq,
            targetSeq,
            updates: updates.length,
          });
          return null;
        }

        const bytes = Y.encodeStateAsUpdate(doc);
        const stateVector = Y.encodeStateVector(doc);
        const elementCount = boardRoots(doc).elements.size;
        const key = snapshotKey(boardId, targetSeq);

        // ── ۳) نوشتن ────────────────────────────────────────────────
        await store.put(key, bytes);

        // ── ۴) ★★ بازخوانی از **خودِ انبار**، نه از حافظه ────────────
        //    ادعای «نوشته شد» را با چیزی که در دست داریم تایید نکن؛ همان
        //    اشتباهی است که تستِ دودِ ۰٫۲ سال‌ها مرتکب شد. اگر `put` بی‌صدا
        //    ناقص نوشته باشد، **این** تنها جایی است که معلوم می‌شود — و
        //    بلافاصله بعدش داده‌ی واقعی حذف می‌شود.
        const written = await store.get(key);
        if (written === null) throw new Error("snapshot بعد از نوشتن خوانده نشد");
        const check = new Y.Doc();
        Y.applyUpdate(check, written);
        const writtenVector = Y.encodeStateVector(check);
        check.destroy();
        if (!sameBytes(writtenVector, stateVector)) {
          throw new Error("state vectorِ snapshotِ نوشته‌شده با سندِ اصلی نمی‌خواند");
        }

        // ── ۵) نقطه‌ی commit ────────────────────────────────────────
        await catalog.record(boardId, {
          seqUpto: targetSeq,
          storageKey: key,
          stateVector,
          byteSize: bytes.byteLength,
          elementCount,
        });

        // ── ۶) و تازه حالا حذف ──────────────────────────────────────
        const pruned = await log.prune(boardId, targetSeq);

        // زباله‌روبیِ snapshotهای کهنه: **اول فایل، بعد ردیف** — برعکسش یعنی
        // فایلی که هیچ‌کس نمی‌شناسد و هیچ‌وقت پاک نمی‌شود.
        for (const stale of await catalog.older(boardId, targetSeq)) {
          await store.delete?.(stale.storageKey);
          await catalog.forget(boardId, stale.seqUpto);
        }

        logger.info("بورد فشرده شد", {
          boardId,
          seqUpto: targetSeq,
          bytes: bytes.byteLength,
          elements: elementCount,
          folded: updates.length,
          pruned,
        });

        return { seqUpto: targetSeq, byteSize: bytes.byteLength, elementCount, pruned };
      } finally {
        doc.destroy();
      }
    },
  };
}

/**
 * همان نگهبانِ `room.ts`، اینجا هم لازم است.
 *
 * ⚠️ عمداً کپی است و نه import: آنجا **مرزِ اعتماد** است و اینجا **مرزِ حذف**.
 * دو مصرف‌کننده‌ی مستقل با دو دلیلِ مستقل؛ اگر یکی روزی رفتارش عوض شد، آن یکی
 * نباید بی‌خبر با آن برود.
 */
function hasPendingStructs(doc: Y.Doc): boolean {
  const store = (doc as unknown as { store?: { pendingStructs?: unknown } }).store;
  return Boolean(store && store.pendingStructs);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && a.every((byte, index) => byte === b[index]);
}
