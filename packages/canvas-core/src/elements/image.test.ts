import { hbElement } from "@hamboom/shared-types";
import { describe, expect, it } from "vitest";

import { getKind } from "./mapping";
import {
  createImage,
  fitImageBox,
  validateImageFile,
  HB_IMAGE_MAX_BYTES,
  HB_IMAGE_MIME_ALLOW,
} from "./image";

let counter = 0;
function seed() {
  return {
    authorId: "u_1",
    now: 1_753_000_000_000,
    makeId: () => `id${++counter}`,
    random: () => 0.5,
  };
}

describe("validateImageFile", () => {
  it("★ هر فرمت مجاز را می‌پذیرد", () => {
    for (const mime of HB_IMAGE_MIME_ALLOW) {
      const res = validateImageFile({ type: mime, size: 1000 });
      expect(res.ok).toBe(true);
    }
  });

  it("★ فرمت غیرمجاز را رد می‌کند", () => {
    const res = validateImageFile({ type: "image/bmp", size: 1000 });
    expect(res).toMatchObject({ ok: false, reason: "bad-type" });
  });

  it("★ فایل بدون نوع را رد می‌کند", () => {
    const res = validateImageFile({ type: "", size: 1000 });
    expect(res).toMatchObject({ ok: false, reason: "bad-type" });
  });

  it("★ فایل بزرگ‌تر از حد را رد می‌کند", () => {
    const res = validateImageFile({ type: "image/png", size: HB_IMAGE_MAX_BYTES + 1 });
    expect(res).toMatchObject({ ok: false, reason: "too-large" });
  });

  it("دقیقاً روی مرز حجم را می‌پذیرد", () => {
    const res = validateImageFile({ type: "image/png", size: HB_IMAGE_MAX_BYTES });
    expect(res.ok).toBe(true);
  });

  it("پیام خطا فارسی است", () => {
    const res = validateImageFile({ type: "video/mp4", size: 10 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/پشتیبانی/);
  });
});

describe("fitImageBox", () => {
  it("★ تصویر کوچک‌تر از حد دست‌نخورده می‌ماند", () => {
    expect(fitImageBox(300, 200, 480)).toEqual({ width: 300, height: 200 });
  });

  it("★ تصویر بزرگ با حفظ نسبت کوچک می‌شود؛ بلندترین ضلع = حد", () => {
    const box = fitImageBox(1000, 500, 480);
    expect(box).toEqual({ width: 480, height: 240 });
  });

  it("★ ضلع عمودی بلندتر هم درست مقیاس می‌شود", () => {
    const box = fitImageBox(500, 1000, 480);
    expect(box).toEqual({ width: 240, height: 480 });
  });

  it("★ ابعاد نامعلوم (۰) به مربع پیش‌فرض برمی‌گردد", () => {
    expect(fitImageBox(0, 0, 480)).toEqual({ width: 480, height: 480 });
  });

  it("نسبت ابعاد حفظ می‌شود", () => {
    const box = fitImageBox(1600, 900, 480);
    // 480/1600 = 0.3 → 900*0.3 = 270
    expect(box).toEqual({ width: 480, height: 270 });
  });
});

describe("createImage", () => {
  it("★ از schema رد می‌شود", () => {
    const img = createImage({ fileId: "f_1", x: 0, y: 0, width: 200, height: 150, ...seed() });
    expect(() => hbElement.parse(img)).not.toThrow();
  });

  it("kind و نوع رندر هر دو image اند", () => {
    const img = createImage({ fileId: "f_1", x: 0, y: 0, width: 200, height: 150, ...seed() });
    expect(img.type).toBe("image");
    expect(getKind(img)).toBe("image");
  });

  it("★ به fileId ارجاع می‌دهد و باینری ندارد", () => {
    const img = createImage({ fileId: "f_abc", x: 0, y: 0, width: 200, height: 150, ...seed() });
    expect((img as { fileId: string }).fileId).toBe("f_abc");
    expect("dataURL" in img).toBe(false);
    expect("data" in img).toBe(false);
  });

  it("★ پیش‌فرض pending است تا placeholder نشان داده شود", () => {
    const img = createImage({ fileId: "f_1", x: 0, y: 0, width: 10, height: 10, ...seed() });
    expect((img as { status: string }).status).toBe("pending");
  });

  it("status صریح رعایت می‌شود", () => {
    const img = createImage({
      fileId: "f_1",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      status: "saved",
      ...seed(),
    });
    expect((img as { status: string }).status).toBe("saved");
  });

  it("حاشیه و پس‌زمینه شفاف است — تصویر خودش پیکسل است", () => {
    const img = createImage({ fileId: "f_1", x: 0, y: 0, width: 10, height: 10, ...seed() });
    expect(img.strokeColor).toBe("transparent");
    expect(img.backgroundColor).toBe("transparent");
  });

  it("scale پیش‌فرض [1,1] و crop اولیه null است", () => {
    const img = createImage({ fileId: "f_1", x: 0, y: 0, width: 10, height: 10, ...seed() });
    expect((img as { scale: [number, number] }).scale).toEqual([1, 1]);
    expect((img as { crop: unknown }).crop).toBeNull();
  });
});
