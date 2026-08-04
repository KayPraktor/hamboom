import base, { nodeGlobals } from "@hamboom/eslint-config/base";
import { realtimeBoundaries } from "@hamboom/eslint-config/boundaries";

/** @type {import("eslint").Linter.Config[]} */
export default [
  { ignores: ["dist/**", ".data/**"] },
  ...base,
  // کدِ سرور است، پس globalهای Node را دارد. از `eslint-config` می‌آید نه از
  // `globals`ِ مستقیم — زیر pnpm خودِ اپ نمی‌تواند resolveش کند.
  { ...nodeGlobals, files: ["src/**/*.ts"] },
  // ADR-029/ADR-031 — نه موتورِ رندر، نه React، نه SDKِ خامِ Object Storage.
  // ⚠️ `@hamboom/storage` و `@hamboom/auth-core` عمداً مجازند: خودِ P4 و ADR-012
  // همان‌ها را مسیرِ درست می‌دانند. ممنوعیت روی `@aws-sdk/*`ِ خام است.
  { ...realtimeBoundaries(), files: ["src/**/*.ts"] },
];
