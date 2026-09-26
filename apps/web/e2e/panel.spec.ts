import { expect, test, type Locator, type Page } from "@playwright/test";

import { OTP_CODE, readFixtures } from "./fixtures.ts";

/**
 * E2Eِ پنلِ ادمین روی استکِ واقعی — M6 ردیفِ ۸٫۱.
 *
 * معیارِ پذیرش: ورودِ staff → جست‌وجو → تعلیق → نمای پشتیبانی → verifyِ دستیِ mock؛
 * و کاربرِ غیرِ staff مسیرِ `/panel` را **نمی‌بیند**.
 *
 * ★★ **ورود از رابطِ واقعی انجام می‌شود، نه با تزریقِ کوکی.** توکنِ دسترسی فقط در حافظه‌ی
 * closureی sdk زندگی می‌کند و نشست ناهمگام از کوکیِ HttpOnly بازسازی می‌شود؛ تزریقِ کوکی
 * همان چیزی را دور می‌زد که این تست باید اثباتش کند.
 *
 * ★★ **و `window.confirm` در دو جا سرِ راه است** (تعلیق و رفعِ تعلیق) — عمداً، از فاز ۵.
 * پس هر تستی که این مسیر را می‌رود باید دیالوگ را بپذیرد، وگرنه بی‌صدا هیچ‌کاری نمی‌کند.
 */

const fixtures = readFixtures();

/** ورود از فرمِ واقعی: شماره → کد. `OTP_DEV_FIXED_CODE` کد را قطعی می‌کند. */
async function loginAs(page: Page, phone: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("شماره‌ی موبایل").fill(phone);
  await page.getByRole("button", { name: "ارسال کد" }).click();
  await page.getByLabel("کد ورود").fill(OTP_CODE);
  await page.getByRole("button", { name: "ورود" }).click();
  // ★ انتظار روی **مقصد**، نه یک تایمر: ورودِ موفق به داشبورد می‌رود.
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
}

/**
 * ★ step-upِ درجا: فرمِ ۴۲۸ ظاهر می‌شود، کد می‌گیریم، تایید می‌کنیم.
 *
 * ⚠️ کد به شماره‌ی **خودِ staff** می‌رود و سرور شماره را از ردیفِ او می‌خوانَد — این فرم
 * شماره نمی‌گیرد. با `OTP_DEV_FIXED_CODE` همان کدِ ثابت است.
 */
async function passStepUpIfAsked(page: Page, settled: Locator): Promise<boolean> {
  const prompt = page.getByText("این عمل تاییدِ دوباره می‌خواهد");
  // ⚠️⚠️ **`isVisible()` صبر نمی‌کند** — و این یک باگِ واقعیِ همین فایل بود: بی این انتظار،
  //    درست بعد از کلیک پرسیده می‌شد و پاسخِ ۴۲۸ هنوز نرسیده بود (کادرِ دلیل `disabled` و
  //    درخواست در پرواز) ⇒ «نپرسید» گزارش می‌شد. پس اول روی **یکی از دو مقصد** صبر می‌کنیم
  //    و بعد تصمیم می‌گیریم؛ نه تایمر، نه حدس.
  await expect(prompt.or(settled).first()).toBeVisible({ timeout: 20_000 });
  // ★★ **شرطی، و این یک ویژگیِ مستند است نه نوسان:** تازگیِ step-up در ستونِ
  //    `users.step_up_verified_at` می‌نشیند، یعنی **per-user** نه per-session (ADR-066 §۳).
  //    پس تستِ دومِ همین سوئیت که همان staff را تایید کرده، این یکی را از ۴۲۸ معاف می‌کند.
  //    اگر این‌جا `toBeVisible` سخت می‌گذاشتیم، تست به **ترتیبِ اجرا** گره می‌خورد و روزی که
  //    کسی تست‌ها را جابه‌جا کند بی‌دلیل قرمز می‌شد.
  if (!(await prompt.isVisible())) return false;
  await page.getByRole("button", { name: "درخواستِ کد" }).click();
  await page.getByLabel("کدِ پیامکی").fill(OTP_CODE);
  await page.getByRole("button", { name: "تایید" }).click();
  await expect(page.getByLabel("کدِ پیامکی")).toBeHidden({ timeout: 15_000 });
  return true;
}

test("★★ کاربرِ غیرِ staff مسیرِ /panel را نمی‌بیند — به داشبورد برمی‌گردد", async ({ page }) => {
  await loginAs(page, fixtures.plainPhone);
  await page.goto("/panel");
  // ⚠️ ادعا **ریدایرکت** است، نه یک کارتِ «دسترسی ندارید»: گاردِ `RequireStaff` عمداً
  //    `Navigate` است تا کاربرِ غیرِ staff حتی chunkِ lazyِ پنل را دانلود نکند (معیارِ ۳٫۶).
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "پنلِ ادمین" })).toBeHidden();
});

test("★★ staff: جست‌وجو → تعلیق (با step-up) → نمای پشتیبانی", async ({ page }) => {
  await loginAs(page, fixtures.staffPhone);

  // ── پنل باز می‌شود و ریلِ ناوبری هست ──
  await page.goto("/panel");
  // ⚠️ «پنلِ ادمین» دو جا هست (برچسبِ ریلِ ناوبری و سرتیترِ صفحه) ⇒ ادعا روی **نقش**، نه متنِ خام.
  await expect(page.getByRole("heading", { name: "پنلِ ادمین" })).toBeVisible({ timeout: 20_000 });

  // ── جست‌وجو با شماره‌ی **کامل** (پیشوند عمداً کار نمی‌کند — ماسک را بازسازی می‌کرد) ──
  await page.goto("/panel/users");
  await page.getByLabel("جست‌وجو").fill(fixtures.targetPhone);
  await page.getByRole("button", { name: "جست‌وجو" }).click();
  // ★ ادعا روی **مقصدِ لینک**، نه روی نامِ نمایشیِ خودکار («کاربر ۶۰۷۹») — آن نام تصادفی است
  //   و یک ادعای شکننده می‌ساخت. hrefِ ردیفِ نتیجه دقیقاً همان چیزی است که باید درست باشد.
  await expect(
    page.locator(`a[href="/panel/users/${fixtures.targetUserId}"]`),
  ).toBeVisible({ timeout: 15_000 });

  // ── صفحه‌ی کاربر ──
  await page.goto(`/panel/users/${fixtures.targetUserId}`);
  await expect(page.getByRole("heading", { name: "تعلیق" })).toBeVisible({ timeout: 15_000 });

  // ── تعلیق: دیالوگ + دلیل + ۴۲۸ + step-up + تلاشِ دوباره ──
  page.on("dialog", (d) => void d.accept());
  await page.getByLabel("دلیل (در ممیزی ثبت می‌شود)").fill("آزمونِ E2E — تعلیقِ موقت");
  await page.getByRole("button", { name: "تعلیقِ حساب" }).click();

  // ★★ اولین عملِ مخربِ این staff ۴۲۸ می‌گیرد (هنوز هیچ step-upی نکرده) ⇒ این‌جا باید
  //    واقعاً پرسیده شود. اگر روزی نپرسید، گیتِ ۴۲۸ مرده است — پس ادعا صریح است.
  const unsuspendHeading = page.getByRole("heading", { name: "رفعِ تعلیق" });
  expect(await passStepUpIfAsked(page, unsuspendHeading)).toBe(true);
  await page.getByRole("button", { name: "تعلیقِ حساب" }).click();

  // ★ ادعا: عنوانِ بخش به «رفعِ تعلیق» عوض می‌شود — یعنی سرور واقعاً وضعیت را چرخاند.
  await expect(page.getByRole("heading", { name: "رفعِ تعلیق" })).toBeVisible({ timeout: 20_000 });

  // ── نمای پشتیبانی: بوردِ همان کاربر با نقشِ viewer دیده می‌شود ──
  // ⚠️ ادعا فقط «صفحه باز شد» نیست: staff نباید `owner` باشد (ADR-066). آنچه این‌جا
  //    اثبات می‌شود **دسترسیِ خواندن** است؛ نبودِ نوشتن را سنجه‌ی `admin:access` روی سیم می‌سنجد.
  await page.goto(`/panel/users/${fixtures.targetUserId}`);
  // ★ جدولِ «بوردها (نمای پشتیبانی)» شناسه را نشان نمی‌دهد؛ چیزی که نشان می‌دهد و اهمیت هم
  //   دارد **لینکِ بازکردنِ فقط‌خواندنی** است. ادعا روی href، تا نامِ بورد شکننده‌اش نکند.
  await expect(page.locator(`a[href="/b/${fixtures.targetBoardId}"]`)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("بازکردن (فقط‌خواندنی)").first()).toBeVisible();

  // ── رفعِ تعلیق، تا فیکسچر برای تستِ بعدی سالم بمانَد ──
  await page.getByRole("button", { name: "برداشتنِ تعلیق" }).click();
  await expect(page.getByRole("heading", { name: "تعلیق", exact: true })).toBeVisible({
    timeout: 20_000,
  });
});

test("★★ staff: verifyِ دستیِ یک پرداختِ mock ⇒ outcome در همان صفحه", async ({ page }) => {
  await loginAs(page, fixtures.staffPhone);
  await page.goto(`/panel/payments/${fixtures.paymentId}`);
  await expect(page.getByRole("heading", { name: "پرداخت" })).toBeVisible({ timeout: 20_000 });

  page.on("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: /پرسیدن از درگاه/ }).click();

  // ⚠️⚠️ **verify هم پشتِ step-up است** و این را همین تست نشانم داد: در نشستِ تازه اولین
  //    کلیک ۴۲۸ می‌گیرد و به‌جای نتیجه، فرمِ تاییدِ دوباره ظاهر می‌شود. «پرسیدن از درگاه»
  //    یک خواندن به‌نظر می‌رسد ولی می‌تواند یک اشتراک را **فعال** کند — پس گیتش درست است.
  // ⊕ این‌جا شرطی است: اگر تستِ قبلی همین staff را تایید کرده باشد، ۴۲۸ نمی‌آید.
  const outcome = page.getByText(/نتیجه: (activated|alreadySettled)/);
  if (await passStepUpIfAsked(page, outcome)) {
    await page.getByRole("button", { name: /پرسیدن از درگاه/ }).click();
  }

  // ★★ **۲۰۰ برای هر نتیجه** — پس ادعا روی `outcome` است، نه روی کدِ HTTP. درگاهِ mock
  //    همیشه «پرداخت شد» می‌گوید، پس نتیجه‌ی مورد انتظار `activated` است.
  await expect(outcome).toBeVisible({ timeout: 20_000 });
});
