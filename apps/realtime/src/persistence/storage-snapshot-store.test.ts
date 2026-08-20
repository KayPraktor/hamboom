import type { HbElement } from "@hamboom/shared-types";
import { createMemoryObjectStore, type ObjectStore } from "@hamboom/storage";
import { boardRoots, createBoardDoc, writeElement } from "@hamboom/ydoc-schema";
import * as Y from "yjs";
import { describe, expect, it } from "vitest";

import { createLogger } from "../log.ts";
import { createCompactor } from "./compactor.ts";
import { MemorySnapshotCatalog } from "./snapshot-catalog.ts";
import { snapshotKey } from "./snapshot-store.ts";
import { createStorageSnapshotStore } from "./storage-snapshot-store.ts";
import { MemoryUpdateLog } from "./update-log.ts";

/**
 * تست‌های `StorageSnapshotStore` (M3 گام ۳٫۲).
 *
 * دو بخش:
 *   ۱. **conformance** روی `MemoryObjectStore` — پورت را درست پیاده می‌کند؟
 *   ۲. ★★ **put ناقص → prune نمی‌شود** — با یک `ObjectStore`ِ **دروغین** (put موفق ولی
 *      بایتِ اشتباه می‌نشیند) از راهِ compactorِ واقعی: بازخوانیِ مرحله‌ی ۴ باید بگیردش.
 *
 * ⚠️ رفت‌وبرگشتِ **واقعیِ S3** در `pnpm storage:smoke` است و اتصالِ end-to-end در فاز ۷
 * (اجرای دوباره‌ی `rt:compaction` با storageِ واقعی). اینجا فقط منطقِ آداپتور و ترکیبش با compactor.
 */

describe("StorageSnapshotStore — conformance روی MemoryObjectStore", () => {
  it("put → get بیت‌به‌بیت", async () => {
    const store = createStorageSnapshotStore(createMemoryObjectStore());
    const bytes = new Uint8Array([1, 2, 3, 250, 0, 7]);
    await store.put(snapshotKey("brd_1", 42), bytes);
    expect(await store.get(snapshotKey("brd_1", 42))).toEqual(bytes);
  });

  it("کلیدِ ناموجود `null` است، نه خطا", async () => {
    const store = createStorageSnapshotStore(createMemoryObjectStore());
    expect(await store.get(snapshotKey("brd_x", 1))).toBeNull();
  });

  it("delete idempotent است", async () => {
    const store = createStorageSnapshotStore(createMemoryObjectStore());
    const key = snapshotKey("brd_2", 1);
    await store.put(key, new Uint8Array([1]));
    await store.delete?.(key);
    await store.delete?.(key);
    expect(await store.get(key)).toBeNull();
  });

  it("★ بایت‌ها را با نوعِ `application/octet-stream` می‌نویسد", async () => {
    const object = createMemoryObjectStore();
    const store = createStorageSnapshotStore(object);
    await store.put(snapshotKey("brd_3", 5), new Uint8Array([9]));
    expect((await object.headObject(snapshotKey("brd_3", 5)))?.contentType).toBe(
      "application/octet-stream",
    );
  });
});

/**
 * ★★ معیارِ پذیرشِ صریحِ گام ۳٫۲: «put ناقصِ شبیه‌سازی‌شده باعثِ prune نمی‌شود».
 *
 * compaction.test.ts همین را برای یک store**ِ عمومیِ** دروغین قفل کرده؛ اینجا با
 * `StorageSnapshotStore` روی یک **`ObjectStore`ِ دروغین** ثابت می‌شود که آداپتور، دروغِ
 * لایه‌ی زیرین را **بی‌کم‌وکاست** به بازخوانیِ compactor می‌رسانَد (نه اینکه کش/قایمش کند).
 */
describe("★★ StorageSnapshotStore + compactor — put ناقص، prune نمی‌شود", () => {
  const BOARD = "brd_lie";

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

  it("بایت‌های دروغین در انبار → بازخوانیِ compactor می‌گیردش، لاگ دست‌نخورده", async () => {
    // یک `ObjectStore` که `putObject`ش بایتِ **اشتباه** (یک سندِ خالیِ تازه) می‌نشاند،
    // ولی `getObject`ش همان اشتباه را صادقانه پس می‌دهد — بدترین حالتِ «put موفقِ ناقص».
    const backing = createMemoryObjectStore();
    const lying: ObjectStore = {
      ...backing,
      putObject: (key) => backing.putObject(key, Y.encodeStateAsUpdate(createBoardDoc())),
    };
    const store = createStorageSnapshotStore(lying);

    const log = new MemoryUpdateLog();
    const catalog = new MemorySnapshotCatalog();
    const compactor = createCompactor({
      log,
      store,
      catalog,
      thresholds: { everyUpdates: 3, everyMs: 60_000 },
      logger: createLogger({ level: "fatal" }),
    });

    // بوردِ زنده: یک update با کلِ سند، سپس یک ژستِ افزایشی — تا چیزی برای فشردن باشد.
    const doc = createBoardDoc();
    await log.append(BOARD, Y.encodeStateAsUpdate(doc), null);
    const before = Y.encodeStateVector(doc);
    doc.transact(() => {
      writeElement(boardRoots(doc).elements, element("stk_1"));
    });
    await log.append(BOARD, Y.encodeStateAsUpdate(doc, before), null);
    const target = await log.latestSeq(BOARD);

    // بازخوانیِ مرحله‌ی ۴ باید state vectorِ ناهمخوان را بگیرد و بترکد.
    await expect(compactor.compact(BOARD, target)).rejects.toThrow("state vector");

    // ★ و مهم‌تر: هیچ updateای حذف نشد و هیچ رکوردی ثبت نشد.
    expect(await log.since(BOARD, 0)).toHaveLength(target);
    expect(catalog.count(BOARD)).toBe(0);
    doc.destroy();
  });
});
