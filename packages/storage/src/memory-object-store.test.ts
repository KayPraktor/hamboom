import { Readable } from "node:stream";

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
    const before = Date.now();
    await store.putObject("k", new Uint8Array([1, 2, 3]), { contentType: "text/plain" });
    const head = await store.headObject("k");
    expect(head).toMatchObject({ size: 3, contentType: "text/plain", etag: undefined });
    // ★★ `lastModified` تزئینی نیست — جاروبِ بلابِ یتیم (M5 فاز ۸) تنها چیزی است که
    //    با آن می‌تواند «زباله‌ی ماه‌ها پیش» را از «آپلودی که همین حالا تمام شد» جدا کند.
    expect(head?.lastModified).toBeInstanceOf(Date);
    expect(head?.lastModified?.getTime()).toBeGreaterThanOrEqual(before);
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

  // ── M6 / ADR-069 — سه متدِ افزایشی ──────────────────────────────────────
  it("putObjectStream → getObjectStream بیت‌به‌بیت، و با put/getِ عادی هم‌خانه است", async () => {
    const store = createMemoryObjectStore();
    const bytes = new Uint8Array([7, 8, 9, 10, 11]);
    await store.putObjectStream(
      "s/1",
      Readable.from([Buffer.from(bytes.slice(0, 2)), Buffer.from(bytes.slice(2))]),
      {
        contentLength: bytes.byteLength,
        contentType: "application/octet-stream",
      },
    );
    // همان شیء از راهِ قدیمی خوانده می‌شود …
    expect(await store.getObject("s/1")).toEqual(bytes);
    expect((await store.headObject("s/1"))?.size).toBe(5);
    // … و از راهِ stream.
    const chunks: Buffer[] = [];
    for await (const c of (await store.getObjectStream("s/1"))!) chunks.push(c as Buffer);
    expect(new Uint8Array(Buffer.concat(chunks))).toEqual(bytes);
    expect(await store.getObjectStream("nope")).toBeNull();
  });

  it("★ putObjectStream با contentLengthِ ناهم‌خوان throw می‌کند (مثلِ S3)", async () => {
    const store = createMemoryObjectStore();
    await expect(
      store.putObjectStream("s/2", Readable.from([Buffer.from([1, 2, 3])]), { contentLength: 99 }),
    ).rejects.toThrow("contentLength");
    expect(await store.headObject("s/2")).toBeNull();
  });

  it("iteratePrefix همان کلیدهای listPrefix را، به همان ترتیب، صفحه‌به‌صفحه می‌دهد", async () => {
    const store = createMemoryObjectStore();
    await store.putObject("p/b", new Uint8Array([1]));
    await store.putObject("p/a", new Uint8Array([1]));
    await store.putObject("q/a", new Uint8Array([1]));
    const seen: string[] = [];
    for await (const key of store.iteratePrefix("p/")) seen.push(key);
    expect(seen).toEqual(await store.listPrefix("p/"));
    expect(seen).toEqual(["p/a", "p/b"]);
  });

  it("presign در حافظه throw می‌کند — URLِ واقعی ندارد", async () => {
    const store = createMemoryObjectStore();
    await expect(store.presignGet("k")).rejects.toThrow("پشتیبانی نمی‌شود");
    await expect(
      store.presignUpload({ key: "k", maxBytes: 10, contentType: "text/plain" }),
    ).rejects.toThrow("پشتیبانی نمی‌شود");
  });
});
