import { requireCaptureUpdateRule } from "@hamboom/eslint-config/boundaries";
import { RuleTester } from "eslint";
import { describe, it } from "vitest";

/**
 * خودآزمونِ قاعده‌ی `require-capture-update` — یک گیت که خودش آزموده نشود گیت نیست.
 *
 * این قاعده سه‌بار جلوی باگِ خانواده‌ی captureUpdate را می‌گیرد؛ اگر روزی بی‌صدا
 * بشکند (مثلاً فقط دیگر updateScene را نگیرد)، کلاسِ باگ برمی‌گردد. این تست هر
 * دو جهت را pin می‌کند.
 */

// RuleTester به قلاب‌های describe/it نیاز دارد.
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

ruleTester.run("require-capture-update", requireCaptureUpdateRule, {
  valid: [
    // captureUpdate صریح — هر سه مقدار
    'api.updateScene({ elements: [], captureUpdate: "IMMEDIATELY" });',
    'api.updateScene({ captureUpdate: "NEVER" });',
    'api.updateScene({ captureUpdate: "EVENTUALLY" });',
    // spread → ممکن است captureUpdate از آنجا بیاید؛ برای پرهیز از مثبتِ کاذب رد نمی‌شود
    "api.updateScene({ ...base });",
    // آرگومان object-literal نیست → قابلِ بازرسی نیست
    "api.updateScene(sceneData);",
    // updateScene نیست
    "foo.bar({ elements: [] });",
    // فراخوانی عضو نیست (تابع آزاد هم‌نام)
    "updateScene({ elements: [] });",
  ],
  invalid: [
    {
      code: "api.updateScene({ elements: [] });",
      errors: [{ messageId: "missing" }],
    },
    {
      code: "api.updateScene({ elements: [], appState: {} });",
      errors: [{ messageId: "missing" }],
    },
    {
      // زنجیره‌ی عمیق‌تر هم گرفته می‌شود
      code: "this.api.updateScene({ elements: [] });",
      errors: [{ messageId: "missing" }],
    },
  ],
});
