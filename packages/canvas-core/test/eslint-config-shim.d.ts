/**
 * `@hamboom/eslint-config` یک پکیجِ فقط-JS است (config، بدون build/type).
 * تنها چیزی که تستِ RuleTester لازم دارد قاعده‌ی خام است — همین را type می‌دهیم.
 */
declare module "@hamboom/eslint-config/boundaries" {
  import type { Rule } from "eslint";

  export const requireCaptureUpdateRule: Rule.RuleModule;
}
