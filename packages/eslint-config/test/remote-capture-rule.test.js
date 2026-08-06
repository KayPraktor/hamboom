import { RuleTester } from "eslint";
import { describe, it } from "vitest";

import { remoteWritesNeverRule } from "../boundaries.js";

/**
 * خودآزمونِ قاعده‌ی `remote-writes-never` — گام ۳٫۲.
 *
 * «قاعده‌ای که خودش تست نشده، گیت نیست» (قاعده‌ی ۱۰ در TODO). این قاعده جلوی
 * یک باگِ **بی‌صدا** را می‌گیرد: `IMMEDIATELY` در مسیرِ remote یعنی کارِ کاربرِ
 * دیگر در undo stackِ محلی می‌نشیند و `Ctrl+Z` این کاربر کارِ آن یکی را
 * برمی‌گرداند. نه خطا می‌دهد، نه در تستِ واحد دیده می‌شود.
 *
 * ★ هر دو جهت آزموده می‌شود. قاعده‌ای که همه‌چیز را خطا کند به‌اندازه‌ی قاعده‌ای
 * که هیچ‌چیز را نگیرد بی‌فایده است — فقط سریع‌تر دور زده می‌شود.
 */

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

ruleTester.run("remote-writes-never", remoteWritesNeverRule, {
  valid: [
    // مسیرِ درستِ مسیرِ remote.
    "commitSystemUpdate(api, elements);",
    'api.updateScene({ elements, captureUpdate: "NEVER" });',
    // مقدارِ غیرِ literal قابلِ بازرسی نیست — مثبتِ کاذب نمی‌سازیم.
    "api.updateScene({ elements, captureUpdate: mode });",
    // نامِ دیگری است.
    "commitSomethingElse(api, elements);",
    "api.updateScene({ elements });",
    // کلیدِ محاسبه‌شده — نمی‌دانیم `captureUpdate` است یا نه.
    'api.updateScene({ [key]: "IMMEDIATELY" });',
    // فیلدی هم‌نام روی یک آبجکتِ بی‌ربط، ولی با مقدارِ درست.
    'const options = { captureUpdate: "NEVER" };',
  ],
  invalid: [
    {
      code: 'api.updateScene({ elements, captureUpdate: "IMMEDIATELY" });',
      errors: [{ messageId: "notNever" }],
    },
    {
      code: 'api.updateScene({ captureUpdate: "EVENTUALLY" });',
      errors: [{ messageId: "notNever" }],
    },
    {
      // نامِ رشته‌ای هم همان است.
      code: 'api.updateScene({ "captureUpdate": "IMMEDIATELY" });',
      errors: [{ messageId: "notNever" }],
    },
    {
      code: "commitGesture(api, elements);",
      errors: [{ messageId: "gesture" }],
    },
    {
      // فراخوانیِ عضوی هم گرفته می‌شود.
      code: "scene.commitGesture(api, elements);",
      errors: [{ messageId: "gesture" }],
    },
    {
      // ★ ترکیبِ واقعیِ خطرناک: هم ژست، هم capture غلط.
      code: 'commitGesture(api, elements); api.updateScene({ captureUpdate: "IMMEDIATELY" });',
      errors: [{ messageId: "gesture" }, { messageId: "notNever" }],
    },
  ],
});
