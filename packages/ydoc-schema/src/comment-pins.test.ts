import type * as Y from "yjs";
import { describe, expect, it } from "vitest";

import { readCommentPins, removeCommentPin, writeCommentPin } from "./comment-pins.ts";
import { boardRoots, createBoardDoc, readDocument } from "./doc.ts";
import { twoClients } from "./test-fixtures.ts";

describe("سنجاقِ کامنت", () => {
  it("round-trip می‌شود و `threadId` را همراه دارد", () => {
    const doc = createBoardDoc();
    writeCommentPin(boardRoots(doc).commentPins, "th_1", {
      x: 120,
      y: 40,
      elementId: "stk_1",
      resolved: false,
    });

    expect(readCommentPins(boardRoots(doc).commentPins)).toEqual([
      { threadId: "th_1", x: 120, y: 40, elementId: "stk_1", resolved: false },
    ]);
  });

  it("سنجاقِ آزاد `elementId` ندارد — کلید هم نمی‌گیرد", () => {
    const doc = createBoardDoc();
    writeCommentPin(boardRoots(doc).commentPins, "th_1", { x: 10, y: 20, resolved: false });

    const map = boardRoots(doc).commentPins.get("th_1") as Y.Map<unknown>;
    expect(map.has("elementId")).toBe(false);
  });

  it("جداشدن از عنصر، کلیدِ قبلی را برمی‌دارد", () => {
    // `pin` کامل است نه patch، پس نبودنِ `elementId` واقعاً یعنی «دیگر نچسبیده».
    const doc = createBoardDoc();
    const pins = boardRoots(doc).commentPins;
    writeCommentPin(pins, "th_1", { x: 10, y: 20, elementId: "stk_1", resolved: false });
    writeCommentPin(pins, "th_1", { x: 10, y: 20, resolved: false });

    expect((pins.get("th_1") as Y.Map<unknown>).has("elementId")).toBe(false);
    expect(readCommentPins(pins)[0]?.elementId).toBeUndefined();
  });

  it("با `threadId` مرتب می‌شود", () => {
    const doc = createBoardDoc();
    for (const threadId of ["th_c", "th_a", "th_b"]) {
      writeCommentPin(boardRoots(doc).commentPins, threadId, { x: 0, y: 0, resolved: false });
    }
    expect(readCommentPins(boardRoots(doc).commentPins).map((p) => p.threadId)).toEqual([
      "th_a",
      "th_b",
      "th_c",
    ]);
  });

  it("حذفِ سنجاق **سخت** است", () => {
    // برآمدگیِ نخِ کامنت است، نه تاریخچه‌ی ویرایشِ کاربر. حذفِ خودِ نخ در
    // Postgres انجام می‌شود (کارِ M3) و این فقط دنبالش می‌آید.
    const doc = createBoardDoc();
    writeCommentPin(boardRoots(doc).commentPins, "th_1", { x: 0, y: 0, resolved: false });
    removeCommentPin(boardRoots(doc).commentPins, "th_1");
    expect(readCommentPins(boardRoots(doc).commentPins)).toEqual([]);
  });

  it("نوشتنِ بدونِ تغییر = صفر update", () => {
    const doc = createBoardDoc();
    writeCommentPin(boardRoots(doc).commentPins, "th_1", { x: 10, y: 20, resolved: false });

    let updates = 0;
    doc.on("update", () => updates++);
    writeCommentPin(boardRoots(doc).commentPins, "th_1", { x: 10, y: 20, resolved: false });
    expect(updates).toBe(0);
  });

  it("★ یکی سنجاق را جابه‌جا می‌کند، دیگری همزمان حلش می‌کند → هر دو می‌مانند", () => {
    // دقیقاً همان الگوی ADR-007، یک ریشه آن‌طرف‌تر: اگر سنجاق یک آبجکتِ ساده
    // بود، جابه‌جایی و حل‌کردن همدیگر را می‌خوردند.
    const { a, b, rootsOf, sync } = twoClients();
    writeCommentPin(rootsOf(a).commentPins, "th_1", { x: 10, y: 20, resolved: false });
    sync();

    writeCommentPin(rootsOf(a).commentPins, "th_1", { x: 300, y: 200, resolved: false });
    writeCommentPin(rootsOf(b).commentPins, "th_1", { x: 10, y: 20, resolved: true });
    sync();

    for (const doc of [a, b]) {
      const [pin] = readCommentPins(rootsOf(doc).commentPins);
      expect(pin!.x).toBe(300);
      expect(pin!.resolved).toBe(true);
    }
  });

  it("سنجاق‌ها در `readDocument` نیستند — قراردادِ M1 آن‌ها را ندارد", () => {
    const doc = createBoardDoc();
    writeCommentPin(boardRoots(doc).commentPins, "th_1", { x: 0, y: 0, resolved: false });

    const document = readDocument(doc);
    expect(Object.keys(document).sort()).toEqual(["appState", "assets", "elements"]);
  });
});
