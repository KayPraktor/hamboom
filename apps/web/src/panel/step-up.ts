import { SdkError } from "@hamboom/sdk";

/**
 * «این عمل step-upِ تازه می‌خواهد؟» — M6 فاز ۶ (از `PanelUser` بیرون کشیده شد وقتی دومین و سومین
 * مصرف‌کننده آمدند).
 *
 * ★ هم کدِ HTTP و هم کدِ خطا سنجیده می‌شود: ۴۲۸ بدونِ `STEP_UP_REQUIRED` یعنی چیزِ دیگری، و نمایشِ
 * فرمِ step-up برایش فقط کاربر را گمراه می‌کند.
 */
export const isStepUpRequired = (e: unknown): boolean =>
  e instanceof SdkError && e.status === 428 && e.code === "STEP_UP_REQUIRED";
