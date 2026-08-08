import type { HbElement } from "@hamboom/shared-types";
import { boardRoots, createBoardDoc, readDocument, writeElement } from "@hamboom/ydoc-schema";
import * as Y from "yjs";
import { describe, expect, it, vi } from "vitest";

import { createLogger } from "./log.ts";
import { createRoomManager, type RoomLimits } from "./room.ts";
import type { RtSession } from "./server.ts";
import { MemoryBoardStore } from "./store/board-store.ts";

/**
 * تست‌های گام ۴٫۲ — **چرخه‌ی عمرِ اتاق و مرزِ اعتماد**.
 *
 * ★ اینجا از سوکتِ واقعی استفاده نمی‌شود (آن کارِ `server.test.ts` است): ادعای
 * این فایل درباره‌ی **سند** است، نه درباره‌ی سیم.
 */

const BOARD = "brd_1";

/** ریشه‌ی `elements` همان‌طور که `boardRoots` تایپش می‌کند. */
type BoardElements = ReturnType<typeof boardRoots>["elements"];

const LIMITS: RoomLimits = {
  maxRoomsPerNode: 10,
  maxDocBytes: 5_000_000,
  idleTimeoutMs: 120_000,
};

/** یک سوکتِ ساختگی که فقط `once` را می‌فهمد — همان چیزی که اتاق لازم دارد. */
function fakeSocket() {
  const handlers = new Map<string, () => void>();
  return {
    socket: { once: (event: string, cb: () => void) => handlers.set(event, cb) },
    /** شبیه‌سازیِ بسته‌شدنِ اتصال. */
    close: () => handlers.get("close")?.(),
  };
}

function session(sub = "usr_1", boardId = BOARD): { session: RtSession; close: () => void } {
  const fake = fakeSocket();
  return {
    session: {
      socket: fake.socket as unknown as RtSession["socket"],
      boardId,
      sub,
      role: "editor",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    close: fake.close,
  };
}

function element(id: string, overrides: Partial<HbElement> = {}): HbElement {
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
    ...overrides,
  } as HbElement;
}

/** یک بوردِ ذخیره‌شده با چند عنصرِ سالم. */
function seededStore(ids: string[] = ["stk_1", "stk_2"]): MemoryBoardStore {
  const doc = createBoardDoc();
  doc.transact(() => {
    for (const id of ids) writeElement(boardRoots(doc).elements, element(id));
  });
  const store = new MemoryBoardStore();
  store.seed(BOARD, { snapshot: Y.encodeStateAsUpdate(doc) });
  return store;
}

function manager(store: MemoryBoardStore, limits: Partial<RoomLimits> = {}) {
  const lines: string[] = [];
  const rooms = createRoomManager({
    store,
    limits: { ...LIMITS, ...limits },
    logger: createLogger({ level: "debug", write: (line) => lines.push(line) }),
  });
  return { rooms, lines };
}

describe("بارگذاری", () => {
  it("snapshot و updateهای بعدش را روی هم می‌گذارد", async () => {
    // ⚠️ snapshot و updateها باید از **یک** سند بیایند و پشتِ سرِ هم باشند —
    //    همان چیزی که گام ۴٫۳ از `doc.on("update")`ِ خودِ اتاق می‌گیرد. نسخه‌ی
    //    اولِ این تست دو سندِ جدا ساخت و update در `pendingStructs` گیر کرد
    //    (شکافِ علّیِ گام ۳٫۱، این‌بار سمتِ پایداری). ادعای همان شکاف پایین جداست.
    const doc = createBoardDoc();
    doc.transact(() => writeElement(boardRoots(doc).elements, element("stk_1")));
    const snapshot = Y.encodeStateAsUpdate(doc);
    const at = Y.encodeStateVector(doc);
    doc.transact(() => writeElement(boardRoots(doc).elements, element("stk_2")));

    const store = new MemoryBoardStore();
    store.seed(BOARD, { snapshot, updates: [Y.encodeStateAsUpdate(doc, at)] });

    const { rooms } = manager(store);
    const room = await rooms.join(session().session);

    expect(readDocument(room.doc).elements.map((item) => item.id)).toEqual(["stk_1", "stk_2"]);
    expect(room.report.pendingStructs).toBe(false);
  });

  it("★★ شکافِ علّی در لاگِ update **بی‌صدا** نمی‌مانَد", async () => {
    // اگر لاگِ update با snapshot پشتِ سرِ هم نباشد، Yjs آن updateها را بایگانی
    // می‌کند و **هیچ خطایی نمی‌دهد** — بورد ناقص بالا می‌آید و کسی نمی‌فهمد.
    // مرزِ اعتماد همان‌قدر که به شکلِ عنصر اهمیت می‌دهد، به این هم باید بدهد.
    const source = createBoardDoc();
    source.transact(() => writeElement(boardRoots(source).elements, element("stk_first")));
    // ⚠️ update باید **افزایشی** باشد: یک `encodeStateAsUpdate`ِ کامل خودش
    //    علّیاً کامل است و هیچ شکافی نمی‌سازد.
    const at = Y.encodeStateVector(source);
    source.transact(() => writeElement(boardRoots(source).elements, element("stk_orphan")));
    const gapped = Y.encodeStateAsUpdate(source, at);

    const store = new MemoryBoardStore();
    // بدونِ snapshotی که opهای قبلیِ همان کلاینت را داشته باشد.
    store.seed(BOARD, { snapshot: null, updates: [gapped] });

    const { rooms, lines } = manager(store);
    const room = await rooms.join(session().session);

    expect(room.report.pendingStructs).toBe(true);
    expect(lines.join("\n")).toContain("شکافِ علّی");
    // ★ و شاهدِ اینکه واقعاً داده گم شده — نه اینکه فقط پرچمی روشن شده باشد.
    expect(readDocument(room.doc).elements).toEqual([]);
  });

  it("بوردِ نو با سندِ خالی بالا می‌آید", async () => {
    const { rooms } = manager(new MemoryBoardStore());
    const room = await rooms.join(session().session);

    expect(readDocument(room.doc).elements).toEqual([]);
    expect(room.report.migration.to).toBe(1);
  });

  it("★ دو نشستِ همزمان یک اتاق می‌گیرند، نه دو تا", async () => {
    // ⚠️ بدونِ قفلِ بارگذاری، دو `Y.Doc`ِ جدا ساخته می‌شد که هرگز به هم نمی‌رسیدند.
    const { rooms } = manager(seededStore());
    const [first, second] = await Promise.all([
      rooms.join(session("usr_1").session),
      rooms.join(session("usr_2").session),
    ]);

    expect(first).toBe(second);
    expect(rooms.size).toBe(1);
  });
});

describe("★★ مرزِ اعتماد — عنصرِ خراب کلِ بورد را خالی نمی‌کند", () => {
  /** یک سندِ ذخیره‌شده که کنارِ عناصرِ سالم، آشغال هم دارد. */
  function pollutedStore(pollute: (elements: BoardElements) => void): MemoryBoardStore {
    const doc = createBoardDoc();
    doc.transact(() => {
      writeElement(boardRoots(doc).elements, element("stk_ok_1"));
      writeElement(boardRoots(doc).elements, element("stk_ok_2"));
      pollute(boardRoots(doc).elements);
    });
    const store = new MemoryBoardStore();
    store.seed(BOARD, { snapshot: Y.encodeStateAsUpdate(doc) });
    return store;
  }

  const cases: { name: string; pollute: (elements: BoardElements) => void; bad: string }[] = [
    {
      name: "مقداری که اصلاً Y.Map نیست",
      // ⚠️ `as never` عمدی: تایپِ ریشه این را ممنوع می‌کند، ولی یک کلاینتِ
      //    باگ‌دار در واقعیت می‌تواند بنویسدش — و مرزِ اعتماد دقیقاً برای همین است.
      pollute: (elements) => elements.set("stk_bad", 42 as never),
      bad: "stk_bad",
    },
    {
      name: "شکلی که با hbElement نمی‌خواند",
      pollute: (elements) => {
        const broken = new Y.Map<unknown>();
        broken.set("id", "stk_bad");
        broken.set("type", "rectangle");
        // بدونِ x/y/width/… — نصفه.
        elements.set("stk_bad", broken);
      },
      bad: "stk_bad",
    },
    {
      name: "★ کلیدی که با element.id نمی‌خواند",
      pollute: (elements) => {
        const map = new Y.Map<unknown>();
        elements.set("stk_bad", map);
        // عنصرِ کاملاً معتبر، ولی زیرِ کلیدِ اشتباه.
        const source = element("stk_elsewhere");
        for (const [key, value] of Object.entries(source)) {
          map.set(key, key === "customData" ? new Y.Map(Object.entries(value as object)) : value);
        }
      },
      bad: "stk_bad",
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.name} → قرنطینه، و بقیه سالم می‌مانند`, async () => {
      const { rooms, lines } = manager(pollutedStore(testCase.pollute));
      const room = await rooms.join(session().session);

      // ★★ ادعای مرکزی: بورد **خالی نشد**.
      expect(readDocument(room.doc).elements.map((item) => item.id)).toEqual([
        "stk_ok_1",
        "stk_ok_2",
      ]);
      // ★ شمرده شد…
      expect(room.report.quarantined).toEqual([testCase.bad]);
      // ★ …و لاگ شد، نه بی‌صدا.
      expect(lines.join("\n")).toContain("قرنطینه");
    });
  }

  it("★ سندِ سالم هیچ‌چیز را قرنطینه نمی‌کند — نگهبان در جهتِ منفی", async () => {
    // ⚠️ بدونِ این، یک اعتبارسنجیِ بیش‌ازحد سخت‌گیر هم «سبز» به نظر می‌رسید:
    //    بورد را خالی می‌کرد و تست‌های بالا همچنان پاس می‌شدند.
    const { rooms } = manager(seededStore(["stk_1", "stk_2", "stk_3"]));
    const room = await rooms.join(session().session);

    expect(room.report.quarantined).toEqual([]);
    expect(readDocument(room.doc).elements).toHaveLength(3);
  });

  it("عنصرِ حذفِ نرم‌شده معتبر است و قرنطینه نمی‌شود", async () => {
    const doc = createBoardDoc();
    doc.transact(() =>
      writeElement(boardRoots(doc).elements, element("stk_1", { isDeleted: true })),
    );
    const store = new MemoryBoardStore();
    store.seed(BOARD, { snapshot: Y.encodeStateAsUpdate(doc) });

    const { rooms } = manager(store);
    const room = await rooms.join(session().session);

    expect(room.report.quarantined).toEqual([]);
  });
});

describe("★★ سقف‌ها — خطای صریح، نه crash", () => {
  it("سقفِ اتاقِ نود → `SERVER_BUSY`", async () => {
    const { rooms } = manager(seededStore(), { maxRoomsPerNode: 1 });
    await rooms.join(session("usr_1", "brd_a").session);

    await expect(rooms.join(session("usr_2", "brd_b").session)).rejects.toMatchObject({
      code: "SERVER_BUSY",
    });
    // ★ اتاقِ اول دست‌نخورده — رد شدنِ دومی چیزی را خراب نکرد.
    expect(rooms.size).toBe(1);
  });

  it("سندِ بزرگ‌تر از سقف → `DOC_TOO_LARGE` و اتاق ساخته نمی‌شود", async () => {
    const store = seededStore(Array.from({ length: 200 }, (_, i) => `stk_${i}`));
    const { rooms } = manager(store, { maxDocBytes: 1_000 });

    await expect(rooms.join(session().session)).rejects.toMatchObject({ code: "DOC_TOO_LARGE" });
    expect(rooms.size).toBe(0);
  });

  it("همان سند با سقفِ کافی بالا می‌آید", async () => {
    // ضدِ ادعا: وگرنه معلوم نبود سقف کار می‌کند یا سند اصلاً بارگذاری نمی‌شود.
    const store = seededStore(Array.from({ length: 200 }, (_, i) => `stk_${i}`));
    const { rooms } = manager(store, { maxDocBytes: 5_000_000 });

    const room = await rooms.join(session().session);
    expect(readDocument(room.doc).elements).toHaveLength(200);
  });
});

describe("★★ معیارِ پذیرش — سه کلاینت، تخلیه، و بازگشتِ کاملِ سند", () => {
  it("آخرین نفر که رفت اتاق تخلیه می‌شود و کلاینتِ بعدی همان سند را می‌گیرد", async () => {
    vi.useFakeTimers();
    try {
      const store = seededStore(["stk_1", "stk_2"]);
      const { rooms } = manager(store, { idleTimeoutMs: 1_000 });

      const clients = [session("usr_1"), session("usr_2"), session("usr_3")];
      for (const client of clients) await rooms.join(client.session);
      expect(rooms.size).toBe(1);

      // دو نفر می‌روند — اتاق باید بمانَد.
      clients[0]!.close();
      clients[1]!.close();
      vi.advanceTimersByTime(5_000);
      expect(rooms.has(BOARD)).toBe(true);

      // ★ نفرِ آخر که رفت، تازه ساعت شروع می‌شود…
      clients[2]!.close();
      expect(rooms.has(BOARD)).toBe(true);
      vi.advanceTimersByTime(999);
      expect(rooms.has(BOARD)).toBe(true);

      // …و بعد از timeout اتاق از حافظه می‌رود.
      vi.advanceTimersByTime(2);
      expect(rooms.has(BOARD)).toBe(false);
      expect(rooms.size).toBe(0);

      // ★★ و کلاینتِ تازه **همان سند** را کامل می‌گیرد.
      const room = await rooms.join(session("usr_4").session);
      expect(readDocument(room.doc).elements.map((item) => item.id)).toEqual(["stk_1", "stk_2"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("★ برگشتنِ کاربر قبل از timeout، تخلیه را لغو می‌کند", async () => {
    vi.useFakeTimers();
    try {
      const { rooms } = manager(seededStore(), { idleTimeoutMs: 1_000 });
      const first = session("usr_1");
      const room = await rooms.join(first.session);

      first.close();
      vi.advanceTimersByTime(500);
      // رفرشِ ساده‌ی صفحه — نباید بارگذاریِ کاملِ بورد را دوباره تحمیل کند.
      const again = await rooms.join(session("usr_1").session);
      expect(again).toBe(room);

      vi.advanceTimersByTime(5_000);
      expect(rooms.has(BOARD)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
