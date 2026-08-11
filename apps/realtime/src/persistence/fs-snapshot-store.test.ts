import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFsSnapshotStore } from "./fs-snapshot-store.ts";
import { snapshotKey, type SnapshotStore } from "./snapshot-store.ts";

/**
 * تست‌های `FsSnapshotStore` (D-3).
 *
 * ⚠️ اینجا **فایل‌سیستمِ واقعی** است، نه mock — کلِ ادعای این کلاس درباره‌ی
 * رفتارِ فایل‌سیستم است (نوشتنِ اتمیک، مهارِ مسیر). با یک fs ساختگی، تست فقط
 * ادعای خودمان را به خودمان پس می‌داد.
 */

let dir: string;
let store: SnapshotStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hb-snap-"));
  store = createFsSnapshotStore({ directory: dir });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("FsSnapshotStore", () => {
  it("می‌نویسد و همان بایت‌ها را برمی‌گرداند", async () => {
    const bytes = new Uint8Array([1, 2, 3, 250, 0, 7]);
    const key = snapshotKey("brd_1", 42);

    await store.put(key, bytes);

    expect(await store.get(key)).toEqual(bytes);
  });

  it("کلیدِ ناموجود `null` است، نه خطا", async () => {
    // ⚠️ بوردِ بدونِ snapshot حالتِ **عادی** است؛ اگر خطا بود، مسیرِ بارگذاری
    //    مجبور می‌شد خطای واقعی و «هنوز فشرده نشده» را از هم تشخیص بدهد.
    expect(await store.get(snapshotKey("brd_x", 1))).toBeNull();
  });

  it("★ هیچ فایلِ موقتی جا نمی‌گذارد", async () => {
    const key = snapshotKey("brd_2", 7);
    await store.put(key, new Uint8Array([9]));

    const files = await readdir(join(dir, "brd_2"));
    expect(files).toEqual(["000000000007.ybin"]);
  });

  it("★ کلیدِ هر `seq` جداست — نوشتنِ تازه، snapshotِ سالمِ قبلی را نمی‌بلعد", async () => {
    // ⚠️ اگر کلید ثابت بود، نوشتنِ نصفه‌کاره‌ی جدید نسخه‌ی سالمِ قبلی را هم
    //    می‌برد — دقیقاً وقتی که updateهای قدیمی از لاگ پاک شده‌اند.
    await store.put(snapshotKey("brd_3", 100), new Uint8Array([1]));
    await store.put(snapshotKey("brd_3", 200), new Uint8Array([2]));

    expect(await store.get(snapshotKey("brd_3", 100))).toEqual(new Uint8Array([1]));
    expect(await store.get(snapshotKey("brd_3", 200))).toEqual(new Uint8Array([2]));
  });

  it("حذف idempotent است", async () => {
    const key = snapshotKey("brd_4", 1);
    await store.put(key, new Uint8Array([1]));
    await store.delete?.(key);
    await store.delete?.(key);

    expect(await store.get(key)).toBeNull();
  });

  /**
   * ★★ مهارِ مسیر — این یک بررسیِ **امنیتی** است، نه نظافتی.
   *
   * `boardId` از توکن می‌آید و امروز uuid است، ولی این انبار آن را نمی‌داند.
   * یک کلیدِ ساختگی بدونِ این بررسی هر جای دیسک می‌نوشت.
   */
  describe("★ کلید نمی‌تواند از ریشه بیرون بزند", () => {
    it.each(["../escape.ybin", "a/../../escape.ybin", "brd/../../../escape.ybin"])(
      "%s رد می‌شود",
      async (key) => {
        await expect(store.put(key, new Uint8Array([1]))).rejects.toThrow("بیرون می‌زند");
        await expect(store.get(key)).rejects.toThrow("بیرون می‌زند");
      },
    );

    it("مسیرِ درونیِ تودرتو مجاز است", async () => {
      await store.put("a/b/c.ybin", new Uint8Array([5]));
      expect(await store.get("a/b/c.ybin")).toEqual(new Uint8Array([5]));
    });
  });

  it("روی فایلِ موجود بازمی‌نویسد بدونِ باقی گذاشتنِ نصفه", async () => {
    const key = snapshotKey("brd_5", 3);
    await store.put(key, new Uint8Array([1, 1, 1, 1]));
    await store.put(key, new Uint8Array([2, 2]));

    expect(await store.get(key)).toEqual(new Uint8Array([2, 2]));
    expect(await readdir(join(dir, "brd_5"))).toHaveLength(1);
  });

  it("★ فایلِ موقتِ جامانده از یک اجرای شکست‌خورده، خواندن را خراب نمی‌کند", async () => {
    // شبیه‌سازیِ برقِ‌رفتن وسطِ `put`: یک `.tmp` روی دیسک می‌مانَد.
    const key = snapshotKey("brd_6", 8);
    await store.put(key, new Uint8Array([7]));
    await writeFile(join(dir, "brd_6", "000000000008.ybin.deadbeef.tmp"), Buffer.from([0]));

    expect(await store.get(key)).toEqual(new Uint8Array([7]));
    // و بایت‌های واقعی دست‌نخورده‌اند.
    expect(new Uint8Array(await readFile(join(dir, "brd_6", "000000000008.ybin")))).toEqual(
      new Uint8Array([7]),
    );
  });
});
