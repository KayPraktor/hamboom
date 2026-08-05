import { hbAsset, type HbAsset } from "@hamboom/shared-types";
import * as Y from "yjs";

import { findBinaryIn } from "./binary-guard.ts";
import { writeInto } from "./value-codec.ts";

/**
 * متادیتای دارایی در سند — `fileId → { key, bucket, mime, … }`
 * ([PLAN بخش ۷٫۱](../../../PLAN.md)).
 *
 * ⚠️ **باینری هرگز اینجا نمی‌آید.** خودِ فایل در Object Storage است و کلاینت با
 * `GET /api/v1/assets/:fileId` یک URL امضاشده می‌گیرد. نگهبانِ اجراشدنی در
 * [`binary-guard.ts`](binary-guard.ts).
 */

/**
 * نوشتنِ متادیتای یک دارایی.
 *
 * ★ **برخلافِ `writeElement` اینجا اعتبارسنجی می‌شود.** دلیلش هزینه است، نه
 * سلیقه: `writeElement` مسیرِ داغِ هر تیکِ درگ است (ده‌ها بار در ثانیه)، ولی
 * دارایی فقط یک بار هنگامِ آپلود نوشته می‌شود. `hbAsset.parse` هم شکل را تضمین
 * می‌کند و هم — چون zod کلیدهای ناشناخته را دور می‌ریزد — هر چیزِ اضافه‌ای که
 * صداکننده به آبجکت چسبانده باشد **قبل از رسیدن به سند** می‌افتد.
 *
 * بررسیِ صریحِ باینری با وجودِ parse هم انجام می‌شود: parse یک `Uint8Array` را در
 * فیلدِ ناشناخته بی‌صدا حذف می‌کند، و «بی‌صدا» چیزی است که این پروژه به آن اعتماد
 * نمی‌کند — بهتر است صداکننده خطا ببیند و بفهمد باینری را جای اشتباهی می‌فرستد.
 */
export function writeAsset(assets: Y.Map<unknown>, asset: HbAsset): void {
  const binary = findBinaryIn(asset, "asset");
  if (binary.length > 0) {
    throw new Error(
      `دارایی «${String((asset as { fileId?: unknown }).fileId)}» مقدارِ باینری دارد ` +
        `(${binary.join("، ")}). سند فقط متادیتا نگه می‌دارد — فایل به Object Storage می‌رود.`,
    );
  }

  const parsed = hbAsset.parse(asset);
  const existing = assets.get(parsed.fileId);
  let map: Y.Map<unknown>;
  if (existing instanceof Y.Map) {
    map = existing;
  } else {
    map = new Y.Map<unknown>();
    assets.set(parsed.fileId, map);
  }
  writeInto(map, parsed as unknown as Record<string, unknown>, { prune: true });
}

/** همه‌ی داراییِ سند، مرتب با `fileId` تا ترتیب قطعی بماند. */
export function readAssets(assets: Y.Map<unknown>): HbAsset[] {
  const result: HbAsset[] = [];
  for (const value of assets.values()) {
    result.push((value instanceof Y.Map ? value.toJSON() : value) as HbAsset);
  }
  return result.sort((a, b) => (a.fileId < b.fileId ? -1 : a.fileId > b.fileId ? 1 : 0));
}

/**
 * حذفِ متادیتای یک دارایی.
 *
 * حذفِ **سخت** است، برخلافِ عنصر: دارایی تاریخچه‌ی ویرایشِ کاربر نیست و undo روی
 * آن معنا ندارد. پاک‌سازیِ خودِ فایل در Object Storage کارِ M3 است.
 */
export function removeAsset(assets: Y.Map<unknown>, fileId: string): void {
  assets.delete(fileId);
}
