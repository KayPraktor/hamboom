import type { BillingPeriod, InvoiceLineItem, Plan } from "@hamboom/shared-types";

/**
 * ریاضیِ پول — ریالِ **صحیح**، یک قاعده‌ی گِردکردن
 * ([ADR-052](../../../ARCHITECTURE_DECISIONS.md#adr-052)، [ADR-015](../../../ARCHITECTURE_DECISIONS.md#adr-015)).
 *
 * ★★ **چرا یک تابع، و نه دو:** `computeCharge` **هم** مبلغی که به درگاه می‌رود را می‌دهد
 * **هم** ارقامِ فاکتور را. اگر این دو مسیرِ جدا داشته باشند، کافی است یکی `round` بزند و
 * دیگری `floor` تا مبلغِ ارسالی به verify یک ریال با `payments.amount_rial` فرق کند —
 * و probeِ گام ۱٫۱ با تماسِ زنده ثابت کرد که نتیجه‌اش خطای **`-50`**ِ زرین‌پال است، یعنی
 * یک مشتریِ **واقعاً پرداخت‌کرده** `verify_failed` ثبت می‌شود.
 *
 * probeِ گام ۱٫۵ یک خرابیِ بدتر هم پیدا کرد که این‌جا بسته شده: مسیرِ دومِ بدونِ clamp،
 * برای کوپنی بزرگ‌تر از مبلغ، عددِ **منفی** (`−۴۴۰٬۰۰۰`) تولید کرد — یعنی مبلغِ منفی به درگاه.
 */

/**
 * ★ **تنها قاعده‌ی گِردکردنِ پروژه.** ضرب **قبل از** تقسیم (تا خطای ممیزِ شناور جمع نشود)
 * و `Math.round` (نه `floor`) تا سوگیریِ سیستماتیک به نفعِ یک طرف نداشته باشیم.
 *
 * هرجای دیگری که درصدی از یک مبلغ حساب شود و از این عبور نکند، یک قاعده‌ی **دوم** ساخته
 * و همان خرابیِ بالا را برگردانده است.
 */
export function percentOfRial(baseRial: number, percent: number): number {
  return Math.round((baseRial * percent) / 100);
}

/** تخفیفِ کوپن — یکی از دو شکل، هرگز هر دو. */
export type CouponEffect =
  { kind: "percent"; percentOff: number } | { kind: "amount"; amountOffRial: number };

export interface ChargeInput {
  plan: Pick<Plan, "code" | "name" | "priceMonthlyRial" | "priceYearlyRial">;
  period: BillingPeriod;
  seats: number;
  coupon: CouponEffect | null;
  /** درصدِ VATِ **در لحظه‌ی صدور**. صفر مجاز و پیش‌فرضِ توسعه است (ADR-052/M4-D6). */
  vatPercent: number;
}

export interface Charge {
  subtotalRial: number;
  discountRial: number;
  vatRial: number;
  totalRial: number;
  /** نرخی که این فاکتور با آن صادر شد — روی خودِ فاکتور **منجمد** می‌شود، نه بازمحاسبه. */
  vatPercent: number;
  lineItems: InvoiceLineItem[];
}

/** قیمتِ واحدِ یک دوره. */
export function unitPriceRial(plan: ChargeInput["plan"], period: BillingPeriod): number {
  return period === "yearly" ? plan.priceYearlyRial : plan.priceMonthlyRial;
}

export class InvalidChargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidChargeError";
  }
}

/**
 * ★★ **یک منبع برای مبلغِ درگاه و ارقامِ فاکتور.**
 *
 * `totalRial` عمداً **مشتق** است (`taxable + vat`) نه محاسبه‌ی مستقل — همین یک خط رابطه‌ی
 * `subtotal − discount + vat === total` را **ساختاراً** تضمین می‌کند، نه با دقتِ نویسنده.
 */
export function computeCharge(input: ChargeInput): Charge {
  const { plan, period, seats, coupon, vatPercent } = input;

  if (!Number.isSafeInteger(seats) || seats < 1) {
    throw new InvalidChargeError(`تعدادِ صندلی باید عددِ صحیحِ مثبت باشد، نه «${String(seats)}».`);
  }
  if (!Number.isSafeInteger(vatPercent) || vatPercent < 0) {
    throw new InvalidChargeError(`درصدِ VAT باید صحیح و ≥ ۰ باشد، نه «${String(vatPercent)}».`);
  }

  const unit = unitPriceRial(plan, period);
  if (!Number.isSafeInteger(unit) || unit < 0) {
    throw new InvalidChargeError(
      `قیمتِ پلنِ «${plan.code}» عددِ ریالِ معتبر نیست: «${String(unit)}».`,
    );
  }

  const subtotalRial = unit * seats;

  let rawDiscount = 0;
  if (coupon?.kind === "percent") rawDiscount = percentOfRial(subtotalRial, coupon.percentOff);
  else if (coupon?.kind === "amount") rawDiscount = coupon.amountOffRial;

  // ★★ clampِ اجباری — یافته‌ی probeِ گام ۱٫۵: بدونِ این، کوپنی بزرگ‌تر از مبلغ
  //    مبلغِ **منفی** به درگاه می‌فرستد. تخفیف هرگز از خودِ مبلغ بیشتر نیست، و هرگز منفی.
  const discountRial = Math.min(Math.max(rawDiscount, 0), subtotalRial);

  const taxable = subtotalRial - discountRial;
  const vatRial = percentOfRial(taxable, vatPercent);
  const totalRial = taxable + vatRial;

  const periodLabel = period === "yearly" ? "سالانه" : "ماهانه";
  const lineItems: InvoiceLineItem[] = [
    {
      title: `${plan.name} — ${periodLabel}`,
      qty: seats,
      unitPriceRial: unit,
      totalRial: subtotalRial,
    },
  ];

  return { subtotalRial, discountRial, vatRial, totalRial, vatPercent, lineItems };
}

/**
 * ★ نگهبانِ مبلغی که به درگاه می‌رود.
 *
 * سقف و کفِ زرین‌پال با تماسِ زنده در گام ۱٫۱ اندازه‌گیری شدند: مبلغِ ۱۰۰ ریال خطای `-9`
 * گرفت و کف **۱۰۰۰ ریال** است؛ سقف طبقِ خطای `-41` صد میلیون تومان. این‌ها **سمتِ ما**
 * بررسی می‌شوند تا یک پلنِ بدپیکربندی در لایه‌ی خودمان بشکند، نه سرِ پرداختِ مشتری.
 */
export const GATEWAY_MIN_RIAL = 1_000;
export const GATEWAY_MAX_RIAL = 1_000_000_000;

export function assertGatewayAmount(amountRial: number): void {
  if (!Number.isSafeInteger(amountRial)) {
    throw new InvalidChargeError(`مبلغ باید عددِ صحیحِ امن باشد، نه «${String(amountRial)}» (P5).`);
  }
  if (amountRial < GATEWAY_MIN_RIAL) {
    throw new InvalidChargeError(
      `مبلغِ ${amountRial} ریال از کفِ درگاه (${GATEWAY_MIN_RIAL} ریال) کمتر است.`,
    );
  }
  if (amountRial > GATEWAY_MAX_RIAL) {
    throw new InvalidChargeError(
      `مبلغِ ${amountRial} ریال از سقفِ درگاه (${GATEWAY_MAX_RIAL} ریال) بیشتر است.`,
    );
  }
}
