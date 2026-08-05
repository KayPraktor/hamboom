import * as Y from "yjs";
import { describe, expect, it } from "vitest";

import { writeAppState } from "./app-state.ts";
import { writeAsset } from "./assets.ts";
import {
  assertNoBinary,
  BinaryInDocumentError,
  findBinaryIn,
  findBinaryValues,
} from "./binary-guard.ts";
import { writeCommentPin } from "./comment-pins.ts";
import { boardRoots, createBoardDoc } from "./doc.ts";
import { writeElement } from "./element-codec.ts";
import { ELEMENT_FIXTURES, stickyFixture } from "./test-fixtures.ts";

/**
 * ★★ خودآزمونِ نگهبانِ باینری.
 *
 * «قاعده‌ای که خودش تست نشده، گیت نیست» — و یک نگهبان **در هر دو جهت** باید
 * آزموده شود: هم چیزی که باید بگیرد، هم چیزی که نباید. نگهبانی که همیشه خطا
 * می‌دهد به‌اندازه‌ی نگهبانی که هیچ‌وقت خطا نمی‌دهد بی‌فایده است — فقط سریع‌تر
 * دور زده می‌شود.
 */

/** یک سندِ **واقعیِ پر** — نه یک سندِ خالی که هر نگهبانی رویش سبز است. */
function fullDocument(): Y.Doc {
  const doc = createBoardDoc();
  const roots = boardRoots(doc);
  for (const { element } of ELEMENT_FIXTURES) writeElement(roots.elements, element);
  writeAsset(roots.assets, {
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
  });
  writeAppState(roots.appState, { gridEnabled: true });
  writeCommentPin(roots.commentPins, "th_1", { x: 10, y: 20, resolved: false });
  return doc;
}

describe("جهتِ منفی — سندِ سالم هیچ هشداری نمی‌گیرد", () => {
  it("سندِ پر از هر ۹ نوعِ عنصر + دارایی + appState + سنجاق پاک است", () => {
    expect(findBinaryValues(fullDocument())).toEqual([]);
  });

  it("`Y.Text` با باینری اشتباه گرفته نمی‌شود", () => {
    // `originalText` یک `Y.Text` است (ADR-034) و هر متنی داخلش می‌تواند باشد.
    const doc = createBoardDoc();
    const element = stickyFixture();
    writeElement(boardRoots(doc).elements, element);
    (boardRoots(doc).elements.get(element.id) as Y.Map<unknown>).set("originalText", new Y.Text());
    expect(findBinaryValues(doc)).toEqual([]);
  });
});

describe("جهتِ مثبت — هر مسیرِ ورودِ باینری گرفته می‌شود", () => {
  it("مقدارِ مستقیم روی یک ریشه", () => {
    const doc = createBoardDoc();
    boardRoots(doc).assets.set("f_1", new Uint8Array([1, 2, 3]));
    expect(findBinaryValues(doc)).toEqual(["assets.f_1"]);
  });

  it("★ تودرتو داخلِ `customData` یک عنصر — مسیرِ دقیق گزارش می‌شود", () => {
    // این همان مسیری است که در عمل رخ می‌دهد: کسی یک thumbnail را «موقتاً»
    // داخلِ عنصر می‌گذارد، نه داخلِ assets.
    const doc = createBoardDoc();
    const element = stickyFixture();
    writeElement(boardRoots(doc).elements, element);
    const customData = (boardRoots(doc).elements.get(element.id) as Y.Map<unknown>).get(
      "customData",
    ) as Y.Map<unknown>;
    (customData.get("hb") as Y.Map<unknown>).set("thumbnail", new Uint8Array([9]));

    expect(findBinaryValues(doc)).toEqual(["elements.stk_1.customData.hb.thumbnail"]);
  });

  it("داخلِ یک آبجکتِ ساده و داخلِ آرایه", () => {
    const doc = createBoardDoc();
    boardRoots(doc).meta.set("a", { nested: { blob: new Uint8Array([1]) } });
    boardRoots(doc).meta.set("b", [0, new Uint8Array([2])]);
    expect(findBinaryValues(doc).sort()).toEqual(["meta.a.nested.blob", "meta.b[1]"]);
  });

  it("داخلِ `Y.Array`", () => {
    const doc = createBoardDoc();
    const array = new Y.Array<unknown>();
    boardRoots(doc).meta.set("frames", array);
    array.push([new Uint8Array([7])]);
    expect(findBinaryValues(doc)).toEqual(["meta.frames[0]"]);
  });

  it("★ ریشه‌ی ناشناخته هم گشته می‌شود", () => {
    // از `doc.share` می‌رویم نه از `DOC_ROOTS`: کلاینتِ دیگری می‌تواند ریشه‌ای
    // بسازد که ما اسمش را نمی‌دانیم. بستنِ فقط درهای شناخته‌شده، در را نمی‌بندد.
    const doc = createBoardDoc();
    doc.getMap("somethingElse").set("blob", new Uint8Array([1]));
    expect(findBinaryValues(doc)).toEqual(["somethingElse.blob"]);
  });

  it("`assertNoBinary` خطای نام‌دار با فهرستِ مسیرها می‌دهد", () => {
    const doc = fullDocument();
    boardRoots(doc).meta.set("blob", new Uint8Array([1]));

    expect(() => assertNoBinary(doc)).toThrow(BinaryInDocumentError);
    try {
      assertNoBinary(doc);
      expect.unreachable("باید خطا می‌داد");
    } catch (error) {
      expect(error).toBeInstanceOf(BinaryInDocumentError);
      expect((error as BinaryInDocumentError).paths).toEqual(["meta.blob"]);
      // پیام باید بگوید **چه کار کند**، نه فقط اینکه چیزی غلط است.
      expect((error as BinaryInDocumentError).message).toContain("Object Storage");
    }
  });
});

/**
 * ★★ یافته‌ی سنجیده‌شده‌ی گام ۲٫۲ — **Yjs فقط `Uint8Array` را می‌پذیرد.**
 *
 * این را فرض نکردم؛ تستِ اولم افتاد و علتش این بود. اندازه‌گیری شد:
 *
 * | شکل | مستقیم روی `Y.Map` | تودرتو در یک آبجکتِ ساده |
 * |---|---|---|
 * | `Uint8Array` | پذیرفته — باینری می‌مانَد | پذیرفته — باینری می‌مانَد |
 * | `ArrayBuffer` · `Float64Array` · `DataView` · `Blob` | **خودِ Yjs رد می‌کند** | ⚠️ **پذیرفته و بی‌صدا `{}` می‌شود** |
 *
 * ستونِ دوم بدتر از «باینری در سند» است: داده **از بین می‌رود بدونِ هیچ خطایی**، و
 * اسکنرِ سند هم دیگر نمی‌تواند ببیندش چون تا آن موقع `{}` شده. یعنی برای این
 * شکل‌ها **تنها** نگهبانِ ممکن، بررسیِ **قبل از نوشتن** است — همان چیزی که
 * `writeAsset` از `findBinaryIn` می‌گیرد.
 */
describe("★★ بررسیِ قبل از نوشتن — تنها نگهبانِ شکل‌های «بی‌صدا»", () => {
  it("Yjs خودش `ArrayBuffer` را روی یک `Y.Map` رد می‌کند", () => {
    const doc = createBoardDoc();
    expect(() => boardRoots(doc).meta.set("raw", new ArrayBuffer(4))).toThrow();
  });

  it("⚠️ ولی همان `ArrayBuffer` تودرتو **بی‌صدا** در sync گم می‌شود", () => {
    const doc = createBoardDoc();
    boardRoots(doc).meta.set("wrapper", { raw: new ArrayBuffer(4) });

    // ★★ بدترین بخشش: **روی همین کلاینت سالم به نظر می‌رسد** — Yjs همان شیءِ
    //    درون‌حافظه‌ای را برمی‌گرداند و هیچ خطایی نمی‌دهد.
    expect(boardRoots(doc).meta.get("wrapper")).toEqual({ raw: new ArrayBuffer(4) });

    // ولی وقتی همان update به کلاینتِ دیگر می‌رسد، محتوا رفته است.
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    expect(peer.getMap("meta").get("wrapper")).toEqual({ raw: {} });

    // و اسکنرِ سند هم آن‌طرف چیزی نمی‌بیند، چون دیگر باینری نیست — پس تنها
    // فرصتِ گرفتنش **قبل از نوشتن** بود.
    expect(findBinaryValues(peer)).toEqual([]);
  });

  it("`findBinaryIn` هر چهار شکل را **قبل از** رسیدن به سند می‌گیرد", () => {
    expect(findBinaryIn({ a: new Uint8Array([1]) }, "asset")).toEqual(["asset.a"]);
    expect(findBinaryIn({ a: new ArrayBuffer(4) }, "asset")).toEqual(["asset.a"]);
    expect(findBinaryIn({ a: new Float64Array(2) }, "asset")).toEqual(["asset.a"]);
    expect(findBinaryIn({ a: new DataView(new ArrayBuffer(4)) }, "asset")).toEqual(["asset.a"]);
  });

  it("`findBinaryIn` روی مقدارِ سالم چیزی نمی‌گوید", () => {
    expect(findBinaryIn({ fileId: "f_1", scale: [1, 1], crop: null }, "asset")).toEqual([]);
  });
});
