import * as Y from "yjs";

import { isPlainObject } from "./value-codec.ts";

/**
 * نگهبانِ «**هیچ باینری داخل `Y.Doc` نمی‌رود**» — [PLAN بخش ۷٫۱](../../../PLAN.md).
 *
 * ── چرا این یک قاعده‌ی نوشتاری نیست بلکه کدِ اجراشدنی است ──────────────
 *
 * Yjs `Uint8Array` را **می‌پذیرد**. یعنی این قاعده هیچ سدِ طبیعی ندارد و اولین
 * باری که کسی برای «راحتی» یک thumbnail را داخل عنصر بگذارد، کار می‌کند — و از
 * آن لحظه هر بار sync، آن چند مگابایت بینِ **همه‌ی** کاربران رد و بدل می‌شود، در
 * هر ردیفِ `board_updates` می‌نشیند، و هرگز جمع نمی‌شود. باینری جای خودش را دارد:
 * Object Storage، با ارجاعِ `fileId` از سند ([ADR-009](../../../ARCHITECTURE_DECISIONS.md#adr-009)).
 *
 * دو مصرف‌کننده‌ی برنامه‌ریزی‌شده: تست‌های همین پکیج، و مرزِ بارگذاریِ سند در
 * سرور (گام ۴٫۲) که تنها جایی است که به سندِ آمده از دیتابیس اعتماد نمی‌کنیم.
 */

export class BinaryInDocumentError extends Error {
  readonly paths: readonly string[];

  constructor(paths: readonly string[]) {
    super(
      `مقدارِ باینری داخلِ سند پیدا شد (${paths.length} مورد): ${paths.join("، ")}. ` +
        `سند فقط متادیتا نگه می‌دارد؛ خودِ فایل در Object Storage است و با fileId ارجاع می‌شود.`,
    );
    this.name = "BinaryInDocumentError";
    this.paths = paths;
  }
}

function isBinary(value: unknown): boolean {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
  // `Blob` و `File` در Node ۲۴ و مرورگر هستند، ولی این پکیج نباید فرضش کند.
  if (typeof Blob !== "undefined" && value instanceof Blob) return true;
  return false;
}

function walk(value: unknown, path: string, found: string[]): void {
  if (isBinary(value)) {
    found.push(path);
    return;
  }
  // `Y.Text` همیشه متن است و `toJSON` روی متنِ بلند گران — واردش نمی‌شویم.
  if (value instanceof Y.Text) return;

  if (value instanceof Y.Map) {
    for (const [key, inner] of value.entries()) walk(inner, `${path}.${key}`, found);
    return;
  }
  if (value instanceof Y.Array) {
    value.toArray().forEach((inner, i) => walk(inner, `${path}[${i}]`, found));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((inner, i) => walk(inner, `${path}[${i}]`, found));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, inner] of Object.entries(value)) walk(inner, `${path}.${key}`, found);
  }
}

/**
 * مسیرِ هر مقدارِ باینری در سند — فهرستِ خالی یعنی سالم.
 *
 * ★ از `doc.share` می‌رود، نه از فهرستِ `DOC_ROOTS`: باینری می‌تواند از هر مسیری
 * وارد شود — `customData` یک عنصر، یا حتی یک ریشه‌ی ناشناخته که کلاینتِ دیگری
 * ساخته. بستنِ فقط درِ `assets`، در را نمی‌بندد.
 */
export function findBinaryValues(doc: Y.Doc): string[] {
  const found: string[] = [];
  for (const [name, root] of doc.share) walk(root, name, found);
  return found;
}

/**
 * همان جستجو روی یک مقدارِ سادهٔ **بیرون از سند** — برای بررسی **قبل از** نوشتن.
 *
 * جداکردنش از `findBinaryValues` عمدی است: آن یکی وقتی به درد می‌خورد که سند
 * از بیرون آمده (بارگذاری از دیتابیس)، این یکی وقتی که هنوز جلوی در ایستاده‌ایم.
 */
export function findBinaryIn(value: unknown, path = ""): string[] {
  const found: string[] = [];
  walk(value, path, found);
  return found;
}

/** همان، ولی به‌جای فهرست، خطا می‌دهد. */
export function assertNoBinary(doc: Y.Doc): void {
  const found = findBinaryValues(doc);
  if (found.length > 0) throw new BinaryInDocumentError(found);
}
