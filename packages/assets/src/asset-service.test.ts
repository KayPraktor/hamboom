import { createHash } from "node:crypto";

import type { AssetPresignRequest } from "@hamboom/shared-types";
import { createMemoryObjectStore, type ObjectStore, type PresignUploadOptions } from "@hamboom/storage";
import { describe, expect, it } from "vitest";

import { AssetValidationError, createAssetService, type PresignContext } from "./asset-service.ts";

/** یک PNGِ ساختگیِ معتبر (magic + بدنه‌ی معین) به طولِ دلخواه. */
function fakePng(size: number): Uint8Array {
  const b = new Uint8Array(size);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (let i = 8; i < size; i++) b[i] = i & 0xff;
  return b;
}
const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");
const ctx: PresignContext = { teamId: "t", boardId: "b", uploadedBy: "u" };

describe("createAssetService — validateUploaded (هسته‌ی امنیتی)", () => {
  const KEY = "teams/t/boards/b/f_x.png";
  async function seeded(bytes: Uint8Array) {
    const objectStore = createMemoryObjectStore();
    await objectStore.putObject(KEY, bytes);
    return createAssetService({ objectStore, maxBytes: 1024 });
  }

  it("بایت‌های درست → فاکت‌های تاییدشده (sha256 مستقلاً بازمحاسبه)", async () => {
    const png = fakePng(20);
    const svc = await seeded(png);
    const out = await svc.validateUploaded({
      key: KEY,
      declared: { mimeType: "image/png", sizeBytes: 20, sha256: sha(png) },
    });
    expect(out).toEqual({ mime: "image/png", sizeBytes: 20, sha256: sha(png) });
  });

  it("★ sha256ِ اعلامیِ غلط → throw — به ادعای کلاینت اعتماد نمی‌شود", async () => {
    const png = fakePng(20);
    const svc = await seeded(png);
    await expect(
      svc.validateUploaded({
        key: KEY,
        declared: { mimeType: "image/png", sizeBytes: 20, sha256: "0".repeat(64) },
      }),
    ).rejects.toThrow(AssetValidationError);
  });

  it("نوعِ واقعیِ ناهمخوان (بایت‌ها png، اعلام jpeg) → throw", async () => {
    const png = fakePng(20);
    const svc = await seeded(png);
    await expect(
      svc.validateUploaded({
        key: KEY,
        declared: { mimeType: "image/jpeg", sizeBytes: 20, sha256: sha(png) },
      }),
    ).rejects.toThrow("نوعِ واقعی");
  });

  it("★ بایت‌های غیرِتصویری که ادعای png دارند → throw (sniff می‌گیردش)", async () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 1, 2, 3, 4]); // MZ
    const svc = await seeded(exe);
    await expect(
      svc.validateUploaded({
        key: KEY,
        declared: { mimeType: "image/png", sizeBytes: 8, sha256: sha(exe) },
      }),
    ).rejects.toThrow("نوعِ واقعیِ بایت‌ها مجاز نیست");
  });

  it("اندازه‌ی واقعی ≠ اعلام → throw", async () => {
    const png = fakePng(20);
    const svc = await seeded(png);
    await expect(
      svc.validateUploaded({
        key: KEY,
        declared: { mimeType: "image/png", sizeBytes: 999, sha256: sha(png) },
      }),
    ).rejects.toThrow("اندازه");
  });

  it("بزرگ‌تر از سقف → throw", async () => {
    const png = fakePng(2000);
    const svc = await seeded(png);
    await expect(
      svc.validateUploaded({
        key: KEY,
        declared: { mimeType: "image/png", sizeBytes: 2000, sha256: sha(png) },
      }),
    ).rejects.toThrow("سقف");
  });

  it("کلیدِ ناموجود → throw", async () => {
    const svc = createAssetService({ objectStore: createMemoryObjectStore(), maxBytes: 1024 });
    await expect(
      svc.validateUploaded({
        key: "nope",
        declared: { mimeType: "image/png", sizeBytes: 1, sha256: "0".repeat(64) },
      }),
    ).rejects.toThrow("انبار");
  });
});

describe("createAssetService — presign و resolve", () => {
  function spyStore() {
    const captured: { presign?: PresignUploadOptions; getKey?: string } = {};
    const store: ObjectStore = {
      ...createMemoryObjectStore(),
      presignUpload: (opts) => {
        captured.presign = opts;
        return Promise.resolve({
          url: "http://s/up",
          fields: { key: opts.key, "Content-Type": opts.contentType, Policy: "x" },
        });
      },
      presignGet: (key) => {
        captured.getKey = key;
        return Promise.resolve(`http://s/get/${key}`);
      },
    };
    return { store, captured };
  }

  it("کلید، fileId و آرگومان‌های presignUpload درست‌اند", async () => {
    const { store, captured } = spyStore();
    const svc = createAssetService({ objectStore: store, maxBytes: 1000, newFileId: () => "f_fixed" });
    const res = await svc.presign(
      { mimeType: "image/png", sizeBytes: 500, sha256: "a".repeat(64) },
      { teamId: "t1", boardId: "b1", uploadedBy: "u1" },
    );

    expect(res.fileId).toBe("f_fixed");
    expect(res.url).toBe("http://s/up");
    expect(res.fields.key).toBe("teams/t1/boards/b1/f_fixed.png");
    // ★ سقفِ POST-policy = اندازه‌ی اعلامیِ همین فایل، نه سقفِ سراسری.
    expect(captured.presign).toMatchObject({
      key: "teams/t1/boards/b1/f_fixed.png",
      maxBytes: 500,
      contentType: "image/png",
    });
  });

  it("نوعِ غیرمجاز → throw", async () => {
    const { store } = spyStore();
    const svc = createAssetService({ objectStore: store, maxBytes: 1000 });
    const bad = { mimeType: "application/x-msdownload", sizeBytes: 10, sha256: "a".repeat(64) };
    await expect(svc.presign(bad as AssetPresignRequest, ctx)).rejects.toThrow("مجاز نیست");
  });

  it("اعلامِ بزرگ‌تر از سقف → throw", async () => {
    const { store } = spyStore();
    const svc = createAssetService({ objectStore: store, maxBytes: 100 });
    await expect(
      svc.presign({ mimeType: "image/png", sizeBytes: 200, sha256: "a".repeat(64) }, ctx),
    ).rejects.toThrow("سقف");
  });

  it("resolve از presignGet می‌آید", async () => {
    const { store } = spyStore();
    const svc = createAssetService({ objectStore: store, maxBytes: 100 });
    expect(await svc.resolve("teams/t/boards/b/f.png")).toBe("http://s/get/teams/t/boards/b/f.png");
  });
});
