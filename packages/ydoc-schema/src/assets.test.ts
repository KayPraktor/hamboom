import { hbAsset, type HbAsset } from "@hamboom/shared-types";
import type * as Y from "yjs";
import { describe, expect, it } from "vitest";

import { readAssets, removeAsset, writeAsset } from "./assets.ts";
import { assertNoBinary } from "./binary-guard.ts";
import { boardRoots, createBoardDoc, readDocument } from "./doc.ts";
import { twoClients } from "./test-fixtures.ts";

function asset(overrides: Partial<HbAsset> = {}): HbAsset {
  return {
    fileId: "f_1",
    bucket: "hamboom",
    key: "t_1/b_1/f_1.png",
    mime: "image/png",
    width: 320,
    height: 200,
    sizeBytes: 10_240,
    sha256: null,
    uploadedBy: "u_fixture",
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("متادیتای دارایی", () => {
  it("round-trip می‌شود و `hbAsset` را پاس می‌کند", () => {
    const doc = createBoardDoc();
    writeAsset(boardRoots(doc).assets, asset());

    const [back] = readAssets(boardRoots(doc).assets);
    expect(() => hbAsset.parse(back)).not.toThrow();
    expect(back).toEqual(asset());
  });

  it("با `fileId` مرتب می‌شود تا ترتیب قطعی بماند", () => {
    const doc = createBoardDoc();
    for (const fileId of ["f_c", "f_a", "f_b"]) {
      writeAsset(boardRoots(doc).assets, asset({ fileId }));
    }
    expect(readAssets(boardRoots(doc).assets).map((a) => a.fileId)).toEqual(["f_a", "f_b", "f_c"]);
  });

  it("در `readDocument` هم دیده می‌شود", () => {
    const doc = createBoardDoc();
    writeAsset(boardRoots(doc).assets, asset());
    expect(readDocument(doc).assets.map((a) => a.fileId)).toEqual(["f_1"]);
  });

  it("حذفِ دارایی **سخت** است — برخلافِ عنصر", () => {
    // دارایی تاریخچه‌ی ویرایشِ کاربر نیست و undo رویش معنا ندارد.
    const doc = createBoardDoc();
    writeAsset(boardRoots(doc).assets, asset());
    removeAsset(boardRoots(doc).assets, "f_1");
    expect(readAssets(boardRoots(doc).assets)).toEqual([]);
  });

  it("نوشتنِ دارایی بدونِ تغییر = صفر update", () => {
    const doc = createBoardDoc();
    writeAsset(boardRoots(doc).assets, asset());

    let updates = 0;
    doc.on("update", () => updates++);
    writeAsset(boardRoots(doc).assets, asset());
    expect(updates).toBe(0);
  });

  it("داراییِ نامعتبر همان‌جا خطا می‌دهد، نه بعداً در سند", () => {
    const doc = createBoardDoc();
    // ★ برخلافِ `writeElement`، اینجا اعتبارسنجی می‌شود: دارایی یک بار هنگامِ
    //   آپلود نوشته می‌شود، نه ده‌ها بار در ثانیه.
    expect(() =>
      writeAsset(boardRoots(doc).assets, { ...asset(), width: -5 } as HbAsset),
    ).toThrow();
    expect(readAssets(boardRoots(doc).assets)).toEqual([]);
  });

  it("کلیدهای ناشناخته وارد سند نمی‌شوند", () => {
    const doc = createBoardDoc();
    writeAsset(boardRoots(doc).assets, { ...asset(), thumbnailUrl: "…" } as HbAsset);

    const map = boardRoots(doc).assets.get("f_1") as Y.Map<unknown>;
    expect(map.has("thumbnailUrl")).toBe(false);
  });

  it("دو کلاینت، دو فیلدِ مختلفِ یک دارایی → هر دو می‌مانند", () => {
    const { a, b, rootsOf, sync } = twoClients();
    writeAsset(rootsOf(a).assets, asset({ sha256: null }));
    sync();

    writeAsset(rootsOf(a).assets, asset({ sha256: "a".repeat(64) }));
    writeAsset(rootsOf(b).assets, asset({ sizeBytes: 20_480 }));
    sync();

    for (const doc of [a, b]) {
      const [merged] = readAssets(rootsOf(doc).assets);
      expect(merged!.sha256).toBe("a".repeat(64));
      expect(merged!.sizeBytes).toBe(20_480);
    }
  });
});

/**
 * ★★ خط قرمزِ [PLAN بخش ۷٫۱](../../../PLAN.md): **باینری هرگز داخل `Y.Doc` نمی‌رود.**
 *
 * Yjs `Uint8Array` را می‌پذیرد، یعنی این قاعده هیچ سدِ طبیعی ندارد. اولین باری که
 * کسی برای «راحتی» یک thumbnail را داخل دارایی بگذارد، **کار می‌کند** — و از آن
 * لحظه آن چند مگابایت با هر sync بینِ همه رد و بدل می‌شود و در هر ردیفِ
 * `board_updates` می‌نشیند.
 */
describe("★★ نگهبانِ باینری روی مسیرِ نوشتن", () => {
  it("`writeAsset` باینری را رد می‌کند و اسمِ فیلد را می‌گوید", () => {
    const doc = createBoardDoc();
    const poisoned = { ...asset(), blob: new Uint8Array([1, 2, 3]) } as unknown as HbAsset;

    expect(() => writeAsset(boardRoots(doc).assets, poisoned)).toThrow(/blob/);
    // و هیچ‌چیز ننوشته: خطا **قبل از** لمسِ سند رخ می‌دهد.
    expect(readAssets(boardRoots(doc).assets)).toEqual([]);
  });

  it("چرا فقط به `parse` تکیه نمی‌کنیم", () => {
    // zod کلیدِ ناشناخته را **بی‌صدا** دور می‌ریزد. یعنی بدونِ بررسیِ صریح،
    // فرستادنِ باینری «موفق» می‌شد و صداکننده هرگز نمی‌فهمید جای اشتباهی
    // می‌فرستد. سکوت چیزی است که این پروژه به آن اعتماد نمی‌کند.
    const stripped = hbAsset.parse({ ...asset(), blob: new Uint8Array([1, 2, 3]) });
    expect(Object.hasOwn(stripped, "blob")).toBe(false);
  });

  it("سندِ سالم پاک است — نگهبان مثبتِ کاذب نمی‌دهد", () => {
    const doc = createBoardDoc();
    writeAsset(boardRoots(doc).assets, asset());
    expect(() => assertNoBinary(doc)).not.toThrow();
  });
});
