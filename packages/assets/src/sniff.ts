import type { HbAllowedImageMime } from "@hamboom/shared-types";

/**
 * تشخیصِ نوعِ **واقعیِ** فایل از magic-bytes — نه از `Content-Type`ِ اعلامیِ کلاینت.
 *
 * ★ چرا لازم است: `commit` نباید به ادعای کلاینت اعتماد کند. یک فایلِ اجراییِ نام‌گذاری‌شده
 * به‌عنوان `image/png` باید همین‌جا رد شود، نه اینکه به مرورگرِ بیننده برسد. `null` یعنی
 * «هیچ‌کدام از نوع‌های مجاز نیست».
 *
 * SVG متن است نه باینری، پس magic-byte ندارد؛ ابتدای فایل به‌صورت متن بررسی می‌شود.
 */
export function sniffMime(bytes: Uint8Array): HbAllowedImageMime | null {
  const b = bytes;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return "image/png";
  }

  // JPEG: FF D8 FF
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "image/jpeg";
  }

  // GIF: "GIF8" (87a/89a)
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    return "image/gif";
  }

  // WEBP: "RIFF" ....(size).... "WEBP"
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return "image/webp";
  }

  // SVG: متن است — ابتدای فایل باید `<svg` یا یک اعلانِ XML شاملِ `<svg` باشد.
  if (looksLikeSvg(b)) return "image/svg+xml";

  return null;
}

/** نمونه‌ی ابتداییِ فایل را به‌صورت UTF-8 می‌خواند (BOM خودکار حذف می‌شود) و دنبالِ `<svg` می‌گردد. */
function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, 512))
    .trimStart()
    .toLowerCase();
  return head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"));
}
