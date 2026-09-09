/**
 * ★★ probeِ زنده‌ی sms.ir — M5 فازِ ۴٫۵.
 *
 * ```bash
 * pnpm sms:probe -- --to=09XXXXXXXXX          # ★ یک پیامکِ **واقعی** می‌فرستد
 * pnpm sms:probe -- --to=09XXXXXXXXX --dry-run
 * ```
 *
 * ── چرا این probe وجود دارد ──────────────────────────────────────────────
 *
 * درسِ M4، عیناً: تماسِ **زنده** با زرین‌پال پنج فرضِ غلط را گرفت که از مستندات
 * درنمی‌آمدند. این‌جا هم قرارداد تا وقتی یک پیامکِ واقعی به یک گوشیِ واقعی نرسد،
 * **فرض** است نه دانش. سه چیز فقط با اجرای واقعی معلوم می‌شوند:
 *
 * ۱. شکلِ **دقیقِ** پاسخ (`status`، `message`، `data.messageId`، هزینه).
 * ۲. اینکه خطای کسب‌وکار با کدِ HTTPِ ۲۰۰ می‌آید یا non-2xx — که تعیین می‌کند
 *    `describeFailure` درست نوشته شده یا نه.
 * ۳. ★★ و مهم‌ترینش: اینکه **جای کد در پیامک پر است**. یک حرف اختلاف در نامِ پارامتر
 *    یعنی پیامک می‌رسد و جای کد **خالی** است — و هیچ تستی این را نمی‌گیرد.
 *
 * ── ⚠️ P7 ────────────────────────────────────────────────────────────────
 *
 * شماره در خروجی **ماسک** می‌شود و هیچ‌جا نوشته نمی‌شود. کدِ ارسالی چاپ می‌شود — عمدی
 * است و فقط این‌جا: اپراتور باید بتواند چیزی که روی گوشی می‌بیند را با آن **مقایسه**
 * کند، وگرنه چکِ سوم اصلاً قابلِ انجام نیست. این اسکریپت هرگز در سرور اجرا نمی‌شود.
 */
import { randomInt } from "node:crypto";

import { loadEnv, smsEnvSchema } from "@hamboom/config";
import {
  describeFailure,
  normalizeIranianMobile,
  maskPhone,
  sendVerifyCode,
} from "@hamboom/auth-core";

function argValue(name: string): string | undefined {
  const arg = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return arg?.split("=").slice(1).join("=");
}

async function main(): Promise<void> {
  const env = loadEnv(smsEnvSchema);
  const dryRun = process.argv.slice(2).includes("--dry-run");
  const to = argValue("to");

  // ⚠️ هیچ شماره‌ی پیش‌فرضی وجود ندارد و نباید داشته باشد: یک شماره‌ی جاافتاده در کد،
  //    روزی به یک آدمِ بی‌ربط پیامک می‌فرستد.
  if (to === undefined) {
    console.error(
      "✖ شماره‌ی مقصد لازم است:  pnpm sms:probe -- --to=09XXXXXXXXX\n" +
        "    (عمداً پیش‌فرض ندارد — شماره‌ی جاافتاده در کد روزی به یک آدمِ بی‌ربط پیامک می‌فرستد.)",
    );
    process.exit(1);
  }

  let phone: string;
  try {
    phone = normalizeIranianMobile(to);
  } catch (error) {
    console.error(`✖ ${String((error as Error).message)}`);
    process.exit(1);
  }

  const code = String(randomInt(10_000, 99_999));
  const config = {
    apiKey: env.SMS_IR_API_KEY,
    templateId: env.SMS_IR_TEMPLATE_ID,
    parameterName: env.SMS_IR_PARAM_NAME,
    baseUrl: env.SMS_IR_BASE_URL,
    timeoutMs: env.SMS_IR_TIMEOUT_MS,
  };

  console.log("── پیکربندی ──");
  console.log(`  مقصد          : ${maskPhone(phone)}`);
  console.log(`  baseUrl       : ${config.baseUrl}`);
  console.log(`  templateId    : ${String(config.templateId ?? "‼️ تنظیم نشده")}`);
  console.log(`  نامِ پارامتر   : ${config.parameterName}`);
  console.log(
    `  کلید          : ${config.apiKey === undefined ? "‼️ تنظیم نشده" : `${config.apiKey.slice(0, 4)}…${config.apiKey.slice(-4)} (${String(config.apiKey.length)} کاراکتر)`}`,
  );
  console.log(`  کدِ ارسالی     : ${code}   ← همین باید روی گوشی دیده شود`);

  if (dryRun) {
    console.log("\n⊘ --dry-run: بدنه‌ی درخواست ساخته شد ولی چیزی فرستاده نشد.");
    console.log(
      JSON.stringify(
        {
          mobile: phone,
          templateId: config.templateId,
          parameters: [{ name: config.parameterName, value: code }],
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log("\n── ارسالِ واقعی ──");
  const started = Date.now();
  const result = await sendVerifyCode(config, phone, code);
  const ms = Date.now() - started;

  console.log(`  HTTP          : ${String(result.httpStatus)}   (${String(ms)}ms)`);
  console.log(`  status سرویس  : ${String(result.providerStatus ?? "—")}`);
  console.log(`  message       : ${result.message ?? "—"}`);
  console.log(`  messageId     : ${String(result.messageId ?? "—")}`);
  console.log(`  هزینه         : ${String(result.cost ?? "—")}`);
  console.log(`  بدنه‌ی خام     : ${result.rawBody.slice(0, 400)}`);

  const failure = describeFailure(result);
  if (failure !== null) {
    console.error(`\n✖ ${failure}`);
    console.error(
      "\nمعمول‌ترین علت‌ها: قالب تایید نشده · templateId اشتباه (عنوانِ قالب نیست، عدد است) · " +
        "نامِ پارامتر با متنِ قالب نمی‌خواند · اعتبارِ حساب صفر است · کلید باطل شده.",
    );
    process.exit(1);
  }

  // ★★ قرارداد را همین‌جا **ثبت** می‌کنیم تا دفعه‌ی بعد فرض نباشد.
  console.log("\n✔ sms.ir ارسال را پذیرفت. قراردادِ اندازه‌گیری‌شده:");
  console.log(
    `    HTTP ${String(result.httpStatus)} · status=${String(result.providerStatus)} ⇒ «موفق»`,
  );
  console.log(
    "\n⚠️ ولی «پذیرفت» یعنی «صف شد»، نه «رسید». دو چیز را روی **گوشی** ببین:\n" +
      `    ۱. پیامک رسید؟\n` +
      `    ۲. ★★ جای کد پر است و دقیقاً «${code}» است؟ (اگر خالی بود، نامِ پارامتر با قالب نمی‌خواند)`,
  );
}

await main();
