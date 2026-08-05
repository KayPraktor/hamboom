import { hbAppState } from "@hamboom/shared-types";
import * as Y from "yjs";
import { describe, expect, it } from "vitest";

import {
  boardRoots,
  createBoardDoc,
  DEFAULT_APP_STATE,
  DOC_INIT_ORIGIN,
  DOC_ROOTS,
  getSchemaVersion,
  META_KEYS,
  readDocument,
  SCHEMA_VERSION,
} from "./doc.ts";
import { writeElement } from "./element-codec.ts";
import { ELEMENT_FIXTURES, stickyFixture } from "./test-fixtures.ts";

describe("ساختِ سند", () => {
  it("پنج ریشه‌ی PLAN بخش ۷٫۱ ساخته می‌شوند", () => {
    const doc = createBoardDoc();
    const roots = boardRoots(doc);
    expect(Object.keys(roots).sort()).toEqual([...Object.values(DOC_ROOTS)].sort());
    for (const root of Object.values(roots)) expect(root).toBeInstanceOf(Y.Map);
  });

  it("`meta.schemaVersion` نوشته می‌شود", () => {
    const doc = createBoardDoc();
    expect(boardRoots(doc).meta.get(META_KEYS.schemaVersion)).toBe(SCHEMA_VERSION);
    expect(getSchemaVersion(doc)).toBe(SCHEMA_VERSION);
  });

  it("سندِ بدونِ نسخه `undefined` می‌دهد، نه یک پیش‌فرضِ پنهان", () => {
    // گام ۲٫۳ تصمیم می‌گیرد با سندِ بی‌نسخه چه کند. اگر اینجا پیش‌فرض جا
    // می‌افتاد، آن تصمیم بی‌صدا گرفته شده بود.
    expect(getSchemaVersion(new Y.Doc())).toBeUndefined();
  });

  it("★ originِ ساختِ سند `null` نیست", () => {
    // پیش‌فرضِ `Y.UndoManager` فقط originِ `null` را ردیابی می‌کند (گام ۱٫۴).
    // اگر مقداردهیِ اولیه با `null` بود، اولین `Ctrl+Z` می‌توانست خودِ ساختارِ
    // سند را برگرداند.
    const origins: unknown[] = [];
    const doc = new Y.Doc();
    doc.on("update", (_update: Uint8Array, origin: unknown) => origins.push(origin));
    doc.transact(() => {
      boardRoots(doc).meta.set(META_KEYS.schemaVersion, SCHEMA_VERSION);
    }, DOC_INIT_ORIGIN);

    expect(origins).toEqual([DOC_INIT_ORIGIN]);
    expect(origins).not.toContain(null);
  });

  it("`boardRoots` روی یک سند دو بار صدا زده شود، همان ریشه‌ها را می‌دهد", () => {
    const doc = createBoardDoc();
    expect(boardRoots(doc).elements).toBe(boardRoots(doc).elements);
  });
});

describe("readDocument", () => {
  it("همه‌ی عناصر را برمی‌گرداند و هر کدام قراردادی‌اند", () => {
    const doc = createBoardDoc();
    for (const { element } of ELEMENT_FIXTURES) writeElement(boardRoots(doc).elements, element);

    const document = readDocument(doc);
    expect(document.elements).toHaveLength(ELEMENT_FIXTURES.length);
    expect(new Set(document.elements.map((el) => el.id))).toEqual(
      new Set(ELEMENT_FIXTURES.map((f) => f.element.id)),
    );
  });

  it("★ با `index` مرتب می‌شود، نه با ترتیبِ درج", () => {
    const doc = createBoardDoc();
    const elements = boardRoots(doc).elements;

    // عمداً برعکس: اگر مرتب‌سازی نبود، z-orderِ بورد در هر بار بازکردن به
    // ترتیبِ پیمایشِ `Y.Map` گره می‌خورد — که بعد از ادغامِ چند کلاینت معنایی ندارد.
    for (const index of ["a5", "a1", "a3", "a2"]) {
      const element = stickyFixture();
      element.id = `stk_${index}`;
      element.index = index;
      writeElement(elements, element);
    }

    expect(readDocument(doc).elements.map((el) => el.index)).toEqual(["a1", "a2", "a3", "a5"]);
  });

  it("`index`ِ برابر با `id` قطعی می‌شود", () => {
    const doc = createBoardDoc();
    const elements = boardRoots(doc).elements;
    for (const id of ["stk_z", "stk_a", "stk_m"]) {
      const element = stickyFixture();
      element.id = id;
      element.index = "a1";
      writeElement(elements, element);
    }
    expect(readDocument(doc).elements.map((el) => el.id)).toEqual(["stk_a", "stk_m", "stk_z"]);
  });

  it("★ عناصرِ حذفِ نرم‌شده هم می‌آیند", () => {
    // حذفشان یعنی undoِ حذفِ همتا چیزی برای برگرداندن ندارد — همان کاری که
    // `LocalSyncHub.snapshot()`ِ M1 می‌کند.
    const doc = createBoardDoc();
    const removed = stickyFixture();
    removed.isDeleted = true;
    writeElement(boardRoots(doc).elements, removed);

    const document = readDocument(doc);
    expect(document.elements).toHaveLength(1);
    expect(document.elements[0]!.isDeleted).toBe(true);
  });

  it("مقدارِ غیرِ `Y.Map` در ریشه‌ی elements نادیده گرفته می‌شود", () => {
    const doc = createBoardDoc();
    writeElement(boardRoots(doc).elements, stickyFixture());
    // شبیه‌سازیِ داده‌ی خرابِ یک کلاینتِ بدرفتار یا نسخه‌ی قدیمی.
    (boardRoots(doc).elements as unknown as Y.Map<unknown>).set("junk", "not-an-element");

    expect(readDocument(doc).elements.map((el) => el.id)).toEqual(["stk_1"]);
  });

  it("سندِ خالی، `appState`ِ پیش‌فرضِ معتبر می‌دهد", () => {
    const document = readDocument(createBoardDoc());
    expect(document.elements).toEqual([]);
    expect(document.assets).toEqual([]);
    expect(() => hbAppState.parse(document.appState)).not.toThrow();
    expect(document.appState).toEqual(DEFAULT_APP_STATE);
  });

  it("مقدارِ نوشته‌شده روی پیش‌فرض می‌نشیند", () => {
    const doc = createBoardDoc();
    boardRoots(doc).appState.set("gridEnabled", true);

    const { appState } = readDocument(doc);
    expect(appState.gridEnabled).toBe(true);
    // بقیه هنوز پیش‌فرض‌اند — نه `undefined`.
    expect(appState.viewBackgroundColor).toBe(DEFAULT_APP_STATE.viewBackgroundColor);
    expect(() => hbAppState.parse(appState)).not.toThrow();
  });

  it("متادیتای دارایی از سند بیرون می‌آید (codecِ کاملش کارِ گام ۲٫۲ است)", () => {
    const doc = createBoardDoc();
    boardRoots(doc).assets.set("f_1", {
      fileId: "f_1",
      bucket: "hamboom",
      key: "t/b/f_1.png",
      mime: "image/png",
      width: 320,
      height: 200,
      sizeBytes: 1024,
      sha256: null,
      uploadedBy: "u_fixture",
      createdAt: 1_700_000_000_000,
    });

    expect(readDocument(doc).assets.map((asset) => asset.fileId)).toEqual(["f_1"]);
  });
});
