/**
 * `@hamboom/billing-core` — منطقِ خالصِ پرداخت و اشتراک (M4 فاز ۳،
 * [ADR-049](../../../ARCHITECTURE_DECISIONS.md#adr-049)).
 *
 * قرینه‌ی `auth-core`: پورت و ریاضی اینجا، جدول و تراکنش در `apps/api`.
 * ⚠️ هیچ `pg`، هیچ `fastify`، هیچ UI — و هیچ `process.env`.
 */

export type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentGateway,
  UnverifiedPayment,
  VerifyOutcome,
  VerifyPaymentInput,
} from "./gateway.ts";
export { assertGatewayAllowed, GatewayNotAllowedError } from "./gateway.ts";

export { MockGateway } from "./mock-gateway.ts";
export type { MockGatewayConfig } from "./mock-gateway.ts";

export { ZarinpalGateway } from "./zarinpal-gateway.ts";
export type { ZarinpalConfig } from "./zarinpal-gateway.ts";

export {
  assertGatewayAmount,
  computeCharge,
  GATEWAY_MAX_RIAL,
  GATEWAY_MIN_RIAL,
  InvalidChargeError,
  percentOfRial,
  unitPriceRial,
} from "./money.ts";
export type { Charge, ChargeInput, CouponEffect } from "./money.ts";

export { matchOrphans, planSweep, supportsUnverifiedList } from "./reconcile.ts";
export type {
  AdoptionDecision,
  PendingPaymentSnapshot,
  SweepAction,
  SweepDecision,
  SweepPolicy,
} from "./reconcile.ts";

export {
  addUtcMonths,
  computePeriod,
  formatInvoiceNumber,
  isStalePending,
  jalaliYearOf,
} from "./period.ts";
export type { Period } from "./period.ts";
