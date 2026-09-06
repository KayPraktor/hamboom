import type { PaymentGateway, UnverifiedPayment } from "./gateway.ts";

/**
 * آشتی‌دهی — منطقِ **خالصِ** تصمیم (M4 فاز ۷؛ [ADR-014](../../../ARCHITECTURE_DECISIONS.md#adr-014)
 * قاعده ۳، [ADR-051](../../../ARCHITECTURE_DECISIONS.md#adr-051)،
 * [ADR-056](../../../ARCHITECTURE_DECISIONS.md#adr-056)).
 *
 * ★★ **چرا خالص:** تصمیمِ «سراغِ کدام ردیف برویم» تنها جای این ماژول است که می‌شود بدونِ
 * Postgres و بدونِ درگاه اثبات کرد. اجرا (`settlePayment`، UPDATE، تماس با درگاه) در
 * `apps/api/src/services/reconcile.ts` است؛ این فایل هیچ I/O ندارد و هیچ `new Date()`
 * صدا نمی‌زند — لحظه‌ی مرجع **پارامتر** است، مثلِ [`period.ts`](./period.ts).
 *
 * ⚠️ **این تابع چیزی را «شکست‌خورده» اعلام نمی‌کند مگر آنکه یک‌بار از درگاه پرسیده باشیم.**
 * قاعده‌ی مرکزیِ ADR-056 همین است و دلیلش یک باگِ واقعیِ فاز ۵ است: ردیفی که `failed` شود
 * از ایندکسِ `payments_pending_idx` بیرون می‌افتد و **دیگر هیچ‌کس سراغش نمی‌رود** — یعنی اگر
 * پولش گرفته شده باشد، برای همیشه گم است.
 */

/** ردیفِ `pending`ی که sweep می‌بیند — فقط آنچه برای تصمیم لازم است. */
export interface PendingPaymentSnapshot {
  id: string;
  /** `null` یعنی هرگز به درگاه نرسید **یا** بینِ رسیدن و ذخیره‌شدن سقوط کردیم. */
  authority: string | null;
  amountRial: number;
  requestedAt: Date;
  /** آخرین کدِ شکستِ ثبت‌شده. `null` یعنی **هنوز یک‌بار هم نپرسیده‌ایم**. */
  failureCode: string | null;
}

export interface SweepPolicy {
  /** لحظه‌ی مرجع — پارامتر است، نه `new Date()`. */
  now: Date;
  /** زیرِ این سن اصلاً دست نمی‌زنیم؛ کاربر ممکن است همین حالا روی صفحه‌ی بانک باشد. */
  staleAfterMs: number;
  /** بالای این سن ردیف باطل می‌شود — **ولی فقط اگر قبلاً پرسیده باشیم**. */
  expireAfterMs: number;
}

export type SweepAction = "skip" | "verify" | "orphan" | "expire";

export interface SweepDecision {
  paymentId: string;
  action: SweepAction;
  /** دلیلِ ماشین‌خوان — در گزارشِ اجرا چاپ می‌شود. */
  reason: "tooYoung" | "askGateway" | "noAuthority" | "askedAndAged";
  ageMs: number;
}

/**
 * تصمیمِ هر ردیفِ `pending` — یک نردبانِ چهارپله‌ای، به همین ترتیب.
 *
 * ۱. **جوان** ⇒ دست نزن. verify روی کسی که هنوز روی صفحه‌ی بانک است `-51` می‌گیرد و
 *    فقط یک `failure_code`ِ گمراه‌کننده ثبت می‌کند.
 * ۲. **بدونِ authority** ⇒ `orphan`. این ردیف **قابلِ verify نیست** (چیزی برای پرسیدن
 *    نداریم) ولی ممکن است پولش گرفته شده باشد ⇒ هرگز خودکار `failed` نمی‌شود.
 * ۳. **کهنه و قبلاً پرسیده‌شده** ⇒ `expire`.
 * ۴. وگرنه ⇒ `verify`.
 */
export function planSweep(
  rows: readonly PendingPaymentSnapshot[],
  policy: SweepPolicy,
): SweepDecision[] {
  if (policy.staleAfterMs < 0 || policy.expireAfterMs < 0) {
    throw new RangeError("آستانه‌های sweep نمی‌توانند منفی باشند.");
  }
  // ★ اگر انقضا زودتر از کهنگی بیفتد، ردیف در همان لحظه‌ای که از «جوان» بیرون می‌آید
  //   **بدونِ حتی یک بار پرسیدن** باطل می‌شود — دقیقاً چیزی که قاعده‌ی ADR-056 ممنوع کرده.
  if (policy.expireAfterMs <= policy.staleAfterMs) {
    throw new RangeError(
      `expireAfterMs (${policy.expireAfterMs}) باید بزرگ‌تر از staleAfterMs (${policy.staleAfterMs}) باشد، ` +
        "وگرنه پرداخت پیش از آنکه یک‌بار از درگاه پرسیده شود باطل می‌شود (ADR-056).",
    );
  }

  return rows.map((row) => {
    const ageMs = policy.now.getTime() - row.requestedAt.getTime();
    if (ageMs < policy.staleAfterMs) {
      return { paymentId: row.id, action: "skip", reason: "tooYoung", ageMs };
    }
    if (row.authority === null) {
      return { paymentId: row.id, action: "orphan", reason: "noAuthority", ageMs };
    }
    if (ageMs >= policy.expireAfterMs && row.failureCode !== null) {
      return { paymentId: row.id, action: "expire", reason: "askedAndAged", ageMs };
    }
    return { paymentId: row.id, action: "verify", reason: "askGateway", ageMs };
  });
}

/**
 * تصمیمِ **فرزندخواندگیِ** یک authorityِ گم‌شده برای ردیفِ یتیم.
 *
 * `adopt` یعنی «این authority مالِ همین ردیف است»؛ `refuse` یعنی «نمی‌دانم» — و
 * نمی‌دانم اینجا **باید** به دستِ آدم برسد، نه به حدس.
 */
export type AdoptionDecision =
  | { paymentId: string; action: "adopt"; authority: string }
  | {
      paymentId: string;
      action: "refuse";
      reason: "noCandidate" | "manyCandidates" | "manyOrphans";
    };

/**
 * ★★ **پنجره‌ی سقوطِ authority** — ارثیه‌ی ثبت‌شده‌ی فاز ۵٫۹، این‌جا بسته می‌شود.
 *
 * بینِ لحظه‌ای که درگاه authority را می‌سازد و لحظه‌ای که ما روی ردیف می‌نشانیمش یک
 * پنجره‌ی کوچک هست. اگر پروسه دقیقاً آن‌جا بمیرد، کاربر می‌تواند **پول بدهد** در حالی که
 * ما هیچ شناسه‌ای برای پرسیدن نداریم: ردیف `pending` با `authority IS NULL`.
 *
 * تنها راهِ بازیابی، فهرستِ «پرداخت‌شده ولی verify‌نشده»ی خودِ درگاه است
 * (`unVerified.json` در زرین‌پال). ولی آن فهرست **شناسه‌ی سفارشِ ما را ندارد** — فقط
 * authority و مبلغ. پس تطبیق ذاتاً حدسی است و باید قاعده‌ی سخت داشته باشد:
 *
 * ★ **فقط وقتی دقیقاً یک یتیم با آن مبلغ داریم و دقیقاً یک نامزدِ بی‌صاحب با همان مبلغ.**
 * هر ابهامی ⇒ `refuse`. یک تطبیقِ اشتباه یعنی اشتراکِ تیمِ الف با پولِ تیمِ ب فعال شود —
 * خطایی که هیچ لاگی بعداً پیدایش نمی‌کند.
 *
 * ⚠️ `knownAuthorities` باید **همه‌ی** authorityهای ثبت‌شده‌ی ما باشد، نه فقط pendingها:
 * یک authorityِ متعلق به پرداختِ تسویه‌شده‌ی دیگری هرگز نباید دوباره فرزندخوانده شود.
 */
export function matchOrphans(
  orphans: readonly PendingPaymentSnapshot[],
  unverified: readonly UnverifiedPayment[],
  knownAuthorities: ReadonlySet<string>,
): AdoptionDecision[] {
  for (const orphan of orphans) {
    if (orphan.authority !== null) {
      // یک ردیفِ authorityدار در فهرستِ یتیم‌ها یعنی فراخوان اشتباه فیلتر کرده؛ نشستنِ
      // authorityِ تازه رویش، پیوندِ واقعیِ آن پرداخت را **پاک** می‌کند.
      throw new RangeError(`پرداختِ «${orphan.id}» یتیم نیست (authority دارد).`);
    }
  }

  const orphansPerAmount = new Map<number, number>();
  for (const orphan of orphans) {
    orphansPerAmount.set(orphan.amountRial, (orphansPerAmount.get(orphan.amountRial) ?? 0) + 1);
  }

  const candidatesPerAmount = new Map<number, string[]>();
  for (const entry of unverified) {
    if (knownAuthorities.has(entry.authority)) continue; // صاحب دارد
    const list = candidatesPerAmount.get(entry.amountRial) ?? [];
    list.push(entry.authority);
    candidatesPerAmount.set(entry.amountRial, list);
  }

  return orphans.map((orphan) => {
    if ((orphansPerAmount.get(orphan.amountRial) ?? 0) > 1) {
      return { paymentId: orphan.id, action: "refuse", reason: "manyOrphans" };
    }
    const candidates = candidatesPerAmount.get(orphan.amountRial) ?? [];
    if (candidates.length === 0) {
      return { paymentId: orphan.id, action: "refuse", reason: "noCandidate" };
    }
    if (candidates.length > 1) {
      return { paymentId: orphan.id, action: "refuse", reason: "manyCandidates" };
    }
    return { paymentId: orphan.id, action: "adopt", authority: candidates[0]! };
  });
}

/** آیا این درگاه فهرستِ «پرداخت‌شده ولی verify‌نشده» را می‌دهد؟ (متدِ اختیاریِ پورت) */
export function supportsUnverifiedList(
  gateway: PaymentGateway,
): gateway is PaymentGateway & Required<Pick<PaymentGateway, "listUnverified">> {
  return typeof gateway.listUnverified === "function";
}
