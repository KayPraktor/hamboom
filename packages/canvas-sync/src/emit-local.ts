import type { ElementChangeSet } from "@hamboom/canvas-core/sync";
import type { HbElement } from "@hamboom/shared-types";

/**
 * مسیرِ **محلی** — از `emitElementChanges` تا یک تراکنشِ Yjs.
 *
 * ── جدولِ فرکانس ([PLAN بخش ۷٫۴](../../../PLAN.md)) ────────────────────
 *
 * | رویداد | قاعده |
 * |---|---|
 * | ساخت / حذف / تغییرِ استایل | **فوری** |
 * | درگ | throttle ۵۰ms + commit نهایی در drop |
 * | تایپ در متن | debounce ۱۵۰ms |
 * | مکان‌نما · نما | ۴۰ms · ۱۰۰ms (کانالِ awareness — گام ۳٫۵) |
 * | استروکِ قلم | فقط **یک** commit در `pointerup` (ADR-022) |
 *
 * ── ⚠️ چرا اینجا و نه در بوم ──────────────────────────────────────────
 *
 * [`sync/README.md`](../../canvas-core/src/sync/README.md) می‌گوید throttle کارِ
 * **بوم** است، چون بوم می‌داند یک ژست کی تمام می‌شود. آن حرف درست است و عوض
 * نشده — ولی M1 هیچ‌جا پیاده‌اش نکرد و ابزارهای محصولی هنوز به آداپتور وصل
 * نیستند. پس تا M3، **صاحبِ این قاعده اینجاست**، و به‌جای «کی ژست تمام می‌شود»
 * از `gestureId`ِ خودِ قرارداد استفاده می‌کند.
 *
 * ★ اگر روزی بوم هم throttle کند، این لایه بی‌ضرر است: throttle روی جریانی که
 * از قبل throttle شده فقط هیچ کاری نمی‌کند.
 */

/** ⚠️ منبعِ **واحدِ** اعداد. هیچ‌جای دیگری این ثابت‌ها تکرار نشود. */
export const HB_THROTTLE = {
  /** درگ و هر به‌روزرسانیِ پیوسته‌ی یک ژست. */
  gestureMs: 50,
  /** تایپ در متن — debounce، نه throttle. */
  textDebounceMs: 150,
  /** مکان‌نما — کانالِ awareness (گام ۳٫۵). */
  pointerMs: 40,
  /** نما — کانالِ awareness (گام ۳٫۵). */
  viewportMs: 100,
} as const;

/**
 * originِ تراکنش‌های **این کاربر**، حاملِ `gestureId`.
 *
 * ★ **کلاس است نه رشته**، و این عمدی است: `Y.UndoManager` علاوه بر تطبیقِ
 * مقداری، originی را هم ردیابی می‌کند که **سازنده‌اش** در `trackedOrigins` باشد.
 * پس گام ۳٫۴ می‌تواند `trackedOrigins: new Set([LocalOrigin])` بدهد و هر ژستی با
 * هر `gestureId` را بگیرد — با یک رشته‌ی ثابت، `gestureId` جایی برای نشستن
 * نداشت.
 */
export class LocalOrigin {
  constructor(readonly gestureId?: string) {}
}

/** جایی که تغییرِ نهایی نوشته می‌شود، به‌علاوه‌ی دو پرسش از وضعیتِ فعلیِ سند. */
export interface EmitSink {
  /** نوشتنِ واقعی — **یک** تراکنش برای کلِ changeset. */
  commit(changes: ElementChangeSet): void;
  /** آیا این شناسه از قبل در سند هست؟ (تشخیصِ **ساخت** از جابه‌جایی) */
  has(id: string): boolean;
  /** `originalText`ِ فعلیِ سند — برای تشخیصِ «فقط متن عوض شده». */
  textOf(id: string): string | undefined;
}

export interface EmitScheduler {
  push(changes: ElementChangeSet): void;
  /** نوشتنِ فوریِ هرچه در صف است. */
  flush(): void;
  /** ★ **flush می‌کند، دور نمی‌ریزد** — وگرنه آخرین ویرایشِ کاربر گم می‌شود. */
  dispose(): void;
}

type Mode = "gesture" | "text";

/**
 * آیا این تغییر «کاربر دارد تایپ می‌کند» است؟
 *
 * ملاک عمداً **ساده** است: `originalText` نسبت به سند عوض شده باشد. وسوسه‌اش
 * این بود که «هیچ فیلدِ دیگری عوض نشده باشد» را هم شرط کنیم، ولی تایپ در یک
 * استیکیِ autoFit `width`/`height` را هم عوض می‌کند (و هر نوشتنی
 * `version`/`versionNonce` را) — با آن شرطِ سخت‌گیرانه، تایپ **هرگز** debounce
 * نمی‌شد و ۱۵۰ms فقط روی کاغذ می‌مانْد.
 */
function isTextOnly(element: HbElement, currentText: string | undefined): boolean {
  if (currentText === undefined) return false;
  const next = (element as { originalText?: string }).originalText;
  if (typeof next !== "string" || next === currentText) return false;
  return true;
}

export interface EmitSchedulerOptions {
  gestureMs?: number;
  textDebounceMs?: number;
}

/**
 * صف‌بندی و ادغامِ تغییراتِ محلی.
 *
 * ── چرا trailing و نه leading ─────────────────────────────────────────
 *
 * با trailingِ خالص، هر پنجره‌ی ۵۰ms **حداکثر یک** commit می‌دهد؛ یک درگِ
 * ۲ثانیه‌ای یعنی ≤۴۰ update، دقیقاً همان سقفی که PLAN ۷٫۴ می‌خواهد. با
 * leading+trailing یکی بیشتر می‌شد و سقف می‌شکست.
 *
 * ادغام با **شناسه** انجام می‌شود، نه با صف: از هر عنصر فقط آخرین حالتش
 * می‌مانَد. برای همین «آخرین update دقیقاً مختصاتِ نهایی است».
 */
export function createEmitScheduler(
  sink: EmitSink,
  options: EmitSchedulerOptions = {},
): EmitScheduler {
  const gestureMs = options.gestureMs ?? HB_THROTTLE.gestureMs;
  const textDebounceMs = options.textDebounceMs ?? HB_THROTTLE.textDebounceMs;

  /** آخرین حالتِ هر عنصرِ منتظر. */
  const pending = new Map<string, HbElement>();
  let pendingGesture: string | undefined;
  let pendingOrigin: ElementChangeSet["origin"] = "local-user";
  let mode: Mode = "gesture";
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function flush(): void {
    clearTimer();
    if (pending.size === 0) return;
    const upserted = [...pending.values()];
    const gestureId = pendingGesture;
    const origin = pendingOrigin;
    pending.clear();
    pendingGesture = undefined;
    sink.commit({ upserted, deleted: [], origin, ...(gestureId ? { gestureId } : {}) });
  }

  function schedule(next: Mode): void {
    // تغییرِ حالت وسطِ کار: صفِ قبلی با قاعده‌ی خودش نوشته شود.
    if (timer !== null && next !== mode) flush();
    mode = next;
    if (next === "text") clearTimer(); // debounce → تایمر ریست می‌شود
    if (timer === null) {
      timer = setTimeout(flush, next === "text" ? textDebounceMs : gestureMs);
    }
  }

  return {
    push(changes) {
      // ── فوری: حذف، ساخت، یا تغییرِ بی‌ژست ───────────────────────────
      const isCreation = changes.upserted.some((element) => !sink.has(element.id));
      if (changes.deleted.length > 0 || isCreation || !changes.gestureId) {
        flush();
        sink.commit(changes);
        return;
      }

      // مرزِ ژست — ژستِ قبلی همان‌جا بسته می‌شود («commit نهایی در drop»).
      if (pendingGesture !== undefined && pendingGesture !== changes.gestureId) flush();

      pendingGesture = changes.gestureId;
      pendingOrigin = changes.origin;
      const textOnly = changes.upserted.every((element) =>
        isTextOnly(element, sink.textOf(element.id)),
      );
      for (const element of changes.upserted) pending.set(element.id, element);
      schedule(textOnly ? "text" : "gesture");
    },

    flush,

    dispose() {
      flush();
    },
  };
}
