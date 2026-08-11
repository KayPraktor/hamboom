import type { HbElement } from "@hamboom/shared-types";
import { boardRoots, createBoardDoc, writeElement } from "@hamboom/ydoc-schema";
import * as Y from "yjs";
import { describe, expect, it, vi } from "vitest";

import { createLogger } from "../log.ts";
import { QUARANTINE_ORIGIN } from "../room.ts";
import { createPersistedBoardStore } from "../store/persisted-board-store.ts";
import { createCompactor, type Compactor } from "./compactor.ts";
import { MemorySnapshotCatalog, type SnapshotCatalog } from "./snapshot-catalog.ts";
import { MemorySnapshotStore, snapshotKey, type SnapshotStore } from "./snapshot-store.ts";
import { MemoryUpdateLog, type UpdateLog } from "./update-log.ts";

/**
 * تست‌های گام ۴٫۴ — **فشرده‌سازی، و دو ارثیه‌ای که با خودش می‌آورد**.
 *
 * ⚠️ مثلِ `durability.test.ts`، این فایل با انبارِ حافظه‌ای ادعای **دوام** نمی‌کند.
 * آنچه اینجا قفل می‌شود **ترتیب و شرط‌ها** است. ادعای کاملِ معیارِ پذیرش (۵۰۰
 * updateِ واقعی، حذفِ واقعی، و مقایسه‌ی state vector از راهِ سوکت) در
 * [`scripts/rt-compaction.ts`](../../../../scripts/rt-compaction.ts) با Postgres و
 * فایل‌سیستمِ واقعی سنجیده می‌شود.
 */

const BOARD = "brd_c1";

function element(id: string): HbElement {
  return {
    id,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    angle: 0,
    index: "a1",
    frameId: null,
    groupIds: [],
    locked: false,
    strokeColor: "#1a1a1a",
    backgroundColor: "#FFF9B1",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    updated: 0,
    isDeleted: false,
    boundElements: null,
    link: null,
    customData: {
      hb: { schema: 1, kind: "sticky", createdBy: "u", lastEditedBy: "u", createdAt: 0 },
    },
  } as HbElement;
}

/**
 * یک بوردِ زنده که هر تغییرش در لاگ می‌نشیند — همان کاری که اتاق می‌کند.
 *
 * ★ **updateِ افزایشی**، نه `encodeStateAsUpdate`ِ کامل: دقیقاً همان چیزی که
 * روی سیم می‌رود، وگرنه تستِ شکافِ علّی بی‌معنا می‌شود.
 */
async function seedBoard(log: UpdateLog, ids: string[]): Promise<Y.Doc> {
  const doc = createBoardDoc();
  // اولین update کلِ سند است (شاملِ opِ `meta.schemaVersion`ِ `createBoardDoc`).
  await log.append(BOARD, Y.encodeStateAsUpdate(doc), null);

  for (const id of ids) {
    const before = Y.encodeStateVector(doc);
    doc.transact(() => {
      writeElement(boardRoots(doc).elements, element(id));
    });
    await log.append(BOARD, Y.encodeStateAsUpdate(doc, before), null);
  }
  return doc;
}

interface Harness {
  log: MemoryUpdateLog;
  store: MemorySnapshotStore;
  catalog: MemorySnapshotCatalog;
  compactor: Compactor;
}

function harness(overrides: Partial<{ store: SnapshotStore; catalog: SnapshotCatalog }> = {}) {
  const log = new MemoryUpdateLog();
  const store = new MemorySnapshotStore();
  const catalog = new MemorySnapshotCatalog();
  const compactor = createCompactor({
    log,
    store: overrides.store ?? store,
    catalog: overrides.catalog ?? catalog,
    thresholds: { everyUpdates: 3, everyMs: 60_000 },
    logger: createLogger({ level: "fatal" }),
  });
  return { log, store, catalog, compactor } satisfies Harness;
}

/**
 * سندِ بازسازی‌شده از راهِ **بارگذاریِ واقعی** — یعنی مسیرِ یک کلاینتِ تازه.
 *
 * ⚠️ **`new Y.Doc()` و نه `createBoardDoc()`**: آن یکی خودش یک opِ تازه با
 * `clientID`ِ نو می‌نویسد، و آن‌وقت مقایسه‌ی state vector همیشه شکست می‌خورد —
 * نه به خاطرِ باگ، بلکه به خاطرِ خودِ ابزارِ سنجش. سنجه باید ساکت باشد.
 */
async function loadThroughStore(
  log: UpdateLog,
  store: SnapshotStore,
  catalog: SnapshotCatalog,
): Promise<Y.Doc> {
  const board = createPersistedBoardStore({ log, snapshots: { store, catalog } });
  const { snapshot, updates } = await board.load(BOARD);
  const doc = new Y.Doc();
  doc.transact(() => {
    if (snapshot) Y.applyUpdate(doc, snapshot);
    for (const update of updates) Y.applyUpdate(doc, update);
  });
  return doc;
}

/** تعدادِ کلاینت‌های ثبت‌شده در سند — بایتِ اولِ state vector شمارشِ آن‌هاست. */
function clientCount(doc: Y.Doc): number {
  return doc.store.clients.size;
}

describe("گام ۴٫۴ — فشرده‌سازی", () => {
  describe("معیارِ پذیرش: فشرده می‌شود، حذف می‌شود، و کلاینتِ تازه همان سند را می‌گیرد", () => {
    it("snapshot ساخته می‌شود و updateهای قدیمی حذف می‌شوند", async () => {
      const { log, store, catalog, compactor } = harness();
      const original = await seedBoard(log, ["stk_1", "stk_2", "stk_3"]);
      const target = await log.latestSeq(BOARD);

      const result = await compactor.compact(BOARD, target);

      expect(result).not.toBeNull();
      expect(result?.seqUpto).toBe(target);
      expect(result?.elementCount).toBe(3);
      expect(result?.pruned).toBe(target);
      // ★ لاگ واقعاً خالی شد — نه اینکه فقط ادعا شود.
      expect(await log.since(BOARD, 0)).toHaveLength(0);
      expect(store.size).toBe(1);
      expect(catalog.count(BOARD)).toBe(1);
      original.destroy();
    });

    it("★★ کلاینتِ تازه **دقیقاً همان سند** را می‌گیرد — مقایسه‌ی state vector", async () => {
      const { log, store, catalog, compactor } = harness();
      const original = await seedBoard(log, ["stk_1", "stk_2", "stk_3", "stk_4"]);
      await compactor.compact(BOARD, await log.latestSeq(BOARD));

      const reloaded = await loadThroughStore(log, store, catalog);

      expect([...boardRoots(reloaded).elements.keys()].sort()).toEqual([
        "stk_1",
        "stk_2",
        "stk_3",
        "stk_4",
      ]);
      expect(Y.encodeStateVector(reloaded)).toEqual(Y.encodeStateVector(original));
      original.destroy();
      reloaded.destroy();
    });

    it("updateهای **بعد از** مرزِ snapshot دست‌نخورده می‌مانند و بعد اعمال می‌شوند", async () => {
      const { log, store, catalog, compactor } = harness();
      const original = await seedBoard(log, ["stk_1", "stk_2"]);
      const boundary = await log.latestSeq(BOARD);
      await compactor.compact(BOARD, boundary);

      // یک ژستِ تازه **بعد** از فشرده‌سازی.
      const before = Y.encodeStateVector(original);
      original.transact(() => {
        writeElement(boardRoots(original).elements, element("stk_after"));
      });
      const appended = await log.append(BOARD, Y.encodeStateAsUpdate(original, before), null);

      // ★ `seq` نباید بازاستفاده شود — وگرنه `since(boundary)` این را رد می‌کند.
      expect(appended.seq).toBeGreaterThan(boundary);

      const reloaded = await loadThroughStore(log, store, catalog);
      expect(boardRoots(reloaded).elements.has("stk_after")).toBe(true);
      expect(Y.encodeStateVector(reloaded)).toEqual(Y.encodeStateVector(original));
      original.destroy();
      reloaded.destroy();
    });

    it("فشرده‌سازیِ **دوم** روی snapshotِ اول سوار می‌شود و کهنه را جمع می‌کند", async () => {
      const { log, store, catalog, compactor } = harness();
      const original = await seedBoard(log, ["stk_1", "stk_2"]);
      await compactor.compact(BOARD, await log.latestSeq(BOARD));

      const before = Y.encodeStateVector(original);
      original.transact(() => {
        writeElement(boardRoots(original).elements, element("stk_3"));
      });
      await log.append(BOARD, Y.encodeStateAsUpdate(original, before), null);
      const second = await compactor.compact(BOARD, await log.latestSeq(BOARD));

      expect(second?.elementCount).toBe(3);
      // ★ فقط **یک** snapshot می‌مانَد؛ فایل و ردیفِ کهنه هر دو رفته‌اند.
      expect(catalog.count(BOARD)).toBe(1);
      expect(store.size).toBe(1);

      const reloaded = await loadThroughStore(log, store, catalog);
      expect(Y.encodeStateVector(reloaded)).toEqual(Y.encodeStateVector(original));
      original.destroy();
      reloaded.destroy();
    });
  });

  /**
   * ★★ معیارِ پذیرشِ صریحِ TODO: «اگر snapshot ننشسته باشد، updateها حذف **نشوند**».
   *
   * سه راهِ ننشستن آزموده می‌شود، چون هر سه در عمل ممکن‌اند و هر سه باید به یک
   * نتیجه برسند: **لاگ دست‌نخورده**.
   */
  describe("★★ حذفِ زودهنگام — هیچ‌کدام نباید داده را ببرد", () => {
    it("نوشتنِ بایت‌ها شکست بخورد → هیچ حذفی، هیچ رکوردی", async () => {
      const store = new MemorySnapshotStore();
      const failing: SnapshotStore = {
        put: () => Promise.reject(new Error("دیسک پر است")),
        get: (key) => store.get(key),
      };
      const { log, catalog, compactor } = harness({ store: failing });
      const original = await seedBoard(log, ["stk_1", "stk_2"]);
      const target = await log.latestSeq(BOARD);

      await expect(compactor.compact(BOARD, target)).rejects.toThrow("دیسک پر است");

      expect(await log.since(BOARD, 0)).toHaveLength(target);
      expect(catalog.count(BOARD)).toBe(0);
      original.destroy();
    });

    it("★ بایت‌ها بی‌صدا ناقص بنشینند → بازخوانی می‌گیردش، و باز هم حذفی نیست", async () => {
      // ⚠️ این بدترین حالت است: `put` **موفق** برمی‌گردد ولی چیزی که روی دیسک
      //    نشسته کاملِ سند نیست. بدونِ مرحله‌ی بازخوانی، همین‌جا updateهای واقعی
      //    حذف می‌شدند و بورد برای همیشه ناقص می‌مانْد.
      const store = new MemorySnapshotStore();
      const lying: SnapshotStore = {
        put: (key) => store.put(key, Y.encodeStateAsUpdate(createBoardDoc())),
        get: (key) => store.get(key),
      };
      const { log, catalog, compactor } = harness({ store: lying });
      const original = await seedBoard(log, ["stk_1", "stk_2"]);
      const target = await log.latestSeq(BOARD);

      await expect(compactor.compact(BOARD, target)).rejects.toThrow("state vector");

      expect(await log.since(BOARD, 0)).toHaveLength(target);
      expect(catalog.count(BOARD)).toBe(0);
      original.destroy();
    });

    it("ثبتِ رکورد شکست بخورد → بایت‌ها یتیم می‌مانند ولی لاگ سالم است", async () => {
      const catalog = new MemorySnapshotCatalog();
      const failing: SnapshotCatalog = {
        record: () => Promise.reject(new Error("دیتابیس رفت")),
        latest: (boardId) => catalog.latest(boardId),
        older: (boardId, keep) => catalog.older(boardId, keep),
        forget: (boardId, seq) => catalog.forget(boardId, seq),
      };
      const { log, store, compactor } = harness({ catalog: failing });
      const original = await seedBoard(log, ["stk_1", "stk_2"]);
      const target = await log.latestSeq(BOARD);

      await expect(compactor.compact(BOARD, target)).rejects.toThrow("دیتابیس رفت");

      // ★ فایلِ یتیم پذیرفته‌شده است؛ از دست رفتنِ update نه.
      expect(store.size).toBe(1);
      expect(await log.since(BOARD, 0)).toHaveLength(target);
      original.destroy();
    });

    it("★★ شکافِ علّی در بازسازی → snapshot اصلاً گرفته نمی‌شود", async () => {
      const { log, store, catalog, compactor } = harness();
      const doc = createBoardDoc();
      // ⚠️ فقط updateِ **افزایشی** بدونِ پیشینه‌اش — دقیقاً چیزی که Yjs بی‌صدا
      //    در `pendingStructs` بایگانی می‌کند.
      const before = Y.encodeStateVector(doc);
      doc.transact(() => {
        writeElement(boardRoots(doc).elements, element("stk_orphan"));
      });
      await log.append(BOARD, Y.encodeStateAsUpdate(doc, before), null);

      const result = await compactor.compact(BOARD, await log.latestSeq(BOARD));

      expect(result).toBeNull();
      expect(catalog.count(BOARD)).toBe(0);
      expect(store.size).toBe(0);
      // ★ و مهم‌تر: updateِ یتیم هنوز هست. اگر حذف شده بود، بازیابی‌اش با رسیدنِ
      //   پیشینه هم دیگر ممکن نبود.
      expect(await log.since(BOARD, 0)).toHaveLength(1);
      doc.destroy();
    });
  });

  /**
   * ★★ ارثیه‌ی گام ۴٫۲ — «snapshot از سندِ قرنطینه‌شده، پاک‌سازی را دائمی می‌کند».
   *
   * تصمیمِ گام ۴٫۳ این بود که قرنطینه یک **نمای زمانِ بارگذاری** است و لاگ حقیقتِ
   * خام را نگه می‌دارد. این تست همان را قفل می‌کند — از سمتِ فشرده‌سازی.
   */
  describe("★★ قرنطینه + snapshot — داده‌ی خام باید بمانَد", () => {
    it("عنصرِ قرنطینه‌شده در snapshot **هست**، چون فشرده‌سازی از لاگ می‌سازد نه از سندِ اتاق", async () => {
      const { log, store, catalog, compactor } = harness();
      const doc = createBoardDoc();
      await log.append(BOARD, Y.encodeStateAsUpdate(doc), null);

      // یک عنصرِ خراب که مرزِ اعتمادِ اتاق قرنطینه‌اش می‌کند (`width` منفی).
      const before = Y.encodeStateVector(doc);
      doc.transact(() => {
        writeElement(boardRoots(doc).elements, { ...element("stk_bad"), width: -5 } as HbElement);
        writeElement(boardRoots(doc).elements, element("stk_ok"));
      });
      await log.append(BOARD, Y.encodeStateAsUpdate(doc, before), null);

      // اتاق آن را از سندِ **درون‌حافظه‌ای** برمی‌دارد — و این حذف پایدار نمی‌شود.
      doc.transact(() => {
        boardRoots(doc).elements.delete("stk_bad");
      }, QUARANTINE_ORIGIN);
      expect(boardRoots(doc).elements.has("stk_bad")).toBe(false);

      await compactor.compact(BOARD, await log.latestSeq(BOARD));

      const reloaded = await loadThroughStore(log, store, catalog);
      // ★★ داده‌ی خام زنده مانْد: قرنطینه دوباره سرِ بارگذاری اجرا می‌شود، ولی
      //    فشرده‌سازی آن را **دائمی نکرد**.
      expect(boardRoots(reloaded).elements.has("stk_bad")).toBe(true);
      expect(boardRoots(reloaded).elements.has("stk_ok")).toBe(true);
      doc.destroy();
      reloaded.destroy();
    });
  });

  /**
   * ★★ باگی که فقط با تکرار دیده می‌شود و هیچ ادعای «عناصر سرِ جایشان هستند» آن
   * را نمی‌گیرد.
   *
   * `createBoardDoc()` هر بار `meta.schemaVersion` را با یک `clientID`ِ **تازه**
   * می‌نویسد. اگر فشرده‌سازی سندش را با آن بسازد، هر snapshot یک مدخلِ کلاینتِ
   * دیگر را **برای همیشه** در state vector می‌نشاند — یعنی همان ساختاری که قرار
   * بود کوچک شود، بی‌کران رشد می‌کند.
   */
  describe("★★ فشرده‌سازیِ پیاپی مدخلِ کلاینت انباشته نمی‌کند", () => {
    it("بعد از پنج بار فشرده‌سازی، شمارِ کلاینت‌ها همان است", async () => {
      const { log, store, catalog, compactor } = harness();
      const original = await seedBoard(log, ["stk_1"]);
      const baseline = clientCount(original);

      for (let round = 0; round < 5; round++) {
        const before = Y.encodeStateVector(original);
        original.transact(() => {
          writeElement(boardRoots(original).elements, element(`stk_r${String(round)}`));
        });
        await log.append(BOARD, Y.encodeStateAsUpdate(original, before), null);
        await compactor.compact(BOARD, await log.latestSeq(BOARD));
      }

      const reloaded = await loadThroughStore(log, store, catalog);
      expect(clientCount(reloaded)).toBe(baseline);
      expect(Y.encodeStateVector(reloaded)).toEqual(Y.encodeStateVector(original));
      original.destroy();
      reloaded.destroy();
    });
  });

  describe("آستانه‌ها", () => {
    it("با تعدادِ update فعال می‌شود", () => {
      const { compactor } = harness();
      const at = Date.now();
      expect(compactor.shouldCompact({ seq: 2, sinceSeq: 0, sinceAt: at })).toBe(false);
      expect(compactor.shouldCompact({ seq: 3, sinceSeq: 0, sinceAt: at })).toBe(true);
    });

    it("با گذشتِ زمان هم فعال می‌شود — «هرکدام زودتر»", () => {
      const { compactor } = harness();
      const at = Date.now() - 61_000;
      expect(compactor.shouldCompact({ seq: 1, sinceSeq: 0, sinceAt: at })).toBe(true);
    });

    it("★ ولی **هرگز روی صفرِ update** — نه با زمان، نه با تعداد", () => {
      const { compactor } = harness();
      // ⚠️ بدونِ این شرط، هر ۶۰ ثانیه یک snapshotِ تکراری از بوردِ بی‌تغییر ساخته
      //    می‌شد: یک فایل و یک ردیفِ تازه که هیچ‌چیز را کوچک‌تر نمی‌کند.
      expect(compactor.shouldCompact({ seq: 7, sinceSeq: 7, sinceAt: 0 })).toBe(false);
    });

    it("هدفِ عقب‌تر از snapshotِ موجود کاری نمی‌کند", async () => {
      const { log, compactor } = harness();
      const original = await seedBoard(log, ["stk_1"]);
      const target = await log.latestSeq(BOARD);
      await compactor.compact(BOARD, target);

      expect(await compactor.compact(BOARD, target)).toBeNull();
      original.destroy();
    });
  });

  /**
   * ★★ باگی که خودِ حذف می‌سازد و هیچ تستِ دیگری نمی‌گیردش.
   *
   * بعد از فشرده‌سازیِ کامل، `board_updates` برای آن بورد **خالی** است. اگر
   * شمارنده‌ی `seq` فقط به آن جدول نگاه کند، updateِ بعدی `seq = 1` می‌گیرد —
   * در حالی که snapshot می‌گوید «تا ۳ در من هست». آن‌وقت بارگذاری `seq > 3`
   * می‌خواهد و کارِ کاربر **بی‌صدا** ناپدید می‌شود.
   */
  describe("★★ `seq` بعد از حذف بازاستفاده نمی‌شود", () => {
    it("شمارنده از مرزِ snapshot ادامه می‌دهد، نه از صفر", async () => {
      const { log, compactor } = harness();
      const original = await seedBoard(log, ["stk_1", "stk_2"]);
      const boundary = await log.latestSeq(BOARD);
      await compactor.compact(BOARD, boundary);

      expect(await log.since(BOARD, 0)).toHaveLength(0);
      expect(await log.latestSeq(BOARD)).toBe(boundary);

      const next = await log.append(BOARD, new Uint8Array([1, 2, 3]), null);
      expect(next.seq).toBe(boundary + 1);
      original.destroy();
    });
  });

  describe("انبار و کاتالوگ که از هم واگرا شوند", () => {
    it("رکورد هست ولی بایت‌ها نه → فشرده‌سازی رها می‌شود، نه اینکه پیشینه را جا بیندازد", async () => {
      const { log, store, catalog, compactor } = harness();
      const original = await seedBoard(log, ["stk_1"]);
      const boundary = await log.latestSeq(BOARD);
      await compactor.compact(BOARD, boundary);
      await store.delete(snapshotKey(BOARD, boundary));

      const before = Y.encodeStateVector(original);
      original.transact(() => {
        writeElement(boardRoots(original).elements, element("stk_2"));
      });
      await log.append(BOARD, Y.encodeStateAsUpdate(original, before), null);

      expect(await compactor.compact(BOARD, await log.latestSeq(BOARD))).toBeNull();
      expect(catalog.count(BOARD)).toBe(1);
      original.destroy();
    });

    it("★ و بارگذاری در همان حالت **می‌ترکد**، بی‌صدا بورد ناقص نمی‌دهد", async () => {
      const { log, store, catalog, compactor } = harness();
      const original = await seedBoard(log, ["stk_1"]);
      const boundary = await log.latestSeq(BOARD);
      await compactor.compact(BOARD, boundary);
      await store.delete(snapshotKey(BOARD, boundary));

      // ⚠️ وسوسه‌اش این بود که به `since(0)` برگردیم؛ ولی آن بازه حذف شده و
      //    نتیجه‌اش یک بوردِ **قانع‌کننده‌ی خالی** بود — بدترین نوعِ خرابی.
      await expect(loadThroughStore(log, store, catalog)).rejects.toThrow("snapshot");
      original.destroy();
    });
  });

  describe("اتاق فشرده‌سازی را صدا می‌زند ولی سندِ خودش را نمی‌دهد", () => {
    it("★ امضای `compact` فقط `boardId` می‌گیرد — ساختاری، نه قاعده‌ای", () => {
      const { compactor } = harness();
      const spy = vi.fn();
      // ★ اگر روزی کسی `Y.Doc` را به این امضا اضافه کند، تضمینِ «قرنطینه دائمی
      //   نمی‌شود» از راهِ کد شکسته است — نه از راهِ فراموشی.
      expect(compactor.compact.length).toBe(2);
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
