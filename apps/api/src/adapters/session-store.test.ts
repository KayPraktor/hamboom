import { createMemorySessionStore } from "@hamboom/auth-core";
import { describe, it } from "vitest";

import { sessionStoreCases } from "./session-store.conformance.ts";

/**
 * conformanceِ `SessionStore` روی **پیاده‌سازیِ حافظه‌ای** — داخلِ verify (بدونِ DB).
 * همین case‌ها در `db:store-test` روی `createPgSessionStore` هم اجرا می‌شوند؛ اگر PG و memory
 * واگرا شوند یکی قرمز می‌شود.
 */
describe("SessionStore conformance — memory", () => {
  const store = createMemorySessionStore();
  for (const c of sessionStoreCases) {
    it(c.name, () => c.run(store, "test-user-sub"));
  }
});
