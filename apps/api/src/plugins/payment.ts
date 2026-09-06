import {
  assertGatewayAllowed,
  MockGateway,
  ZarinpalGateway,
  type PaymentGateway,
} from "@hamboom/billing-core";

import type { ApiConfig } from "../config.ts";

/**
 * ساختِ `PaymentGateway` از configِ api — قرینه‌ی [`s3.ts`](./s3.ts) (M4 فاز ۵،
 * [ADR-049](../../../../ARCHITECTURE_DECISIONS.md#adr-049)).
 *
 * ★ **این تنها جایی است که `PAYMENT_PROVIDER` خوانده می‌شود.** routeها یک
 * `PaymentGateway` تزریق‌شده می‌گیرند و نمی‌دانند کدام پیاده‌سازی است — همان الگویی که
 * `ObjectStore` و `BoardAuthority` دارند، و همان چیزی که تست را بدونِ شبکه ممکن می‌کند.
 */

/**
 * مسیرِ صفحه‌ی ساختگیِ پرداخت که خودِ api سرو می‌کند (فقط توسعه).
 *
 * ⚠️ **بدونِ پیشوندِ `/api/v1`.** نگارشِ اول این را `"/api/v1/billing/mock/pay"` نوشته بود،
 * ولی هیچ‌جای این اپ چنین پیشوندی ثبت نمی‌شود — تنها مسیرِ `/api/v1`ی موجود،
 * `/api/v1/docs`ِ **تحت‌اللفظی** است. یعنی دکمه‌ی پرداختِ dev به یک ۴۰۴ می‌رفت و کلِ
 * جریانِ P3 («`docker compose up && pnpm dev` باید کافی باشد») مرده بود. با اجرای واقعی
 * در مرورگر (فاز ۹) پیدا شد، نه با هیچ تستی.
 */
export const MOCK_CHECKOUT_PATH = "/billing/mock/pay";

export function createPaymentGateway(config: ApiConfig): PaymentGateway {
  const gateway =
    config.PAYMENT_PROVIDER === "zarinpal"
      ? createZarinpal(config)
      : new MockGateway({
          checkoutBaseUrl: `http://localhost:${String(config.PORT)}${MOCK_CHECKOUT_PATH}`,
        });

  // ★★ گیتی که نبودنش یعنی هر پرداخت در production **رایگان** موفق می‌شود.
  //    این‌جا صدا زده می‌شود (نه در `server.ts`) تا تست‌ها و هر ورودیِ آینده هم از آن رد شوند.
  assertGatewayAllowed(gateway, config.APP_ENV);
  return gateway;
}

function createZarinpal(config: ApiConfig): PaymentGateway {
  const merchantId = config.ZARINPAL_MERCHANT_ID;
  if (merchantId === undefined || merchantId.length === 0) {
    // ⚠️ در schema عمداً `optional` است تا `pnpm dev` merchantِ واقعی نخواهد (P3). اجباری‌بودنش
    //    فقط وقتی معنا دارد که provider **واقعاً** زرین‌پال باشد — یعنی همین‌جا.
    throw new Error(
      "PAYMENT_PROVIDER=zarinpal است ولی ZARINPAL_MERCHANT_ID خالی است. " +
        "برای توسعه PAYMENT_PROVIDER=mock بگذار (ADR-049).",
    );
  }
  return new ZarinpalGateway({
    // میزبان با تماسِ زنده در گام ۱٫۱ تایید شد: `payment.zarinpal.com`، نه `api.zarinpal.com`.
    baseUrl:
      config.ZARINPAL_MODE === "production"
        ? "https://payment.zarinpal.com"
        : "https://sandbox.zarinpal.com",
    merchantId,
    mode: config.ZARINPAL_MODE,
  });
}
