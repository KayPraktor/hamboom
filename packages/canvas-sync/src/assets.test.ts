/**
 * @vitest-environment jsdom
 *
 * ⚠️ همان دلیلِ [`index.test.ts`](index.test.ts): این فایل
 * [`apply-remote.ts`](apply-remote.ts) را می‌آزماید که ورودیِ اصلیِ `canvas-core`
 * را می‌بیند، و Excalidraw هنگامِ **لودِ ماژول** به `window` دست می‌زند.
 */
import { HB_IMAGE_MIME_ALLOW } from "@hamboom/canvas-core";
import type { CanvasInbound, ElementChangeSet } from "@hamboom/canvas-core/sync";
import { HB_ALLOWED_IMAGE_MIME, type HbAsset, type HbElement } from "@hamboom/shared-types";
import { assertNoBinary, boardRoots, readDocument } from "@hamboom/ydoc-schema";
import { describe, expect, it, vi } from "vitest";

import { ConnectionCancelledError, YjsSyncAdapter } from "./adapter.ts";
import { registerSceneAssets, type CanvasApi } from "./apply-remote.ts";
import { createLocalAssetTransport, LocalAssetStore, type AssetTransport } from "./assets.ts";
import { createCanvasBinding } from "./canvas-binding.ts";
import { LocalTransport, LocalTransportHub } from "./transport.ts";

/**
 * تست‌های گام ۳٫۶ — **دارایی پشتِ پورت**.
 *
 * معیارِ پذیرش: تصویری که در الف درج می‌شود در ب با **همان `fileId`** ظاهر
 * می‌شود، متادیتایش در سند است و **باینری‌اش نیست** (P4 و
 * [PLAN بخش ۷٫۱](../../../PLAN.md)).
 */

const PNG_MIME = "image/png";

function imageFile(name = "sticker.png", type = PNG_MIME): File {
  return new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type });
}

/** انبارِ قابلِ آزمودن — `URL.createObjectURL` بیرونِ مرورگر وجود ندارد. */
function testStore(): LocalAssetStore {
  return new LocalAssetStore({ createUrl: (file) => `blob:test/${file.name}` });
}

function imageElement(id: string, fileId: string): HbElement {
  return {
    id,
    type: "image",
    x: 0,
    y: 0,
    width: 200,
    height: 120,
    angle: 0,
    index: "a1",
    frameId: null,
    groupIds: [],
    locked: false,
    strokeColor: "transparent",
    backgroundColor: "transparent",
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
    fileId,
    scale: [1, 1],
    status: "saved",
    crop: null,
    customData: {
      hb: { schema: 1, kind: "image", createdBy: "u", lastEditedBy: "u", createdAt: 0 },
    },
  } as HbElement;
}

interface FakeCanvas {
  inbound: CanvasInbound;
  readonly received: ElementChangeSet[];
}

function fakeCanvas(): FakeCanvas {
  const received: ElementChangeSet[] = [];
  return {
    received,
    inbound: {
      applyRemoteChanges: (changes) => received.push(changes),
      applyPeers: vi.fn(),
      setConnectionState: vi.fn(),
      setSaveState: vi.fn(),
      setPermissions: vi.fn(),
      replaceDocument: vi.fn(),
      focusOn: vi.fn(),
    },
  };
}

/** دو کلاینت روی یک hub **و یک انبارِ مشترک** — انبار جای Object Storage است. */
async function twoClients(store = testStore()) {
  const hub = new LocalTransportHub();
  const a = new YjsSyncAdapter({
    transport: new LocalTransport(hub),
    assets: createLocalAssetTransport(store, { uploadedBy: "u_a" }),
  });
  const b = new YjsSyncAdapter({
    transport: new LocalTransport(hub),
    assets: createLocalAssetTransport(store, { uploadedBy: "u_b" }),
  });
  const canvasA = fakeCanvas();
  const canvasB = fakeCanvas();
  const outA = await a.connect(canvasA.inbound);
  const outB = await b.connect(canvasB.inbound);
  return { store, a, b, outA, outB, canvasA, canvasB };
}

describe("★★ معیارِ پذیرش — تصویرِ الف در ب، با همان `fileId` و بدونِ باینری", () => {
  it("متادیتا در هر دو سند می‌نشیند و بایت‌ها نه", async () => {
    const { a, b, outA, canvasB } = await twoClients();

    const asset = await outA.requestAssetUpload(imageFile());
    outA.emitElementChanges({
      upserted: [imageElement("img_1", asset.fileId)],
      deleted: [],
      origin: "local-user",
    });

    // ۱) عنصر با همان `fileId` به ب رسید.
    const [element] = readDocument(b.document).elements;
    expect(element).toMatchObject({ id: "img_1", fileId: asset.fileId });

    // ۲) متادیتا در **هر دو** سند است.
    for (const doc of [a.document, b.document]) {
      expect(readDocument(doc).assets).toEqual([
        {
          fileId: asset.fileId,
          bucket: "local",
          key: `local/${asset.fileId}`,
          mime: PNG_MIME,
          // ★ **۱ و نه ۰** — `hbAsset` ابعادِ مثبت می‌خواهد. اینجا decoder نداریم
          //   (jsdom) پس ابعادِ جایگزین می‌نشیند؛ در مرورگر واقعی decode می‌شود.
          width: 1,
          height: 1,
          sizeBytes: 8,
          sha256: null,
          uploadedBy: "u_a",
          createdAt: expect.any(Number),
        },
      ]);
    }

    // ۳) ★ نگهبانِ گام ۲٫۲ همچنان سبز — هیچ باینری‌ای در سند نیست.
    expect(() => assertNoBinary(a.document)).not.toThrow();
    expect(() => assertNoBinary(b.document)).not.toThrow();

    // ۴) بوم ب متادیتا را **همراهِ** عنصر می‌گیرد؛ بدونِ آن یک قابِ خالی داشت.
    expect(canvasB.received.at(-1)?.assets).toEqual([
      expect.objectContaining({ fileId: asset.fileId }),
    ]);
  });

  it("★ ب همان URL را resolve می‌کند — انبار جای Object Storage است", async () => {
    const { outA, outB } = await twoClients();

    const asset = await outA.requestAssetUpload(imageFile("cat.png"));

    expect(await outB.resolveAssetUrl(asset.fileId)).toBe("blob:test/cat.png");
    expect(await outA.resolveAssetUrl(asset.fileId)).toBe("blob:test/cat.png");
  });

  it("★★ متادیتا **قبل از** عنصر روی سیم می‌رود", async () => {
    // ترتیب تزئینی نیست: عنصرِ تصویر فقط یک ارجاع است. اگر زودتر برسد، همتا
    // یک `fileId`ِ آویزان دارد و هیچ راهی برای نمایشش.
    const { b, outA } = await twoClients();

    const asset = await outA.requestAssetUpload(imageFile());
    // هنوز هیچ عنصری emit نشده، ولی ب متادیتا را دارد.
    expect(boardRoots(b.document).assets.has(asset.fileId)).toBe(true);
    expect(readDocument(b.document).elements).toEqual([]);
  });

  it("`fileId` تکراری متادیتای دوم نمی‌سازد", async () => {
    const { a, outA } = await twoClients();

    const asset = await outA.requestAssetUpload(imageFile());
    outA.emitElementChanges({
      upserted: [imageElement("img_1", asset.fileId), imageElement("img_2", asset.fileId)],
      deleted: [],
      origin: "local-user",
    });

    expect(readDocument(a.document).assets).toHaveLength(1);
  });
});

describe("پورت — نبودنش خطا می‌دهد، نه سکوت", () => {
  it("★ بدونِ پورت، آپلود **رد می‌شود**", async () => {
    // ⚠️ این همان تستِ پین‌شده‌ی گام ۳٫۱ است که با گام ۳٫۶ قرمز شد: پیامش عوض
    // شده ولی **قاعده‌اش نه** — یک Promiseِ ساختگی یعنی بوم برای همیشه منتظرِ
    // `fileId` می‌مانَد و placeholder هرگز جایگزین نمی‌شود.
    const adapter = new YjsSyncAdapter();
    const outbound = await adapter.connect(fakeCanvas().inbound);

    await expect(outbound.requestAssetUpload(imageFile())).rejects.toThrow(/پورتِ دارایی/);
    // ولی `resolve` ساکت می‌مانَد: مسیرِ **رندر** است و نباید بورد را بشکند.
    await expect(outbound.resolveAssetUrl("f_x")).resolves.toBe("");
  });

  it("★ قطعِ اتصال وسطِ آپلود، متادیتا را روی سندِ یتیم نمی‌نویسد", async () => {
    // بدونِ نگهبانِ نسل، متادیتا روی سندی می‌نشست که ترابری‌اش رفته — هیچ‌وقت
    // به همتا نمی‌رسید و یک واگراییِ بی‌صدا می‌ساخت.
    let release = (): void => {};
    const slow: AssetTransport = {
      upload: (file) =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              fileId: "f_slow",
              bucket: "local",
              key: "local/f_slow",
              mime: file.type,
              width: 0,
              height: 0,
              sizeBytes: file.size,
              sha256: null,
              uploadedBy: "u_a",
              createdAt: 0,
            });
        }),
      resolve: () => Promise.resolve(""),
    };

    const adapter = new YjsSyncAdapter({ assets: slow });
    const outbound = await adapter.connect(fakeCanvas().inbound);
    const pending = outbound.requestAssetUpload(imageFile());

    adapter.disconnect();
    release();

    await expect(pending).rejects.toBeInstanceOf(ConnectionCancelledError);
    expect(boardRoots(adapter.document).assets.size).toBe(0);
  });
});

describe("پیاده‌سازیِ توسعه", () => {
  it("★ نوعِ غیرمجاز را **رد می‌کند** — سرور هم در تولید همین کار را می‌کند", async () => {
    // پورتِ توسعه‌ای که همه‌چیز را قبول کند، خطا را به تولید موکول می‌کند.
    const transport = createLocalAssetTransport(testStore(), { uploadedBy: "u_a" });

    await expect(
      transport.upload(imageFile("evil.exe", "application/x-msdownload")),
    ).rejects.toThrow(/پشتیبانی نمی‌شود/);
  });

  it("`fileId`ِ ناشناخته رشته‌ی خالی می‌دهد، نه خطا", async () => {
    const transport = createLocalAssetTransport(testStore(), { uploadedBy: "u_a" });
    await expect(transport.resolve("f_missing")).resolves.toBe("");
  });

  it("★★ ابعاد هرگز صفر نمی‌شود — `hbAsset` مثبت می‌خواهد", async () => {
    // این را تست فهماند نه schema: اولین نسخه‌ی پورت صفر می‌فرستاد و
    // `writeAsset` با `ZodError` افتاد. ابعادِ واقعی را در تولید سرور می‌نویسد.
    const transport = createLocalAssetTransport(testStore(), { uploadedBy: "u_a" });
    await expect(transport.upload(imageFile())).resolves.toMatchObject({ width: 1, height: 1 });

    const decoding = createLocalAssetTransport(testStore(), {
      uploadedBy: "u_a",
      readImageSize: () => Promise.resolve({ width: 640, height: 480 }),
    });
    await expect(decoding.upload(imageFile())).resolves.toMatchObject({
      width: 640,
      height: 480,
    });
  });

  it("`uploadedBy` از سازنده می‌آید، نه از صداکننده", async () => {
    // در تولید سرور آن را از توکن درمی‌آورد؛ اگر کلاینت بفرستدش، هرکس می‌تواند
    // فایل را به نامِ دیگری بالا بگذارد.
    const transport = createLocalAssetTransport(testStore(), { uploadedBy: "u_owner" });
    await expect(transport.upload(imageFile())).resolves.toMatchObject({ uploadedBy: "u_owner" });
  });

  it("`dispose` روی **انبار** است، نه روی کلاینت", async () => {
    // اگر با `disconnect`ِ یک کلاینت صدا زده می‌شد، تصویر روی بومِ همتا هم سفید
    // می‌شد.
    const revoked: string[] = [];
    const store = new LocalAssetStore({
      createUrl: (file) => `blob:test/${file.name}`,
      revokeUrl: (url) => revoked.push(url),
    });
    const { a, b, outA } = await twoClients(store);

    await outA.requestAssetUpload(imageFile("keep.png"));
    a.disconnect();
    b.disconnect();
    expect(revoked).toEqual([]);

    store.dispose();
    expect(revoked).toEqual(["blob:test/keep.png"]);
    expect(store.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// سمتِ گیرنده — ثبتِ بایت‌ها در موتور
// ─────────────────────────────────────────────────────────────

function fakeApi(known: Record<string, unknown> = {}) {
  const added: Array<Record<string, unknown>> = [];
  const api = {
    getFiles: () => known,
    addFiles: (files: Array<Record<string, unknown>>) => added.push(...files),
    getSceneElements: () => [],
    getSceneElementsIncludingDeleted: () => [],
    updateScene: vi.fn(),
  } as unknown as CanvasApi;
  return { api, added };
}

const asset = (fileId: string): HbAsset => ({
  fileId,
  bucket: "local",
  key: `local/${fileId}`,
  mime: PNG_MIME,
  width: 0,
  height: 0,
  sizeBytes: 8,
  sha256: null,
  uploadedBy: "u_a",
  createdAt: 12,
});

describe("★★ ثبتِ بایت‌ها در موتور — بدونش عنصر یک قابِ خالی است", () => {
  it("هر دارایی یک بار `addFiles` می‌شود، با شکلِ درست", async () => {
    const { api, added } = fakeApi();
    await registerSceneAssets(api, [asset("f_1")], { resolve: () => Promise.resolve("blob:x") });

    expect(added).toEqual([{ id: "f_1", dataURL: "blob:x", mimeType: PNG_MIME, created: 12 }]);
  });

  it("★ آنچه موتور از قبل دارد دوباره resolve نمی‌شود", async () => {
    // در M3 هر resolve یک URLِ امضاشده‌ی تازه است و هزینه‌ی شبکه دارد.
    const { api, added } = fakeApi({ f_1: {} });
    const resolve = vi.fn(() => Promise.resolve("blob:x"));

    await registerSceneAssets(api, [asset("f_1")], { resolve });

    expect(resolve).not.toHaveBeenCalled();
    expect(added).toEqual([]);
  });

  it("★ رشته‌ی خالی یعنی placeholder می‌مانَد — تصویرِ خراب ثبت نمی‌شود", async () => {
    const { api, added } = fakeApi();
    await registerSceneAssets(api, [asset("f_1")], { resolve: () => Promise.resolve("") });
    expect(added).toEqual([]);
  });

  it("★ خطای یک دارایی بقیه را نمی‌اندازد", async () => {
    const { api, added } = fakeApi();
    const failures: string[] = [];

    await registerSceneAssets(
      api,
      [asset("f_bad"), asset("f_ok")],
      {
        resolve: (id) =>
          id === "f_bad" ? Promise.reject(new Error("۵۰۳")) : Promise.resolve("blob:ok"),
      },
      (failed) => failures.push(failed.fileId),
    );

    expect(failures).toEqual(["f_bad"]);
    expect(added).toEqual([expect.objectContaining({ id: "f_ok" })]);
  });
});

describe("`createCanvasBinding` هر دو مسیر را ثبت می‌کند", () => {
  it("هم تغییرِ remote، هم بارگذاریِ اولیه", async () => {
    const { api, added } = fakeApi();
    const binding = createCanvasBinding({
      api,
      assets: { resolve: (id) => Promise.resolve(`blob:${id}`) },
    });

    binding.applyRemoteChanges({
      upserted: [],
      deleted: [],
      origin: "remote",
      assets: [asset("f_remote")],
    });
    binding.replaceDocument({
      elements: [],
      assets: [asset("f_load")],
      appState: {
        viewBackgroundColor: "#ffffff",
        gridSize: 20,
        gridEnabled: false,
        snapToObjects: true,
        frameRendering: { enabled: true, name: true, outline: true, clip: true },
      },
    });

    // ثبت **fire-and-forget** است — قرارداد `void` برمی‌گرداند.
    await vi.waitFor(() => expect(added).toHaveLength(2));
    expect(added.map((file) => file.id)).toEqual(["f_remote", "f_load"]);
  });

  it("بدونِ پورت هیچ خطایی نمی‌دهد — فقط ثبت نمی‌کند", () => {
    const { api, added } = fakeApi();
    const binding = createCanvasBinding({ api });

    expect(() =>
      binding.applyRemoteChanges({
        upserted: [],
        deleted: [],
        origin: "remote",
        assets: [asset("f_1")],
      }),
    ).not.toThrow();
    expect(added).toEqual([]);
  });
});

describe("★ نگهبانِ واگرایی — دو فهرستِ MIME", () => {
  it("فهرستِ `canvas-core` و `shared-types` یکی می‌مانند", () => {
    // ⚠️ این دو فهرست **دو نسخه از یک قاعده‌اند** (اعتبارسنجیِ کلاینت در
    // `canvas-core`، قرارداد در `shared-types`) و امروز یکی‌اند. اگر واگرا شوند،
    // فایلی که ابزار می‌پذیرد پشتِ پورت رد می‌شود — یا بدتر، برعکس.
    // `canvas-sync` تنها پکیجی است که هر دو را می‌بیند، پس نگهبان اینجاست —
    // همان جایی که نگهبانِ `BoardDocument ↔ CanvasDocument` در گام ۲٫۱ نشست.
    expect([...HB_IMAGE_MIME_ALLOW].sort()).toEqual([...HB_ALLOWED_IMAGE_MIME].sort());
  });
});
