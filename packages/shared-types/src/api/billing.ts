import { z } from "zod";

import { isoDateTime, rial, uuid } from "./primitives.ts";

/**
 * قراردادِ پرداخت و اشتراک — [PLAN §۵٫۱](../../../../PLAN.md) بلوکِ «Billing»، فاز ۲ی M4
 * ([ADR-054](../../../../ARCHITECTURE_DECISIONS.md#adr-054)، تاییدِ دسته‌ایِ مالک M4-D2).
 *
 * ★ **هر فیلدِ پولی از `rial` می‌آید، نه `z.number()`ِ خام** — تا `.int()` یک‌بار نوشته شود و
 * فراموش‌شدنی نباشد (P5). و هیچ فیلدِ پاسخی `.optional()` نیست، فقط `.nullable()`.
 *
 * ⚠️ **`Coupon` عمداً اینجا نیست** (M4-D2b): شکلش در PLAN §۵٫۱ اصلاً وجود ندارد — فقط جدولش.
 * کوپن به‌صورتِ `couponCode` در بدنه‌ی checkout می‌رود و اثرش فقط به شکلِ `discountRial` روی
 * `Invoice` دیده می‌شود. افشای موجودی/سقفِ کوپن به کلاینت نه لازم است نه بی‌خطر.
 */

// ── enumهای وضعیت ───────────────────────────────────────────────────────

/**
 * وضعیتِ یک **اشتراکِ واقعی** — [PLAN §۵٫۱](../../../../PLAN.md).
 *
 * ⚠️ عمداً `none` **ندارد**: `none` وضعیتِ **تیمِ بی‌اشتراک** است، نه وضعیتی که یک ردیفِ
 * `subscriptions` بتواند داشته باشد ([ADR-054](../../../../ARCHITECTURE_DECISIONS.md#adr-054)،
 * M4-D2a — رفعِ تناقضِ خودِ PLAN بینِ §۵٫۱ سطرِ `Team` و سطرِ `Subscription`).
 */
export const subscriptionStatuses = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "expired",
] as const;
export const subscriptionStatus = z.enum(subscriptionStatuses);
export type SubscriptionStatus = z.infer<typeof subscriptionStatus>;

/**
 * وضعیتِ اشتراک **از دیدِ تیم** — همان پنج‌تا، به‌علاوه‌ی `none` برای تیمی که هیچ اشتراکی ندارد.
 * فقط روی `Team` می‌نشیند.
 */
export const teamSubscriptionStatuses = ["none", ...subscriptionStatuses] as const;
export const teamSubscriptionStatus = z.enum(teamSubscriptionStatuses);
export type TeamSubscriptionStatus = z.infer<typeof teamSubscriptionStatus>;

/** دوره‌ی صورت‌حساب. */
export const billingPeriods = ["monthly", "yearly"] as const;
export const billingPeriod = z.enum(billingPeriods);
export type BillingPeriod = z.infer<typeof billingPeriod>;

/** وضعیتِ فاکتور. */
export const invoiceStatuses = ["draft", "open", "paid", "void", "refunded"] as const;
export const invoiceStatus = z.enum(invoiceStatuses);
export type InvoiceStatus = z.infer<typeof invoiceStatus>;

// ── سقف‌های پلن ─────────────────────────────────────────────────────────

/**
 * یک سقفِ عددیِ پلن.
 *
 * ⚠️ **`-1` یعنی نامحدود** (قراردادِ ستونِ `max_boards` در schema). پس `nonnegative()` **غلط**
 * است و چکِ طبیعیِ `count >= max` روی پلنِ نامحدود **همه‌چیز را می‌بندد** (`count >= -1` همیشه
 * درست است). هر مصرف‌کننده باید صریحاً `-1` را جدا کند
 * ([ADR-053](../../../../ARCHITECTURE_DECISIONS.md#adr-053)).
 */
export const planLimit = z.number().int().min(-1);
export type PlanLimit = z.infer<typeof planLimit>;

/** سه سقفی که هم روی `Plan` هست هم روی `Team.limits`. */
const limitsShape = {
  maxMembers: planLimit,
  maxBoards: planLimit,
  maxStorageBytes: planLimit,
};

/** سقف‌های پلنِ فعالِ تیم. */
export const planLimits = z.object(limitsShape);
export type PlanLimits = z.infer<typeof planLimits>;

/** مصرفِ فعلیِ تیم — همیشه ≥ ۰ (برخلافِ سقف‌ها، اینجا `-1` معنا ندارد). */
export const planUsage = z.object({
  members: z.number().int().nonnegative(),
  boards: z.number().int().nonnegative(),
  storageBytes: z.number().int().nonnegative(),
});
export type PlanUsage = z.infer<typeof planUsage>;

// ── DTOها ───────────────────────────────────────────────────────────────

/**
 * یک پلن — [PLAN §۵٫۱](../../../../PLAN.md).
 *
 * ⚠️ `code` عمداً `string` است نه enum: قفل‌کردنش به enum یعنی کاتالوگِ پلن‌ها در کدِ منتشرشده
 * منجمد می‌شود و افزودنِ یک پلن با یک ردیفِ دیتابیس ممکن نیست.
 */
export const plan = z.object({
  code: z.string().min(1).max(30),
  name: z.string(),
  description: z.string(),
  priceMonthlyRial: rial,
  priceYearlyRial: rial,
  ...limitsShape,
  features: z.array(z.string()),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
});
export type Plan = z.infer<typeof plan>;

/** اشتراکِ یک تیم — [PLAN §۵٫۱](../../../../PLAN.md). زمان‌ها UTC (ADR-018؛ جلالی فقط در نمایش). */
export const subscription = z.object({
  id: uuid,
  teamId: uuid,
  planCode: z.string().min(1).max(30),
  status: subscriptionStatus,
  period: billingPeriod,
  seats: z.number().int().positive(),
  currentPeriodStart: isoDateTime,
  currentPeriodEnd: isoDateTime,
  cancelAtPeriodEnd: z.boolean(),
});
export type Subscription = z.infer<typeof subscription>;

/**
 * یک سطرِ فاکتور. **نام‌دار** است (نه inline در `invoice`) تا در OpenAPI یک componentِ واقعی
 * بسازد، نه یک شیءِ بی‌نام.
 */
export const invoiceLineItem = z.object({
  title: z.string(),
  qty: z.number().int().positive(),
  unitPriceRial: rial,
  totalRial: rial,
});
export type InvoiceLineItem = z.infer<typeof invoiceLineItem>;

/**
 * فاکتور — [PLAN §۵٫۱](../../../../PLAN.md).
 *
 * ★ چهار مبلغ **مستقلاً سمتِ سرور** محاسبه و ذخیره می‌شوند و رابطه‌ی
 * `subtotal − discount + vat === total` را برقرار می‌کنند
 * ([ADR-052](../../../../ARCHITECTURE_DECISIONS.md#adr-052)). عمداً **`vatPercent` ندارد**:
 * فرستادنش یعنی دعوت از کلاینت به ضرب‌کردن، که floatِ پول را به لایه‌ی نمایش برمی‌گرداند.
 */
export const invoice = z.object({
  id: uuid,
  number: z.string(), // «HB-1405-000123»
  subtotalRial: rial,
  discountRial: rial,
  vatRial: rial,
  totalRial: rial,
  status: invoiceStatus,
  issuedAt: isoDateTime,
  paidAt: isoDateTime.nullable(),
  lineItems: z.array(invoiceLineItem),
});
export type Invoice = z.infer<typeof invoice>;
