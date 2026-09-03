import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { HbAsset } from "@hamboom/shared-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getKind } from "../elements/mapping";
import { createImageTool, type ImageAssetOutbound } from "./image-tool";

/** فایل ساختگی — فقط `type`/`size` خوانده می‌شوند. */
function fakeFile(type = "image/png", size = 1024): File {
  return new File([new Uint8Array(size)], "x", { type });
}

/** موتور ساختگی — عناصر و فراخوانی‌ها را ثبت می‌کند، بدون رندر واقعی. */
function fakeApi() {
  let elements: Array<Record<string, unknown>> = [];
  const updateSceneCalls: Array<{
    captureUpdate: string | undefined;
    selected: string[] | null;
    ids: string[];
  }> = [];
  const addFilesCalls: Array<Record<string, unknown>> = [];
  // ترتیبِ درهم‌بافته‌ی فراخوانی‌ها — تا بتوان «addFiles بعد از flip» را قفل کرد (M3 گام ۱۱٫۲).
  const callSeq: string[] = [];

  const api = {
    getSceneElements: () => elements,
    getAppState: () => ({
      selectedElementIds: {},
      offsetLeft: 0,
      offsetTop: 0,
      width: 800,
      height: 600,
      scrollX: 0,
      scrollY: 0,
      zoom: { value: 1 },
    }),
    updateScene: (data: {
      elements?: Array<Record<string, unknown>>;
      appState?: { selectedElementIds?: Record<string, boolean> };
      captureUpdate?: string;
    }) => {
      if (data.elements) elements = data.elements;
      updateSceneCalls.push({
        captureUpdate: data.captureUpdate,
        selected: data.appState?.selectedElementIds
          ? Object.keys(data.appState.selectedElementIds)
          : null,
        ids: elements.map((e) => e.id as string),
      });
      callSeq.push(`update:${data.captureUpdate ?? "?"}`);
    },
    addFiles: (files: Array<Record<string, unknown>>) => {
      addFilesCalls.push(...files);
      callSeq.push("addFiles");
    },
  } as unknown as ExcalidrawImperativeAPI;

  return {
    api,
    updateSceneCalls,
    addFilesCalls,
    callSeq,
    getElements: () => elements,
  };
}

function fakeOutbound(fileIds: string[]) {
  let i = 0;
  const resolveCalls: string[] = [];
  const outbound: ImageAssetOutbound = {
    requestAssetUpload: async (file: File): Promise<HbAsset> => ({
      fileId: fileIds[i++] ?? `f_auto_${i}`,
      bucket: "local",
      key: "k",
      mime: file.type,
      width: 0,
      height: 0,
      sizeBytes: file.size,
      sha256: null,
      uploadedBy: "u",
      createdAt: 0,
    }),
    resolveAssetUrl: async (fileId: string): Promise<string> => {
      resolveCalls.push(fileId);
      return `blob:${fileId}`;
    },
  };
  return { outbound, resolveCalls };
}

/** ریشه‌ی جدا تا listener روی document سراسری نچسبد. */
function detachedRoot() {
  return document.createElement("div");
}

describe("createImageTool — orchestration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("★ جریان کامل: pending → saved → addFiles، در دو ژست undo درست", async () => {
    const f = fakeApi();
    const o = fakeOutbound(["f_1"]);
    const tool = createImageTool({
      api: f.api,
      outbound: o.outbound,
      authorId: "u_demo",
      root: detachedRoot(),
      readImageSize: async () => ({ width: 800, height: 400 }),
    });

    const result = await tool.ingestFile(fakeFile("image/png"), { x: 100, y: 100 });

    expect(result).not.toBeNull();
    expect(result!.type).toBe("image");
    expect(getKind(result!)).toBe("image");
    expect((result as unknown as { status: string }).status).toBe("saved");
    expect((result as unknown as { fileId: string }).fileId).toBe("f_1");

    // دو updateScene: اول creation (IMMEDIATELY)، بعد flip به saved (NEVER).
    // ترتیب مهم است — با ترتیب معکوس، یک undo تصویر را پاک نمی‌کند (تایید مرورگر).
    expect(f.updateSceneCalls.map((c) => c.captureUpdate)).toEqual(["IMMEDIATELY", "NEVER"]);
    // placeholder انتخاب می‌شود تا فوراً قابل تغییر اندازه/چرخش باشد
    expect(f.updateSceneCalls[0]!.selected).toEqual([result!.id]);

    // باینری یک‌بار با URL حل‌شده ثبت می‌شود
    expect(f.addFilesCalls).toHaveLength(1);
    expect(f.addFilesCalls[0]).toMatchObject({
      id: "f_1",
      dataURL: "blob:f_1",
      mimeType: "image/png",
    });

    // ★★ ترتیبِ حیاتی (M3 گام ۱۱٫۲، لمسِ M1 با تاییدِ مالک): `addFiles` باید **بعد از** flip به saved بیاید.
    //    اگر روی عنصرِ pending ثبت شود (ترتیبِ قبلی)، موتور تصویر را بعد از flip رندر نمی‌کند و «قابِ خالی»
    //    می‌مانَد تا reload — در مرورگر سنجیده شد. این ترتیب همان مسیرِ بارگذاریِ سند/همتاست (اول saved، بعد addFiles).
    expect(f.callSeq).toEqual(["update:IMMEDIATELY", "update:NEVER", "addFiles"]);
  });

  it("★ ابعاد به کادر بیشینه جا می‌شود و درج، وسطِ نقطه می‌نشیند", async () => {
    const f = fakeApi();
    const o = fakeOutbound(["f_1"]);
    const tool = createImageTool({
      api: f.api,
      outbound: o.outbound,
      authorId: "u",
      root: detachedRoot(),
      readImageSize: async () => ({ width: 800, height: 400 }),
    });

    const result = await tool.ingestFile(fakeFile(), { x: 100, y: 100 });
    // fitImageBox(800,400,480) = 480×240
    expect([result!.width, result!.height]).toEqual([480, 240]);
    // وسطِ (100,100): x = 100 - 240، y = 100 - 120
    expect([result!.x, result!.y]).toEqual([100 - 240, 100 - 120]);
  });

  it("★ version نهایی جلو رفته — flip به saved یک تغییر ثبت‌شدنی است", async () => {
    const f = fakeApi();
    const o = fakeOutbound(["f_1"]);
    const tool = createImageTool({
      api: f.api,
      outbound: o.outbound,
      authorId: "u",
      root: detachedRoot(),
      readImageSize: async () => ({ width: 10, height: 10 }),
    });
    const result = await tool.ingestFile(fakeFile(), { x: 0, y: 0 });
    expect(result!.version).toBe(2); // placeholder v1 → bumpVersion
  });

  it("★ فایل نامعتبر: onError صدا می‌خورد، هیچ عنصری درج نمی‌شود", async () => {
    const f = fakeApi();
    const o = fakeOutbound(["f_1"]);
    const onError = vi.fn();
    const tool = createImageTool({
      api: f.api,
      outbound: o.outbound,
      authorId: "u",
      root: detachedRoot(),
      readImageSize: async () => ({ width: 10, height: 10 }),
      onError,
    });

    const result = await tool.ingestFile(fakeFile("image/bmp"), { x: 0, y: 0 });
    expect(result).toBeNull();
    expect(onError).toHaveBeenCalledOnce();
    expect(f.updateSceneCalls).toHaveLength(0);
    expect(o.resolveCalls).toHaveLength(0);
  });

  it("★ URL هر asset فقط یک‌بار resolve می‌شود (کش)", async () => {
    const f = fakeApi();
    // هر دو آپلود همان fileId را برمی‌گردانند تا مسیر کش پیموده شود
    const o = fakeOutbound(["f_same", "f_same"]);
    const tool = createImageTool({
      api: f.api,
      outbound: o.outbound,
      authorId: "u",
      root: detachedRoot(),
      readImageSize: async () => ({ width: 10, height: 10 }),
    });

    await tool.ingestFile(fakeFile(), { x: 0, y: 0 });
    await tool.ingestFile(fakeFile(), { x: 0, y: 0 });
    expect(o.resolveCalls).toEqual(["f_same"]); // بار دوم از کش
  });
});
