import { describe, expect, it } from "vitest";

import { sniffMime } from "./sniff.ts";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
// "RIFF" + size(4) + "WEBP"
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const svgXml = new TextEncoder().encode('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const svgBare = new TextEncoder().encode('   <svg width="10" height="10"></svg>');

describe("sniffMime", () => {
  it.each([
    ["png", png, "image/png"],
    ["jpeg", jpeg, "image/jpeg"],
    ["gif", gif, "image/gif"],
    ["webp", webp, "image/webp"],
    ["svg (اعلانِ xml)", svgXml, "image/svg+xml"],
    ["svg (خام، با فاصله‌ی ابتدایی)", svgBare, "image/svg+xml"],
  ] as const)("%s را می‌شناسد", (_label, bytes, mime) => {
    expect(sniffMime(bytes)).toBe(mime);
  });

  it("★ فایلِ اجرایی (MZ/PE) که ادعای تصویر دارد → null", () => {
    expect(sniffMime(new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]))).toBeNull();
  });

  it("RIFF بدونِ WEBP (مثلاً WAV) → null — نه هر RIFFی", () => {
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
    expect(sniffMime(wav)).toBeNull();
  });

  it("بایت‌های تصادفی/کوتاه/خالی → null", () => {
    expect(sniffMime(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(sniffMime(new Uint8Array())).toBeNull();
  });
});
