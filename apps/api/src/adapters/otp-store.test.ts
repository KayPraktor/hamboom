import { createMemoryOtpStore } from "@hamboom/auth-core";
import { describe, it } from "vitest";

import { otpPurposeCases, otpStoreCases } from "./otp-store.conformance.ts";

/**
 * conformanceِ `OtpStore` روی **پیاده‌سازیِ حافظه‌ای** — داخلِ verify. همین case‌ها در
 * `db:store-test` روی `createPgOtpStore` هم اجرا می‌شوند.
 */
describe("OtpStore conformance — memory", () => {
  const store = createMemoryOtpStore();
  for (const c of otpStoreCases) {
    it(c.name, () => c.run(store));
  }
  // ★ M6: دو هدف = دو store — روی memory دو نمونه‌ی جدا (اثباتِ واقعی روی PG در db:store-test).
  for (const c of otpPurposeCases) {
    it(c.name, () => c.run(createMemoryOtpStore(), createMemoryOtpStore()));
  }
});
