import { hbAppState, type HbAppState } from "@hamboom/shared-types";
import type * as Y from "yjs";

import { writeInto } from "./value-codec.ts";

/**
 * وضعیتِ **مشترکِ بورد** — [PLAN بخش ۷٫۱](../../../PLAN.md).
 *
 * ── ★ خط قرمز: viewportِ شخصی اینجا راه ندارد ─────────────────────────
 *
 * `scrollX`/`scrollY`/`zoom`/`selectedElementIds` وضعیتِ **یک کاربر**اند، نه
 * وضعیتِ بورد. اگر داخلِ سند بنشینند، هر بار که یکی اسکرول کند نمای **همه**
 * می‌پرد — و چون CRDT است، همگرا هم می‌شود: همه به یک نما می‌رسند و هیچ‌کس
 * نمی‌فهمد چرا. جایشان کانالِ awareness است
 * ([ADR-022](../../../ARCHITECTURE_DECISIONS.md#adr-022))، که ذخیره نمی‌شود.
 *
 * فهرستِ کلیدهای مجاز از **خودِ schema** خوانده می‌شود، نه یک کپیِ دستی: اگر
 * روزی `shared-types` کلیدی اضافه کند، اینجا خودبه‌خود دنبال می‌کند.
 */

/** کلیدهای مجازِ `appState` — مستقیماً از `hbAppState`. */
export const SHARED_APP_STATE_KEYS: ReadonlySet<string> = new Set(Object.keys(hbAppState.shape));

/**
 * وضعیتِ مشترکِ پیش‌فرضِ بورد.
 *
 * عمداً برابرِ `DEFAULT_APP_STATE`ِ [`local-adapter`](../../canvas-core/src/sync/local-adapter.ts)ِ
 * M1 است تا بومِ متصل و بومِ آفلاین یک‌جور شروع شوند. اگر واگرا شوند، «بازکردنِ
 * بورد» و «کار بدونِ سرور» دو ظاهرِ متفاوت پیدا می‌کنند.
 */
export const DEFAULT_APP_STATE: HbAppState = {
  viewBackgroundColor: "#ffffff",
  gridSize: 20,
  gridEnabled: false,
  snapToObjects: true,
  frameRendering: { enabled: true, name: true, outline: true, clip: true },
};

/**
 * به‌روزرسانیِ **جزئیِ** وضعیتِ مشترک.
 *
 * ★ برخلافِ عنصر، اینجا patch است نه شیءِ کامل: کاربر «گرید را روشن کرد»
 * می‌فرستد، نه کلِ وضعیت. پس کلیدهای نیامده **حذف نمی‌شوند** — وگرنه هر تغییرِ
 * کوچک بقیه‌ی تنظیماتِ بورد را پاک می‌کرد.
 *
 * کلیدِ ناشناخته **خطا می‌دهد**، بی‌صدا نادیده گرفته نمی‌شود: بی‌صدا یعنی یک
 * `zoom: 3` که هیچ اثری ندارد، و کسی که آن را نوشته ساعت‌ها دنبالِ دلیلش می‌گردد.
 */
export function writeAppState(appState: Y.Map<unknown>, patch: Partial<HbAppState>): void {
  const unknown = Object.keys(patch).filter((key) => !SHARED_APP_STATE_KEYS.has(key));
  if (unknown.length > 0) {
    throw new Error(
      `کلیدِ غیرمجاز در appState: ${unknown.join("، ")}. ` +
        `وضعیتِ شخصی (نما، بزرگ‌نمایی، انتخاب) داخلِ سند نمی‌رود — کانالِ awareness جایش است (ADR-022). ` +
        `کلیدهای مجاز: ${[...SHARED_APP_STATE_KEYS].join("، ")}.`,
    );
  }
  writeInto(appState, patch as Record<string, unknown>, { prune: false });
}

/**
 * وضعیتِ مشترکِ بورد، همیشه **کامل و معتبر**.
 *
 * ریشه‌ی خالی یعنی «هنوز کسی چیزی عوض نکرده»، نه «بوردِ بدونِ appState».
 *
 * ★ کلیدهای ناشناخته‌ی داخلِ سند **نادیده گرفته می‌شوند**. این نگهبانِ سمتِ
 * خواندن است و لازم هم هست: `writeAppState` جلوی کدِ **خودمان** را می‌گیرد، ولی
 * یک کلاینتِ قدیمی یا بدرفتار می‌تواند مستقیم روی ریشه بنویسد. آن‌وقت هم نمای
 * کاربر نمی‌پرد.
 */
export function readAppState(appState: Y.Map<unknown>): HbAppState {
  const stored = appState.toJSON() as Record<string, unknown>;
  const known: Record<string, unknown> = {};
  for (const key of SHARED_APP_STATE_KEYS) {
    if (stored[key] !== undefined) known[key] = stored[key];
  }
  return { ...DEFAULT_APP_STATE, ...known } as HbAppState;
}
