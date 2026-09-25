import {
  assertGatewayAllowed,
  MockGateway,
  ZarinpalGateway,
  type PaymentGateway,
} from "@hamboom/billing-core";

import type { ApiConfig } from "../config.ts";
import {
  createCardTransferGatewayOn,
  resolveCardTransferSettings,
  type CardTransferSettings,
} from "../services/card-transfer.ts";
import type { Executor } from "./db.ts";

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

/**
 * ★ فقط همان چیزی که واقعاً لازم است — نه کلِ `ApiConfig` (M5 گام ۴٫۲).
 *
 * این‌طوری کانتینرِ یک‌بارمصرفِ آشتی‌دهی می‌تواند با یک configِ **باریک** همین درگاه را
 * بسازد، بدونِ اینکه `JWT_SECRET` و کلیدهای S3 را لازم داشته باشد.
 */
export type PaymentGatewayConfig = Pick<
  ApiConfig,
  | "APP_ENV"
  | "PORT"
  | "PAYMENT_PROVIDER"
  | "ZARINPAL_MODE"
  | "ZARINPAL_MERCHANT_ID"
  | "ZARINPAL_CURRENCY"
  | "ZARINPAL_CALLBACK_URL"
  | "WEB_BASE_URL"
  | "CARD_TRANSFER_CARD_NUMBER"
  | "CARD_TRANSFER_SHEBA"
  | "CARD_TRANSFER_HOLDER_NAME"
  | "CARD_TRANSFER_BANK_NAME"
  | "CARD_TRANSFER_CLAIM_WINDOW_HOURS"
>;

/**
 * تنظیماتِ کارت‌به‌کارت، یا `null` وقتی provider چیزِ دیگری است (ADR-070).
 *
 * ★★ **گاردِ بوت همین‌جاست:** `resolveCardTransferSettings` روی مقصدِ غایب یا بدرقم پرتاب
 * می‌کند، و چون در مسیرِ `buildApp` صدا زده می‌شود، `APP_ENV=production` بدونِ مقصدِ معتبر
 * **بالا نمی‌آید** — همان الگوی `ZARINPAL_MERCHANT_ID` پایین، و همان چیزی که ردیفِ ۸٫۷
 * (`WEB_BASE_URL`ِ بی‌گارد) نبودش را ثبت کرده بود.
 */
export function cardTransferSettingsFrom(
  config: PaymentGatewayConfig,
): CardTransferSettings | null {
  if (config.PAYMENT_PROVIDER !== "card_transfer") return null;
  return resolveCardTransferSettings(
    config,
    config.WEB_BASE_URL,
    // ⊕ برخلافِ زرین‌پال، این‌جا `mode` متغیرِ خودش را ندارد: سندباکسی وجود ندارد که بشود
    //   انتخابش کرد. یا پولِ واقعی جابه‌جا می‌شود یا محیط production نیست.
    config.APP_ENV === "production" ? "production" : "sandbox",
  );
}

/**
 * @param deps.db اجراکننده‌ای که درگاهِ **پیش‌فرضِ برنامه** رویش می‌خوانَد (استخر).
 *   ⚠️ مسیرِ تایید عمداً از این استفاده نمی‌کند و نمونه‌ی tx-محدودِ خودش را می‌سازد.
 */
export function createPaymentGateway(
  config: PaymentGatewayConfig,
  deps: { db?: Executor } = {},
): PaymentGateway {
  const transfer = cardTransferSettingsFrom(config);
  let gateway: PaymentGateway;
  if (transfer !== null) {
    if (deps.db === undefined) {
      // ⚠️ برخلافِ دو درگاهِ دیگر، این یکی بدونِ دیتابیس بی‌معنی است — و شکستنِ صریح در بوت
      //    از یک درگاهِ نیمه‌ساخته که سرِ اولین verify می‌شکند بهتر است.
      throw new Error(
        "PAYMENT_PROVIDER=card_transfer است ولی هیچ اجراکننده‌ی دیتابیسی به createPaymentGateway داده نشد (ADR-070).",
      );
    }
    gateway = createCardTransferGatewayOn(transfer, deps.db);
  } else if (config.PAYMENT_PROVIDER === "zarinpal") {
    gateway = createZarinpal(config);
  } else {
    gateway = new MockGateway({
      checkoutBaseUrl: `http://localhost:${String(config.PORT)}${MOCK_CHECKOUT_PATH}`,
    });
  }

  // ★★ گیتی که نبودنش یعنی هر پرداخت در production **رایگان** موفق می‌شود.
  //    این‌جا صدا زده می‌شود (نه در `server.ts`) تا تست‌ها و هر ورودیِ آینده هم از آن رد شوند.
  assertGatewayAllowed(gateway, config.APP_ENV);
  return gateway;
}

function createZarinpal(config: PaymentGatewayConfig): PaymentGateway {
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
