import type { HbElement } from "@hamboom/shared-types";

import { HB_TYPO } from "../theme/tokens";
import { getKind } from "./mapping";

/**
 * عملیات استایل روی انتخاب — گام ۳٫۳.
 *
 * ── چرا اینجا و نه در کامپوننت پنل ────────────────────────────────────
 *
 * پنل استایل (گام ۴٫۳) فقط یک رابط است؛ همان عملیات از منوی راست‌کلیک،
 * میانبر کیبورد و بعداً از قالب‌ها هم صدا زده می‌شود. اگر منطق داخل کامپوننت
 * باشد، سه نسخه‌ی واگرا می‌شود — همان اتفاقی که برای رنگ استیکی نیفتاد چون
 * `applyStickyPalette` از اول اینجا بود.
 *
 * همه‌ی توابع **خالص** اند: آرایه می‌گیرند، آرایه‌ی جدید می‌دهند، و اگر
 * چیزی عوض نشود همان مرجع قبلی را برمی‌گردانند تا رندر بی‌دلیل اجرا نشود.
 */

/** خصوصیاتی که پنل استایل می‌تواند عوض کند. */
export interface StylePatch {
  strokeColor?: string;
  backgroundColor?: string;
  strokeWidth?: number;
  strokeStyle?: "solid" | "dashed" | "dotted";
  opacity?: number;
  fontSize?: number;
  roundness?: { type: 2 | 3; value?: number } | null;
}

/** آیا این عنصر متن است؟ (بدون شرط روی `type` بیرون از mapping — ADR-010) */
function isTextElement(element: HbElement): boolean {
  return getKind(element) === "text";
}

/**
 * اعمال استایل روی عناصر انتخاب‌شده.
 *
 * `fontSize` فقط روی عناصر متنی اعمال می‌شود و در بازه‌ی مجاز کلمپ می‌شود —
 * وگرنه یک اسلایدر می‌تواند متنی با اندازه‌ی ۰ یا ۹۹۹ بسازد که رندر نمی‌شود.
 */
export function applyStyle(
  elements: HbElement[],
  selectedIds: ReadonlySet<string>,
  patch: StylePatch,
): HbElement[] {
  if (selectedIds.size === 0) return elements;

  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return elements;

  let changed = false;

  const next = elements.map((element) => {
    if (!selectedIds.has(element.id)) return element;

    const updates: Record<string, unknown> = {};
    for (const [key, value] of entries) {
      // اندازه‌ی فونت روی یک مستطیل بی‌معنی است و عنصر را از schema می‌اندازد.
      if (key === "fontSize") {
        if (!isTextElement(element)) continue;
        updates[key] = Math.min(
          HB_TYPO.stickyFontRange.max,
          Math.max(HB_TYPO.stickyFontRange.min, value as number),
        );
        continue;
      }
      updates[key] = value;
    }

    if (Object.keys(updates).length === 0) return element;

    changed = true;
    return { ...element, ...updates, version: element.version + 1 } as HbElement;
  });

  return changed ? next : elements;
}

/**
 * استایل مشترک یک انتخاب — برای نمایش در پنل.
 *
 * اگر همه‌ی عناصر مقدار یکسانی داشته باشند آن را برمی‌گرداند، وگرنه
 * `undefined` — که پنل باید به‌عنوان «مقادیر مختلط» نشان دهد، نه اینکه مقدار
 * اولین عنصر را جا بزند و با اولین کلیک بقیه را هم به آن مقدار ببرد.
 */
export function commonStyle(elements: HbElement[], selectedIds: ReadonlySet<string>): StylePatch {
  const selected = elements.filter((element) => selectedIds.has(element.id));
  if (selected.length === 0) return {};

  const pick = <T>(read: (element: HbElement) => T): T | undefined => {
    const first = read(selected[0]!);
    return selected.every((element) => read(element) === first) ? first : undefined;
  };

  const texts = selected.filter(isTextElement);

  return {
    strokeColor: pick((element) => element.strokeColor),
    backgroundColor: pick((element) => element.backgroundColor),
    strokeWidth: pick((element) => element.strokeWidth),
    strokeStyle: pick((element) => element.strokeStyle),
    opacity: pick((element) => element.opacity),
    fontSize:
      texts.length > 0
        ? (() => {
            const first = (texts[0] as unknown as { fontSize: number }).fontSize;
            return texts.every((t) => (t as unknown as { fontSize: number }).fontSize === first)
              ? first
              : undefined;
          })()
        : undefined,
  };
}

/**
 * شناسه‌ی عناصر انتخاب‌شده به‌علاوه‌ی متن‌های مقیدشان.
 *
 * بدون این، تغییر رنگ روی یک شکل، متن داخلش را جا می‌گذارد — چون کاربر
 * ظرف را انتخاب کرده نه متن را، ولی از دید او یک چیزند.
 */
export function withBoundElements(
  elements: HbElement[],
  selectedIds: ReadonlySet<string>,
): Set<string> {
  const result = new Set(selectedIds);
  for (const element of elements) {
    if (!selectedIds.has(element.id)) continue;
    for (const bound of element.boundElements ?? []) result.add(bound.id);
  }
  return result;
}
