import { describe, expect, it } from "vitest";

import { createMemoryObjectStore } from "./memory-object-store.ts";

describe("MemoryObjectStore", () => {
  it("put → get بیت‌به‌بیت، و نسخه‌ی مستقل (کپی نه ارجاع)", async () => {
    const store = createMemoryObjectStore();
    const bytes = new Uint8Array([1, 2, 3, 250]);
    await store.putObject("a/b", bytes, { contentType: "application/octet-stream" });
    expect(await store.getObject("a/b")).toEqual(bytes);

    // ★ تغییرِ بافرِ ورودی نباید داخل را عوض کند، و برعکس — وگرنه تست‌های مصرف‌کننده دروغ می‌شوند.
    bytes[0] = 99;
    expect((await store.getObject("a/b"))?.[0]).toBe(1);
  });

  it("کلیدِ ناموجود `null` است، نه خطا", async () => {
    const store = createMemoryObjectStore();
    expect(await store.getObject("nope")).toBeNull();
    expect(await store.headObject("nope")).toBeNull();
  });

  it("headObject اندازه و نوع را می‌دهد", async () => {
    const store = createMemoryObjectStore();
    await store.putObject("k", new Uint8Array([1, 2, 3]), { contentType: "text/plain" });
    expect(await store.headObject("k")).toEqual({ size: 3, contentType: "text/plain", etag: undefined });
  });

  it("delete idempotent است و listPrefix مرتب‌شده و prefix-محور", async () => {
    const store = createMemoryObjectStore();
    await store.putObject("p/2", new Uint8Array([2]));
    await store.putObject("p/1", new Uint8Array([1]));
    await store.putObject("q/1", new Uint8Array([9]));

    expect(await store.listPrefix("p/")).toEqual(["p/1", "p/2"]);
    await store.deleteObject("p/1");
    await store.deleteObject("p/1"); // دوباره — بی‌خطا
    expect(await store.listPrefix("p/")).toEqual(["p/2"]);
  });

  it("presign در حافظه throw می‌کند — URLِ واقعی ندارد", async () => {
    const store = createMemoryObjectStore();
    await expect(store.presignGet("k")).rejects.toThrow("پشتیبانی نمی‌شود");
    await expect(
      store.presignUpload({ key: "k", maxBytes: 10, contentType: "text/plain" }),
    ).rejects.toThrow("پشتیبانی نمی‌شود");
  });
});
