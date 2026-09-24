/**
 * تستِ قراردادیِ `@hamboom/sdk` در برابرِ `buildApp()`ِ **واقعی** (نه mock) — گام ۶ (معیارِ پذیرش).
 *
 * ★ sdk را روی `app.inject` سوار می‌کند: مسیریابی + handler + **DBِ واقعی** بی‌شبکه اجرا می‌شوند. سپس هر
 * پاسخ را با **zodِ shared-types** parse می‌کند — این ثابت می‌کند api دقیقاً شکلِ DTO را می‌دهد (نه ردیفِ خام).
 *
 * نیاز: Postgresِ dev (پورتِ ۵۵۴۴ روی این ماشین، migrate‌شده). اجرا: `pnpm sdk:contract`.
 * بیرونِ verify (DB لازم دارد).
 *
 * ★★ **چرا این اسکریپت برای M4 حیاتی است:** sdk پاسخ را اعتبارسنجی **نمی‌کند** و این
 * اسکریپت بیرونِ `pnpm verify` است. یعنی بدونِ چک‌های billing، verify کاملاً سبز می‌مانَد در
 * حالی که `Invoice.totalRial` در مرورگر **رشته** است یا `Team.limits` اصلاً `undefined` —
 * دقیقاً همان یافته‌ی فاز ۶ی M3.
 */
import { createHash, randomUUID } from "node:crypto";

import { MockGateway } from "../packages/billing-core/src/index.ts";
import { createPgOtpStore } from "../apps/api/src/adapters/otp-store.ts";
import { buildApp } from "../apps/api/src/app.ts";
import { recordAudit } from "../apps/api/src/audit.ts";
import { loadApiConfig } from "../apps/api/src/config.ts";
import { withTransaction } from "../apps/api/src/plugins/db.ts";
import {
  adminFeatureFlag,
  adminMe,
  adminPaymentDetail,
  adminPaymentSummary,
  adminSearchResult,
  adminStats,
  adminTeamDetail,
  adminUserBoard,
  adminUserDetail,
  adminUserSummary,
  auditLogEntry,
  board,
  paymentActionResult,
  reconcileReport,
  refundResult,
  boardSummary,
  folder,
  invoice,
  plan,
  subscription,
  systemStatus,
  team,
  user,
} from "../packages/shared-types/src/api/index.ts";
import { createClient, SdkError, type FetchLike } from "../packages/sdk/src/index.ts";

const NULL_BODY = new Set([101, 204, 205, 304]);

/** آداپتورِ fetch → app.inject: کلاینتِ واقعی روی سرورِ واقعی، بدونِ پورت. */
function injectFetch(app: Awaited<ReturnType<typeof buildApp>>): FetchLike {
  return async (url, init) => {
    const u = new URL(url, "http://local");
    const res = await app.inject({
      method: (init.method ?? "GET") as "GET",
      url: u.pathname + u.search,
      headers: init.headers as Record<string, string>,
      payload: init.body as string | undefined,
    });
    const headers = new Headers();
    for (const [k, v] of Object.entries(res.headers)) {
      if (k.toLowerCase() === "set-cookie") continue;
      if (typeof v === "string") headers.set(k, v);
      else if (Array.isArray(v)) headers.set(k, v.join(", "));
      else if (v !== undefined) headers.set(k, String(v));
    }
    return new Response(NULL_BODY.has(res.statusCode) ? null : res.rawPayload, {
      status: res.statusCode,
      headers,
    });
  };
}

let pass = 0;
let fail = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass += 1;
  } catch (e) {
    console.log(`  ✗ ${name} — ${e instanceof Error ? e.message : String(e)}`);
    fail += 1;
  }
}

async function main(): Promise<void> {
  // ★ سقفِ OTP این‌جا بالاتر است: کلِ قرارداد از یک IP (inject) هفت-هشت درخواستِ OTP می‌زند (ورودِ دو کاربر،
  //   step-up، چالشِ پیش/پس از تعلیق). خودِ سقف در ۴۲۹ی nginx/api روی استک سنجیده می‌شود، نه این‌جا.
  const config = { ...loadApiConfig(), OTP_DEV_FIXED_CODE: "424242", RATE_LIMIT_OTP_MAX: 30 };
  // ★ درگاه **صریح** تزریق می‌شود، نه از `PAYMENT_PROVIDER`ِ محیط: این اسکریپت نباید بسته به
  //   `.env`ِ کسی به سندباکسِ واقعی وصل شود (P2/P3).
  const gateway = new MockGateway({ checkoutBaseUrl: "http://local/billing/mock/pay" });
  const app = await buildApp({ config, gateway });
  await app.ready();
  const sdk = createClient({ baseUrl: "", fetch: injectFetch(app) });

  console.log("\n=== contract: @hamboom/sdk ↔ buildApp() واقعی ===\n");

  const phone = "09120009001";
  await sdk.auth.requestOtp({ phone });
  const verified = await sdk.auth.verifyOtp({ phone, code: "424242" });
  check("1) verifyOtp → توکن ذخیره شد", () => {
    if (sdk.getAccessToken() !== verified.accessToken) throw new Error("token not stored");
    if (verified.user) user.parse(verified.user); // ★ user باید DTOِ camelCase باشد
  });

  const me = await sdk.me.get();
  check("2) GET /me → user.parse سبز (شکلِ DTO)", () => {
    user.parse(me.user);
    if (me.user.displayName === undefined) throw new Error("displayName نیست (snake_case؟)");
  });
  check("3) /me.teams[0] → team.parse سبز", () => {
    if (me.teams.length === 0) throw new Error("no teams");
    team.parse(me.teams[0]);
    if (typeof me.teams[0]!.memberCount !== "number") throw new Error("memberCount نیست");
  });

  const created = await sdk.boards.create({ title: "بوردِ قراردادِ sdk" });
  check("4) POST /boards → board.parse سبز (createdBy/teamId/…)", () => {
    board.parse(created);
    if (created.teamId === undefined) throw new Error("teamId نیست — هنوز snake_case!");
    if (created.createdBy.displayName === undefined) throw new Error("createdBy DTO نیست");
    if (created.myRole !== "owner") throw new Error(`myRole=${created.myRole}`);
  });

  const got = await sdk.boards.get(created.id);
  check("5) GET /boards/:id → board.parse + teamId camelCase کار می‌کند", () => {
    board.parse(got);
    if (got.id !== created.id || got.teamId !== created.teamId) throw new Error("mismatch");
  });

  const list = await sdk.boards.list();
  check("6) GET /boards → boardSummary.parse روی هر ردیف", () => {
    if (list.boards.length === 0) throw new Error("empty list");
    for (const b of list.boards) boardSummary.parse(b);
  });

  const fld = await sdk.folders.create(me.teams[0]!.id, { name: "فولدرِ قرارداد" });
  check("7) POST folder → folder.parse سبز", () => {
    folder.parse(fld);
    if (fld.teamId !== me.teams[0]!.id) throw new Error("teamId mismatch");
  });

  // ★ خطای §۵ → SdkError با code
  let sdkErr: unknown;
  try {
    await sdk.boards.get("11111111-1111-1111-1111-111111111111");
  } catch (e) {
    sdkErr = e;
  }
  check("8) بوردِ ناموجود → SdkError با code=BOARD_NOT_FOUND و requestId", () => {
    if (!(sdkErr instanceof SdkError)) throw new Error("SdkError نبود");
    if (sdkErr.status !== 404 || sdkErr.code !== "BOARD_NOT_FOUND") {
      throw new Error(`status=${sdkErr.status} code=${sdkErr.code}`);
    }
    if (typeof sdkErr.requestId !== "string") throw new Error("requestId نیست");
  });

  // ══ billing (M4 فاز ۸) ═══════════════════════════════════════════════
  const teamId = verified.personalTeamId;

  // ۹ — فهرستِ پلن‌ها **قبل از** فعال‌کردنِ پلنِ آزمایشی، وگرنه چکِ «فقط فعال‌ها» بی‌معناست.
  const publicPlans = await sdk.billing.plans();
  check("9) GET /billing/plans → plan.parse + فقط پلنِ **فعال** دیده می‌شود", () => {
    if (publicPlans.plans.length === 0) throw new Error("هیچ پلنی برنگشت (migrate نشده؟)");
    for (const p of publicPlans.plans) plan.parse(p);
    const codes = publicPlans.plans.map((p) => p.code);
    // ⚠️ از فاز ۹ (migration `0006`) قیمتِ `pro`/`team` تایید شد و فعال شدند، پس **باید**
    //    دیده شوند. تنها پلنی که هرگز عمومی نمی‌شود `personal` است — و دلیلش قیمت نیست،
    //    فروختنی‌نبودن است (به فضای شخصی تخصیص داده می‌شود).
    if (codes.includes("personal")) {
      throw new Error("personal نباید عمومی باشد — تخصیصی است، نه خریدنی");
    }
    for (const sellable of ["pro", "team"]) {
      if (!codes.includes(sellable)) throw new Error(`${sellable} فعال است ولی در فهرست نیست`);
    }
    // ★ پلنِ فعالِ **پولی** باید قیمتِ ناصفر داشته باشد، وگرنه checkout با ۴۰۹ می‌افتد و
    //   کاربر فقط یک خطای گنگ می‌بیند (نگهبانِ `plans_paid_price_ck` هم همین است).
    for (const p of publicPlans.plans) {
      if (p.code !== "free" && p.priceMonthlyRial <= 0) {
        throw new Error(`پلنِ فعالِ «${p.code}» قیمتِ صفر دارد`);
      }
    }
    // ★ سقفِ نامحدود روی سیم `-1` است، نه `null` و نه `Infinity` (که JSON اصلاً ندارد).
    //   ⚠️ `Plan` سقف‌ها را **تخت** دارد (`maxBoards`)، برخلافِ `Team` که `limits` تودرتوست.
    for (const p of publicPlans.plans) {
      if (!Number.isInteger(p.maxBoards)) throw new Error("maxBoards عددِ صحیح نیست");
      if (!Number.isInteger(p.priceMonthlyRial)) throw new Error("priceMonthlyRial عددِ صحیح نیست");
    }
  });

  // پلنِ آزمایشیِ **پولی** — `free` صفر است و اصلاً به درگاه نمی‌رود.
  const probePlan = "probe_sdk";
  await app.db.query(
    `INSERT INTO plans (code, name, description, price_monthly_rial, price_yearly_rial,
                        max_members, max_boards, max_storage_bytes, features, is_active, sort_order)
     VALUES ($1, 'پلنِ قرارداد', 'فقط برای sdk:contract', 2500000, 25000000, 5, -1, 1073741824,
             '[]'::jsonb, true, 97)
     ON CONFLICT (code) DO UPDATE SET is_active = true`,
    [probePlan],
  );

  // ۱۰/۱۱ — checkout، و **همان کلید دو بار**.
  const idemKey = `contract-${randomUUID()}`;
  const first = await sdk.billing.checkout(
    teamId,
    { planCode: probePlan, period: "monthly", seats: 2 },
    { idempotencyKey: idemKey },
  );
  const second = await sdk.billing.checkout(
    teamId,
    { planCode: probePlan, period: "monthly", seats: 2 },
    { idempotencyKey: idemKey },
  );
  check("10) POST checkout → paymentId + redirectUrlِ درگاه", () => {
    if (typeof first.paymentId !== "string" || first.paymentId.length === 0) {
      throw new Error("paymentId نیست");
    }
    if (!first.redirectUrl.includes("/billing/mock/pay/")) {
      throw new Error(`redirectUrl مالِ درگاهِ تزریق‌شده نیست: ${first.redirectUrl}`);
    }
  });
  check("11) ★★ همان Idempotency-Key ⇒ همان پرداخت (هدر از sdk تا دیتابیس رفت)", () => {
    if (first.paymentId !== second.paymentId) {
      throw new Error(`دو پرداختِ متفاوت: ${first.paymentId} ≠ ${second.paymentId}`);
    }
  });

  // ۱۲ — تسویه از راهِ verifyِ دستی (callback یک مسیرِ **مرورگری** است، نه sdk).
  const settled = await sdk.billing.verifyPayment(first.paymentId);
  const sub = await sdk.billing.subscription(teamId);
  check("12) verify → subscription.parse سبز و اشتراک فعال است", () => {
    if (!settled.settled) throw new Error("settled=false");
    if (sub.subscription === null) throw new Error("اشتراک null است — فعال نشد");
    subscription.parse(sub.subscription);
    if (sub.subscription.planCode !== probePlan) {
      throw new Error(`planCode=${sub.subscription.planCode}`);
    }
    if (sub.subscription.status !== "active") throw new Error(`status=${sub.subscription.status}`);
  });

  // ۱۳ — ★★ عددِ ریالی روی **سیم**: اگر رشته بیاید، همین‌جا می‌شکند نه در مرورگر.
  const invoices = await sdk.billing.invoices(teamId);
  check("13) ★★ invoice.parse سبز و `totalRial` عددِ صحیح است (نه رشته — B-2/B-3)", () => {
    if (invoices.invoices.length === 0) throw new Error("فاکتوری نیست");
    for (const inv of invoices.invoices) invoice.parse(inv);
    const paid = invoices.invoices.find((i) => i.status === "paid");
    if (paid === undefined) throw new Error("فاکتورِ paid پیدا نشد");
    if (typeof paid.totalRial !== "number") {
      throw new Error(`totalRial رشته است: ${typeof paid.totalRial}`);
    }
    if (paid.subtotalRial - paid.discountRial + paid.vatRial !== paid.totalRial) {
      throw new Error("رابطه‌ی ADR-052 روی سیم برقرار نیست");
    }
  });

  // ۱۴ — لغو در پایانِ دوره، نه بی‌درنگ.
  const canceled = await sdk.billing.cancel(teamId);
  check("14) cancel → cancelAtPeriodEnd=true و اشتراک هنوز زنده است", () => {
    subscription.parse(canceled.subscription);
    if (!canceled.subscription.cancelAtPeriodEnd) throw new Error("cancelAtPeriodEnd=false");
    if (canceled.subscription.status !== "active") {
      throw new Error(`بی‌درنگ بسته شد: ${canceled.subscription.status}`);
    }
  });

  // ۱۵ — ★ فیلدهای مالیِ Team روی سیم (یافته‌ی فاز ۶ی M3: در مرورگر `undefined` بود).
  const after = await sdk.me.get();
  check("15) ★ Team.limits/usage/planCode روی سیم هستند و با اشتراک هم‌خوان‌اند", () => {
    const t = after.teams.find((x) => x.id === teamId);
    if (t === undefined) throw new Error("تیمِ شخصی در /me نیست");
    team.parse(t);
    if (t.planCode !== probePlan) throw new Error(`planCode=${t.planCode} (اشتراک دیده نشد)`);
    if (t.subscriptionStatus !== "active") {
      throw new Error(`subscriptionStatus=${t.subscriptionStatus}`);
    }
    if (typeof t.limits.maxStorageBytes !== "number") throw new Error("limits عدد نیست");
    if (typeof t.usage.boards !== "number") throw new Error("usage عدد نیست");
  });

  // ۱۶ — ★★ authorityِ تکراری: پاکیزه بیفت، نه ۵۰۰ی خام با یک ردیفِ یتیم.
  //
  // این چک از یک شکستنِ عمدیِ فاز ۸ زاده شد: authorityِ `MockGateway` بینِ پروسه‌ها یکتا
  // نبود، پس دومین اجرای هر اسکریپت روی `payments_authority_uq` می‌خورد. آن‌وقت معلوم شد
  // مسیرِ checkout برای این حالت **هیچ گاردی ندارد**: ۵۰۰ی خام + یک `pending`ِ بدونِ
  // authority که تا ابد «یتیم» گزارش می‌شود.
  {
    const stuck = `DUP${randomUUID().replace(/-/g, "").slice(0, 28)}`;
    const dupApp = await buildApp({
      config,
      gateway: new MockGateway({
        checkoutBaseUrl: "http://local/billing/mock/pay",
        authorityFactory: () => stuck, // ← همیشه همان یکی
      }),
    });
    await dupApp.ready();
    const dupSdk = createClient({ baseUrl: "", fetch: injectFetch(dupApp) });
    await dupSdk.auth.requestOtp({ phone });
    await dupSdk.auth.verifyOtp({ phone, code: "424242" });

    const okOne = await dupSdk.billing.checkout(teamId, {
      planCode: probePlan,
      period: "monthly",
      seats: 1,
    });
    let dupErr: unknown;
    try {
      await dupSdk.billing.checkout(teamId, { planCode: probePlan, period: "monthly", seats: 1 });
    } catch (e) {
      dupErr = e;
    }
    const orphans = await dupApp.db.query<{ n: string }>(
      `SELECT count(*) n FROM payments
        WHERE team_id = $1 AND status = 'pending' AND authority IS NULL`,
      [teamId],
    );
    await dupApp.close();

    check("16) ★★ authorityِ تکراری ⇒ ۵۰۲ی تمیز، بدونِ ردیفِ یتیمِ جامانده", () => {
      if (typeof okOne.paymentId !== "string") throw new Error("checkoutِ اول باید موفق باشد");
      if (!(dupErr instanceof SdkError)) throw new Error(`SdkError نبود: ${String(dupErr)}`);
      if (dupErr.status !== 502 || dupErr.code !== "GATEWAY_UNAVAILABLE") {
        throw new Error(`status=${dupErr.status} code=${dupErr.code} (۵۰۰ی خام؟)`);
      }
      if (Number(orphans.rows[0]!.n) !== 0) {
        throw new Error(`${orphans.rows[0]!.n} ردیفِ pendingِ بدونِ authority جا مانده`);
      }
    });
  }

  // ⚠️ **این اسکریپت ردیفِ `pending` جا نمی‌گذارد.** ردیفی که این‌جا می‌مانْد، بعداً در
  //    سنجه‌ی آشتی‌دهی به‌عنوانِ «کارِ باقی‌مانده» دیده می‌شد — یعنی یک گیت، گیتِ دیگری را
  //    آلوده می‌کرد (و دقیقاً همین یک‌بار رخ داد).
  const leftovers = await app.db.query<{ invoice_id: string | null }>(
    `DELETE FROM payments
      WHERE team_id = $1 AND status = 'pending' RETURNING invoice_id`,
    [teamId],
  );
  for (const row of leftovers.rows) {
    if (row.invoice_id !== null) {
      await app.db.query("DELETE FROM invoices WHERE id = $1 AND status <> 'paid'", [
        row.invoice_id,
      ]);
    }
  }

  // ⚠️ پلن **حذف نمی‌شود** (اشتراک به `plans(code)` ارجاع دارد و RESTRICT است) — فقط
  //    غیرفعال می‌شود تا اجرای بعدیِ چکِ ۹ سالم بماند.
  await app.db.query("UPDATE plans SET is_active = false WHERE code = $1", [probePlan]);

  // ══ پنلِ ادمین (M6 فاز ۳) — sdk.admin روی apiِ واقعی ═══════════════════════════
  //
  // ★ مسیرهای `/admin` در سندِ عمومیِ OpenAPI نیستند (internal)، پس این تنها جایی است که
  //   شکلِ پاسخشان با zodِ shared-types روی سیمِ واقعی سنجیده می‌شود.
  // ⚠️ فیکسچرِ صریح، نه تکیه به وضعِ محیط: اگر کسی به همین شماره دستی staff داده باشد
  //    (مثلاً برای یک اثباتِ مرورگر)، این چک بی‌دلیل قرمز می‌شد. یک گیت نباید به حالتِ
  //    محیطی که خودش نساخته تکیه کند.
  await app.db.query("UPDATE users SET is_staff = false WHERE id = $1", [verified.user!.id]);
  let adminErr: unknown;
  try {
    await sdk.admin.me();
  } catch (e) {
    adminErr = e;
  }
  check("17) کاربرِ عادی → GET /admin/me ⇒ ۴۰۳ FORBIDDEN (توکنِ معتبر کافی نیست)", () => {
    if (!(adminErr instanceof SdkError)) throw new Error("SdkError نبود");
    if (adminErr.status !== 403 || adminErr.code !== "FORBIDDEN") {
      throw new Error(`status=${adminErr.status} code=${adminErr.code}`);
    }
  });

  // ★ همان کاربر staff می‌شود (فقط برای این اجرا؛ آخرش برمی‌گردد) — همان چیزی که
  //   `admin-grant-staff` می‌کند، این‌جا بدونِ ردیفِ audit چون فیکسچر است نه عملِ اپراتور.
  await app.db.query("UPDATE users SET is_staff = true WHERE id = $1", [verified.user!.id]);
  try {
    const meAdmin = await sdk.admin.me();
    check("18) staff → adminMe.parse سبز؛ isStaff=true؛ stepUpVerifiedAt=null (هرگز)", () => {
      adminMe.parse(meAdmin);
      if (meAdmin.userId !== verified.user!.id) throw new Error("userId mismatch");
      if (meAdmin.stepUpVerifiedAt !== null) throw new Error("stepUpVerifiedAt باید null باشد");
    });

    // step-up: کد به شماره‌ی خودِ staff (mock، کدِ ثابت) → verify → stepUpVerifiedAt تازه.
    const requested = await sdk.admin.stepUp.request();
    let wrong: unknown;
    try {
      await sdk.admin.stepUp.verify({ code: "000000" });
    } catch (e) {
      wrong = e;
    }
    const verifiedStepUp = await sdk.admin.stepUp.verify({ code: "424242" });
    check(
      "19) ★ step-up: request ok → کدِ غلط ۴۰۰ OTP_INVALID → کدِ درست ⇒ stepUpVerifiedAt تازه",
      () => {
        if (!requested.ok) throw new Error("request.ok=false");
        if (!(wrong instanceof SdkError) || wrong.code !== "OTP_INVALID") {
          throw new Error(`کدِ غلط: ${String(wrong)}`);
        }
        adminMe.parse(verifiedStepUp);
        if (verifiedStepUp.stepUpVerifiedAt === null) throw new Error("stepUpVerifiedAt هنوز null");
        // ⚠️ این مهر را **Postgres** می‌زند و این‌جا با ساعتِ **Node** سنجیده می‌شود؛ دو ساعتِ
        //   متفاوت. کفِ منفی همان رواداریِ `CLOCK_SKEW_TOLERANCE_MS`ِ گارد است — بدونش این چک
        //   تصادفی قرمز می‌شد (اندازه‌گیری: تا ۲ms جلوتر).
        const age = Date.now() - Date.parse(verifiedStepUp.stepUpVerifiedAt);
        if (!(age > -2_000 && age < 10_000)) throw new Error(`stepUpVerifiedAt تازه نیست: ${age}ms`);
      },
    );

    // ★★ step-up چالشِ **ورودِ** در جریانِ همان شماره را نمی‌کُشد (ADR-066 §پیامدها).
    await sdk.auth.requestOtp({ phone }); // چالشِ ورود
    await sdk.admin.stepUp.request(); // چالشِ step-up روی همان شماره (cooldownِ خودش جداست)
    const loginStill = await app.db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM otp_challenges
        WHERE destination = $1 AND purpose = 'login' AND consumed_at IS NULL`,
      [phone],
    );
    check("20) ★★ درخواستِ step-up چالشِ ورودِ همان شماره را consume نمی‌کند (purpose جدا)", () => {
      if (Number(loginStill.rows[0]!.n) !== 1) {
        throw new Error(`چالشِ ورودِ زنده: ${loginStill.rows[0]!.n} (باید ۱)`);
      }
    });

    // ══ audit (M6 فاز ۴، ADR-067) — ردیف‌های واقعی در همان تراکنش ══════════════════
    const staffId = verified.user!.id;
    const audits = await app.db.query<{
      action: string;
      actor_user_id: string | null;
      target_type: string | null;
      target_id: string | null;
      ip: string | null;
    }>(
      `SELECT action, actor_user_id, target_type, target_id, host(ip) AS ip
         FROM audit_logs WHERE actor_user_id = $1 ORDER BY id`,
      [staffId],
    );
    check("21) ★ step-up دو ردیفِ request + یک ردیفِ staff.step_up با actor/target/ip نوشت", () => {
      const actions = audits.rows.map((r) => r.action);
      const requests = actions.filter((a) => a === "staff.step_up.request").length;
      const verifies = audits.rows.filter((r) => r.action === "staff.step_up");
      if (requests !== 2) throw new Error(`staff.step_up.request: ${String(requests)} (باید ۲)`);
      if (verifies.length !== 1)
        throw new Error(`staff.step_up: ${String(verifies.length)} (باید ۱)`);
      const v = verifies[0]!;
      if (v.target_type !== "user" || v.target_id !== staffId) throw new Error("target غلط");
      if (v.ip === null) throw new Error("ip ذخیره نشد (inject ⇒ 127.0.0.1)");
    });

    // ★★ اتمیک: recordAudit داخلِ تراکنشی که بعدش می‌شکند ⇒ هیچ ردیفی (ADR-067 §۱).
    const before = audits.rows.length;
    let threw = false;
    try {
      await withTransaction(app.db, async (tx) => {
        await recordAudit(tx, {
          actor: { userId: staffId, ip: "127.0.0.1", userAgent: null },
          action: "staff.revoke",
          target: { type: "user", id: staffId },
        });
        throw new Error("عمل شکست خورد");
      });
    } catch {
      threw = true;
    }
    const after = await app.db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_logs WHERE actor_user_id = $1",
      [staffId],
    );
    check("22) ★★ عمل شکست می‌خورد ⇒ ردیفِ auditِ همان تراکنش هم نمی‌مانَد", () => {
      if (!threw) throw new Error("تراکنش باید شکسته باشد");
      if (Number(after.rows[0]!.n) !== before) {
        throw new Error(`ردیف‌ها ${String(before)} → ${after.rows[0]!.n}`);
      }
    });

    // ══ GET /admin/audit (فاز ۴٫۳) — DTO روی سیم، keyset، ماسک، فیلتر، cursorِ خراب ═══════
    const page1 = await sdk.admin.audit({ actor: staffId, limit: 2 });
    const page2 = page1.nextCursor
      ? await sdk.admin.audit({ actor: staffId, limit: 2, cursor: page1.nextCursor })
      : null;
    check(
      "23) ★ audit: auditLogEntry.parse روی هر ردیف؛ ip ماسک (نه 127.0.0.1)؛ actor/target درست",
      () => {
        if (page1.items.length !== 2)
          throw new Error(`صفحه‌ی ۱: ${String(page1.items.length)} (باید ۲)`);
        for (const e of page1.items) auditLogEntry.parse(e);
        for (const e of page1.items) {
          if (e.ipMasked === "127.0.0.1") throw new Error("IP کامل لو رفت");
          if (e.ipMasked !== "127.0.x.x") throw new Error(`ماسک: ${String(e.ipMasked)}`);
          if (e.actorUserId !== staffId) throw new Error("actor غلط");
        }
      },
    );
    check("24) ★ keyset: صفحه‌ی ۲ ردیفِ متفاوت و قدیمی‌تر می‌دهد؛ آخرش nextCursor=null", () => {
      if (page1.nextCursor === null) throw new Error("۳ ردیف هست، پس صفحه‌ی ۱ باید cursor بدهد");
      if (page2 === null || page2.items.length !== 1) throw new Error("صفحه‌ی ۲ باید یک ردیف باشد");
      const ids1 = page1.items.map((e) => e.id);
      if (ids1.includes(page2.items[0]!.id)) throw new Error("ردیفِ تکراری بینِ دو صفحه");
      if (page2.items[0]!.id >= Math.min(...ids1)) throw new Error("ترتیبِ DESC رعایت نشد");
      if (page2.nextCursor !== null) throw new Error("پایان باید null باشد");
    });
    const onlyVerify = await sdk.admin.audit({
      actor: staffId,
      action: "staff.step_up",
      limit: 10,
    });
    let badCursor: unknown;
    try {
      await sdk.admin.audit({ cursor: "zzz" });
    } catch (e) {
      badCursor = e;
    }
    check("25) فیلترِ پیشوندیِ action و cursorِ خراب ⇒ ۴۰۰ VALIDATION_ERROR (نه «از اول»)", () => {
      // `staff.step_up` پیشوندِ `staff.step_up.request` هم هست ⇒ ۳ ردیف، نه ۱.
      if (onlyVerify.items.length !== 3)
        throw new Error(`پیشوندی: ${String(onlyVerify.items.length)} (باید ۳)`);
      if (
        !(badCursor instanceof SdkError) ||
        badCursor.status !== 400 ||
        badCursor.code !== "VALIDATION_ERROR"
      ) {
        throw new Error(`cursorِ خراب: ${String(badCursor)}`);
      }
    });

    // ══ فاز ۵ — کاربران و تیم‌ها، تعلیق، staff→viewer، نمای پشتیبانی (ADR-066) ═══════════
    //
    // یک کاربرِ **هدف** با ورودِ واقعیِ OTP (نشست + refresh)، یک بوردِ خصوصیِ خودش؛ آخرش کامل پاک می‌شود.
    const targetPhone = "09120009002";
    let suspendedReason: { code: string } | undefined;
    // ⚠️ inject کوکی ندارد؛ refreshِ sdk در مرورگر از کوکیِ HttpOnly می‌آید. این‌جا همان توکن در بدنه می‌رود
    //   (شکلِ devِ /auth/refresh) تا مسیرِ `onSessionEnded(reason)`ِ sdk روی سرورِ واقعی سنجیده شود.
    const targetRefresh = { token: undefined as string | undefined };
    const baseFetch = injectFetch(app);
    const sdkTarget = createClient({
      baseUrl: "",
      fetch: (url, init) =>
        url.endsWith("/auth/refresh") && targetRefresh.token !== undefined
          ? baseFetch(url, {
              ...init,
              headers: {
                ...(init.headers as Record<string, string>),
                "content-type": "application/json",
              },
              body: JSON.stringify({ refreshToken: targetRefresh.token }),
            })
          : baseFetch(url, init),
      onSessionEnded: (reason) => {
        suspendedReason = reason;
      },
    });
    await sdkTarget.auth.requestOtp({ phone: targetPhone });
    const targetLogin = await sdkTarget.auth.verifyOtp({ phone: targetPhone, code: "424242" });
    const targetId = targetLogin.user!.id;
    targetRefresh.token = targetLogin.refreshToken;
    const targetBoard = await sdkTarget.boards.create({ title: "بوردِ خصوصیِ هدف" });
    try {
      const found = await sdk.admin.search(targetPhone);
      const foundFa = await sdk.admin.search("۰۹۱۲۰۰۰۹۰۰۲");
      const prefix = await sdk.admin.search("0912000900");
      const searchAudit = await app.db.query<{ n: string; kinds: string[] }>(
        `SELECT count(*)::text AS n, array_agg(metadata->>'kind') AS kinds
           FROM audit_logs WHERE action = 'user.search' AND actor_user_id = $1`,
        [staffId],
      );
      check(
        "26) search: شماره‌ی کامل (لاتین و فارسی یکی) ⇒ فقط هدف؛ پیشوندِ ۱۰رقمی شماره نیست ⇒ صفر؛ شماره ماسک، فیلدِ phone نیست؛ هر جست‌وجو یک ردیفِ user.search بدونِ عبارت",
        () => {
          adminSearchResult.parse(found);
          if (found.users.length !== 1 || found.users[0]!.id !== targetId)
            throw new Error(`شماره‌ی کامل: ${String(found.users.length)} نتیجه`);
          if (foundFa.users.length !== 1 || foundFa.users[0]!.id !== targetId)
            throw new Error("ارقامِ فارسی نرمال نشد");
          // ★ یافته‌ی ۵٫۵: پیشوند دیگر شماره نیست — وگرنه ماسک رقم‌به‌رقم بازسازی می‌شد بی‌ردیفِ reveal.
          if (prefix.users.length !== 0) throw new Error("پیشوندِ ۱۰رقمی نباید کاربری بدهد");
          const tu = found.users[0]!;
          if (tu.phoneMasked !== "0912***02") throw new Error(`ماسک: ${String(tu.phoneMasked)}`);
          if ("phone" in tu) throw new Error("فیلدِ phone روی سیم لو رفت");
          if (found.teams.length !== 0) throw new Error("شماره تیم ندارد");
          const r = searchAudit.rows[0]!;
          if (Number(r.n) !== 3) throw new Error(`user.search: ${r.n} ردیف (باید ۳)`);
          if (r.kinds.filter((k) => k === "phone").length !== 2 || !r.kinds.includes("text"))
            throw new Error(`kinds: ${r.kinds.join(",")}`);
        },
      );

      const detail = await sdk.admin.users.get(targetId);
      check(
        "27) users.get: adminUserDetail.parse؛ تیمِ شخصی با نقشِ owner؛ boardCount=1؛ نشستِ زنده ≥ ۱",
        () => {
          adminUserDetail.parse(detail);
          const personal = detail.teams.find((x) => x.isPersonal);
          if (personal === undefined || personal.role !== "owner") throw new Error("تیمِ شخصی/نقش");
          if (detail.boardCount !== 1) throw new Error(`boardCount=${String(detail.boardCount)}`);
          if (detail.activeSessions < 1) throw new Error("نشستِ زنده باید ≥ ۱ باشد");
          if (detail.status !== "active") throw new Error("status");
        },
      );

      const revealed = await sdk.admin.users.revealPhone(targetId);
      const revealRows = await app.db.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM audit_logs WHERE action = 'user.phone.reveal' AND target_id = $1 AND actor_user_id = $2",
        [targetId, staffId],
      );
      check(
        "28) phone/reveal ⇒ شماره‌ی کامل + ردیفِ auditِ user.phone.reveal با target=کاربر",
        () => {
          if (revealed.phone !== targetPhone) throw new Error("شماره‌ی کامل غلط");
          if (Number(revealRows.rows[0]!.n) !== 1) throw new Error("ردیفِ reveal نیست");
        },
      );

      // ★★ ۵٫۳: staff روی بوردِ خصوصیِ غریبه — viewer، نه owner (probe ۱٫۱ برعکس شد)
      // ★ اول خواندنِ REST (بدونِ rt-token): ردیفِ support.board.view باید از همین خواندن بیاید، نه فقط از mint.
      const staffView = await sdk.boards.get(targetBoard.id);
      const supportAfterRest = await app.db.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM audit_logs WHERE action = 'support.board.view' AND target_id = $1 AND actor_user_id = $2",
        [targetBoard.id, staffId],
      );
      const rt1 = await sdk.boards.rtToken(targetBoard.id);
      const rt2 = await sdk.boards.rtToken(targetBoard.id);
      const roleOf = (jwt: string): string =>
        (JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString()) as { role: string })
          .role;
      let staffWrite: unknown;
      try {
        await sdk.boards.update(targetBoard.id, { title: "staff نوشت" });
      } catch (e) {
        staffWrite = e;
      }
      const supportRows = await app.db.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM audit_logs WHERE action = 'support.board.view' AND target_id = $1 AND actor_user_id = $2",
        [targetBoard.id, staffId],
      );
      check(
        "29) ★★ staff→viewer: GET بورد myRole=viewer و همان خواندن ردیفِ support.board.view می‌نویسد؛ rt-token role=viewer؛ PATCH ۴۰۳؛ دو mintِ بعدی ردیفِ نو نمی‌سازند (de-dupe)",
        () => {
          if (Number(supportAfterRest.rows[0]!.n) !== 1)
            throw new Error(
              `بعد از GET /boards/:id بدونِ rt-token: ${supportAfterRest.rows[0]!.n} ردیف (باید ۱)`,
            );
          if (roleOf(rt1.token) !== "viewer" || roleOf(rt2.token) !== "viewer")
            throw new Error(`نقشِ rt-token: ${roleOf(rt1.token)}`);
          if (staffView.myRole !== "viewer") throw new Error(`myRole=${staffView.myRole}`);
          if (!(staffWrite instanceof SdkError) || staffWrite.status !== 403)
            throw new Error("staff باید ۴۰۳ بگیرد");
          if (Number(supportRows.rows[0]!.n) !== 1)
            throw new Error(`support.board.view: ${supportRows.rows[0]!.n} (باید ۱)`);
        },
      );

      const tb = await sdk.admin.users.boards(targetId);
      check(
        "30) users.boards (نمای پشتیبانی): بوردِ خصوصیِ هدف با role=owner (نقشِ خودش، نه staff)",
        () => {
          for (const b of tb.items) adminUserBoard.parse(b);
          const mine = tb.items.find((b) => b.id === targetBoard.id);
          if (mine === undefined) throw new Error("بوردِ هدف در فهرست نیست");
          if (mine.role !== "owner") throw new Error(`role=${mine.role}`);
          if (mine.deletedAt !== null) throw new Error("deletedAt باید null باشد");
        },
      );

      // ★★ ۵٫۲: تعلیق — اول ۴۲۸ (step-up کهنه)، بعد ۲۰۰ در یک تراکنش
      // ★ یافته‌ی ۵٫۵: یک چالشِ ورود **پیش از** تعلیق ساخته می‌شود؛ بعد از تعلیق نباید نشست بسازد (۳۲b).
      await sdkTarget.auth.requestOtp({ phone: targetPhone });
      await app.db.query("UPDATE users SET step_up_verified_at = NULL WHERE id = $1", [staffId]);
      let noStepUp: unknown;
      try {
        await sdk.admin.users.suspend(targetId, { reason: "آزمونِ قرارداد" });
      } catch (e) {
        noStepUp = e;
      }
      await app.db.query("UPDATE users SET step_up_verified_at = now() WHERE id = $1", [staffId]);
      const suspended = await sdk.admin.users.suspend(targetId, { reason: "آزمونِ قرارداد" });
      const afterSuspend = await app.db.query<{ status: string; live: string; revoked: string }>(
        `SELECT u.status,
                (SELECT count(*) FROM auth_sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL)::text AS live,
                (SELECT count(*) FROM auth_sessions s WHERE s.user_id = u.id AND s.revoked_at IS NOT NULL)::text AS revoked
           FROM users u WHERE u.id = $1`,
        [targetId],
      );
      const suspendAudit = await app.db.query<{
        metadata: { reason?: string; sessionsRevoked?: number; challengesConsumed?: number };
      }>("SELECT metadata FROM audit_logs WHERE action = 'user.suspend' AND target_id = $1", [
        targetId,
      ]);
      check(
        "31) ★★ suspend: بدونِ step-up ۴۲۸ STEP_UP_REQUIRED؛ با step-up ۲۰۰ ⇒ status=suspended، همه‌ی نشست‌ها سوخته، audit با reason/sessionsRevoked",
        () => {
          if (
            !(noStepUp instanceof SdkError) ||
            noStepUp.status !== 428 ||
            noStepUp.code !== "STEP_UP_REQUIRED"
          )
            throw new Error(`بدونِ step-up: ${String(noStepUp)}`);
          adminUserSummary.parse(suspended);
          if (suspended.status !== "suspended") throw new Error("پاسخ status=suspended نیست");
          const r = afterSuspend.rows[0]!;
          if (r.status !== "suspended") throw new Error("DB status");
          if (Number(r.live) !== 0) throw new Error(`نشستِ زنده مانده: ${r.live}`);
          if (Number(r.revoked) < 1) throw new Error("هیچ نشستی نسوخت");
          const m = suspendAudit.rows[0]?.metadata;
          if (m?.reason !== "آزمونِ قرارداد" || (m.sessionsRevoked ?? 0) < 1)
            throw new Error(`metadata: ${JSON.stringify(m)}`);
          // ★ عدد = نشست‌های **زنده** (هدف یک‌بار وارد شده و هرگز نچرخانده ⇒ دقیقاً ۱)، نه هر ردیفی که دست خورد.
          if (m.sessionsRevoked !== 1)
            throw new Error(`sessionsRevoked=${String(m.sessionsRevoked)} (باید ۱)`);
          if (typeof m.challengesConsumed !== "number") throw new Error("challengesConsumed نیست");
        },
      );

      // ★★ نقاطِ ورود بعد از تعلیق (ADR-066 §۴)
      const refreshRes = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: { refreshToken: targetLogin.refreshToken },
      });
      const sdkRefresh = await sdkTarget.auth.refresh();
      const chBefore = await app.db.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM otp_challenges WHERE destination = $1",
        [targetPhone],
      );
      const otpRes = await sdkTarget.auth.requestOtp({ phone: targetPhone });
      const chAfter = await app.db.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM otp_challenges WHERE destination = $1",
        [targetPhone],
      );
      let rtSuspended: unknown;
      try {
        await sdkTarget.boards.rtToken(targetBoard.id);
      } catch (e) {
        rtSuspended = e;
      }
      // ★ ۳۲b: چالشِ پیش از تعلیق — تعلیق مصرفش کرده (challengesConsumed ≥ ۱)؛ و حتی اگر نکرده بود، verify
      //   خودش status را می‌سنجد. با کدِ ثابتِ dev تلاش می‌کنیم: نباید نشست بسازد.
      let verifyAfter: unknown;
      try {
        await sdkTarget.auth.verifyOtp({ phone: targetPhone, code: "424242" });
      } catch (e) {
        verifyAfter = e;
      }
      // ★ ۳۲c: مسابقه‌ی request↔suspend شبیه‌سازی می‌شود — چالشی که **بعد** از تعلیق در store می‌نشیند (همان‌طور که
      //   یک requestِ هم‌زمان می‌توانست بگذارد). حالا فقط چکِ status در verify جلویش را می‌گیرد.
      const nowSec = Math.floor(Date.now() / 1000);
      await createPgOtpStore(app.db).set(targetPhone, {
        codeHash: createHash("sha256").update("424242").digest("hex"),
        attempts: 0,
        expiresAt: nowSec + 120,
        createdAt: nowSec,
      });
      let verifyRaced: unknown;
      try {
        await sdkTarget.auth.verifyOtp({ phone: targetPhone, code: "424242" });
      } catch (e) {
        verifyRaced = e;
      }
      const liveAfterVerify = await app.db.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM auth_sessions WHERE user_id = $1 AND revoked_at IS NULL",
        [targetId],
      );
      check(
        "32) ★★ معلق: refresh ۴۰۱ USER_SUSPENDED + کوکی پاک؛ sdk onSessionEnded با همان کد؛ OTP ۲۰۰ی بی‌صدا (چالشِ نو نه)؛ rt-token ۴۰۳",
        () => {
          if (refreshRes.statusCode !== 401)
            throw new Error(`refresh ${String(refreshRes.statusCode)}`);
          if (refreshRes.json<{ error: { code: string } }>().error.code !== "USER_SUSPENDED")
            throw new Error("کدِ refresh");
          const sc = String(refreshRes.headers["set-cookie"] ?? "");
          if (!/refresh_token=;/.test(sc)) throw new Error(`کوکی پاک نشد: ${sc}`);
          if (sdkRefresh !== false || suspendedReason?.code !== "USER_SUSPENDED")
            throw new Error(`sdk: ${String(sdkRefresh)} / ${JSON.stringify(suspendedReason)}`);
          if (!otpRes.ok) throw new Error("OTP باید ۲۰۰ بدهد");
          if (chAfter.rows[0]!.n !== chBefore.rows[0]!.n)
            throw new Error("چالشِ OTP برای معلق ساخته شد");
          if (!(rtSuspended instanceof SdkError) || rtSuspended.status !== 403)
            throw new Error(`rt-token: ${String(rtSuspended)}`);
          // ۳۲b — چالش مصرف شده ⇒ OTP_INVALID (یا اگر مانده بود ⇒ USER_SUSPENDED)؛ هر دو قابلِ قبول، نشستِ نو **نه**.
          if (
            !(verifyAfter instanceof SdkError) ||
            !["OTP_INVALID", "USER_SUSPENDED"].includes(verifyAfter.code)
          )
            throw new Error(`verify بعد از تعلیق: ${String(verifyAfter)}`);
          // ۳۲c — چالشِ کاشته‌شده‌ی معتبر ⇒ **USER_SUSPENDED** (کد درست بود؛ status جلویش را گرفت)، نشستِ نو نه.
          if (!(verifyRaced instanceof SdkError) || verifyRaced.code !== "USER_SUSPENDED")
            throw new Error(`verify با چالشِ کاشته‌شده: ${String(verifyRaced)}`);
          if (Number(liveAfterVerify.rows[0]!.n) !== 0)
            throw new Error(`verify بعد از تعلیق نشستِ زنده ساخت: ${liveAfterVerify.rows[0]!.n}`);
        },
      );

      let twice: unknown;
      try {
        await sdk.admin.users.suspend(targetId, { reason: "دوباره" });
      } catch (e) {
        twice = e;
      }
      let self: unknown;
      try {
        await sdk.admin.users.suspend(staffId, { reason: "خودم" });
      } catch (e) {
        self = e;
      }
      check(
        "33) تعلیقِ دوباره ۴۰۹ INVALID_TRANSITION؛ تعلیقِ staff ۴۰۹ CONFLICT (اول سلب از ایمیج)",
        () => {
          if (!(twice instanceof SdkError) || twice.code !== "INVALID_TRANSITION")
            throw new Error(`دوباره: ${String(twice)}`);
          if (!(self instanceof SdkError) || self.status !== 409 || self.code !== "CONFLICT")
            throw new Error(`staff: ${String(self)}`);
        },
      );

      const unsuspended = await sdk.admin.users.unsuspend(targetId);
      const refreshAfter = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: { refreshToken: targetLogin.refreshToken },
      });
      const chBeforeReact = await app.db.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM otp_challenges WHERE destination = $1",
        [targetPhone],
      );
      await sdkTarget.auth.requestOtp({ phone: targetPhone });
      const chReactivated = await app.db.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM otp_challenges WHERE destination = $1",
        [targetPhone],
      );
      const unsuspendAudit = await app.db.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM audit_logs WHERE action = 'user.unsuspend' AND target_id = $1",
        [targetId],
      );
      check(
        "34) unsuspend: status=active + audit؛ نشست‌ها برنمی‌گردند (refresh ۴۰۱ ولی نه USER_SUSPENDED)؛ OTP دوباره چالش می‌سازد",
        () => {
          if (unsuspended.status !== "active") throw new Error("status");
          if (Number(unsuspendAudit.rows[0]!.n) !== 1) throw new Error("ردیفِ unsuspend");
          if (refreshAfter.statusCode !== 401) throw new Error("refresh باید هنوز ۴۰۱ باشد");
          if (refreshAfter.json<{ error: { code: string } }>().error.code === "USER_SUSPENDED")
            throw new Error("بعد از رفعِ تعلیق نباید USER_SUSPENDED بگوید");
          if (Number(chReactivated.rows[0]!.n) !== Number(chBeforeReact.rows[0]!.n) + 1)
            throw new Error("چالشِ OTP بعد از رفعِ تعلیق ساخته نشد");
        },
      );

      const personalTeam = detail.teams.find((x) => x.isPersonal)!;
      const teamDetail = await sdk.admin.teams.get(personalTeam.teamId);
      check(
        "35) teams.get: adminTeamDetail.parse؛ usage.boards=1 (count(*)ِ زنده)؛ عضوِ هدف با status",
        () => {
          adminTeamDetail.parse(teamDetail);
          if (teamDetail.usage.boards !== 1)
            throw new Error(`usage.boards=${String(teamDetail.usage.boards)}`);
          if (teamDetail.planCode !== "personal") throw new Error("planCode");
          const m = teamDetail.members.find((x) => x.userId === targetId);
          if (m === undefined || m.status !== "active") throw new Error("عضو/وضعیت");
        },
      );
      // ══ فاز ۶ — پرداخت‌ها و استرداد (ADR-068) ══════════════════════════════
      //
      // ★ روی **همان** پرداختِ چک‌های ۱۰–۱۳ که واقعاً تسویه شد، و یک پرداختِ دومِ تازه — تا سناریوی
      //   «تمدید سپس استرداد» روی سیمِ واقعی اثبات شود، نه در حرف.
      const teamPayments = await sdk.admin.payments.list({ teamId, limit: 50 });
      const paidRow = teamPayments.items.find((p) => p.id === first.paymentId);
      check(
        "36) payments.list: adminPaymentSummary.parse؛ فیلترِ تیم؛ مبلغ **عدد**؛ summary هیچ payload/کارتی ندارد",
        () => {
          if (teamPayments.items.length === 0) throw new Error("فهرست خالی است");
          for (const p of teamPayments.items) adminPaymentSummary.parse(p);
          if (paidRow === undefined) throw new Error("پرداختِ تسویه‌شده در فهرست نیست");
          if (typeof paidRow.amountRial !== "number") throw new Error("amountRial رشته است");
          if (paidRow.status !== "paid") throw new Error(`status=${paidRow.status}`);
          for (const key of ["cardPanMasked", "verifyPayload", "requestPayload"]) {
            if (key in paidRow) throw new Error(`${key} نباید در summary باشد`);
          }
          if (teamPayments.items.some((p) => p.teamId !== teamId)) throw new Error("فیلترِ تیم");
        },
      );

      const detailPay = await sdk.admin.payments.get(first.paymentId);
      check(
        "37) payments.get: detail.parse؛ verify_payload **نوشته شده**؛ فاکتور و اشتراکِ فعال‌شده؛ انقضا مسدود",
        () => {
          adminPaymentDetail.parse(detailPay);
          if (detailPay.requestPayload?.planCode !== probePlan) throw new Error("requestPayload");
          if (detailPay.verifyPayload === null)
            throw new Error("verify_payload نوشته نشد (ستونِ همیشه-NULLِ M4)");
          if (detailPay.verifyPayload.status !== "paid") throw new Error("verifyPayload.status");
          if ("cardHash" in (detailPay.verifyPayload as object))
            throw new Error("هشِ کارت نباید در verify_payload باشد (P7)");
          if (detailPay.invoice === null || detailPay.subscription === null)
            throw new Error("فاکتور/اشتراک");
          if (detailPay.expireBlocked === null || !detailPay.expireBlocked.includes("paid"))
            throw new Error(`expireBlocked=${String(detailPay.expireBlocked)}`);
        },
      );

      const verifyAgain = await sdk.admin.payments.verify(first.paymentId);
      const verifyAudit = await app.db.query<{ n: string; metadata: { outcome?: string } }>(
        "SELECT count(*)::text AS n, max(metadata::text)::jsonb AS metadata FROM audit_logs WHERE action = 'payment.verify' AND target_id = $1",
        [first.paymentId],
      );
      check(
        "38) verifyِ ادمین روی ردیفِ paid ⇒ ۲۰۰ با outcome=alreadySettled + ردیفِ auditِ همان تراکنش",
        () => {
          paymentActionResult.parse(verifyAgain);
          if (verifyAgain.outcome !== "alreadySettled")
            throw new Error(`outcome=${verifyAgain.outcome}`);
          if (Number(verifyAudit.rows[0]!.n) !== 1) throw new Error("ردیفِ payment.verify");
          if (verifyAudit.rows[0]!.metadata.outcome !== "alreadySettled")
            throw new Error("metadata.outcome");
        },
      );

      // ★ پرداختِ دوم = **تمدید**: `upsertSubscription` اشتراکِ اول را expire می‌کند و دومی را
      //   از پایانِ همان دوره لنگر می‌اندازد. حالا استردادِ دومی باید اولی را **برگردانَد**.
      await app.db.query("UPDATE plans SET is_active = true WHERE code = $1", [probePlan]);
      const renewal = await sdk.billing.checkout(
        teamId,
        { planCode: probePlan, period: "monthly", seats: 2 },
        { idempotencyKey: `contract-renew-${randomUUID()}` },
      );
      await sdk.billing.verifyPayment(renewal.paymentId);
      const subAfterRenewal = await sdk.billing.subscription(teamId);
      const refundRenewal = await sdk.admin.payments.refund(renewal.paymentId, {
        channel: "gateway",
        reason: "سنجه‌ی قرارداد — استردادِ تمدید",
      });
      const subAfterRefund = await sdk.billing.subscription(teamId);
      const renewalRow = await app.db.query<{
        status: string;
        paid_at: Date | null;
        refund_ref: string;
        refund_amount_rial: number;
        amount_rial: number;
        invoice_status: string;
      }>(
        `SELECT p.status, p.paid_at, p.refund_ref, p.refund_amount_rial, p.amount_rial,
                i.status AS invoice_status
           FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.id = $1`,
        [renewal.paymentId],
      );
      check(
        "39) ★★ استردادِ **تمدید** (کانالِ درگاه): ردیف refunded با مرجعِ درگاه، فاکتور refunded، `paid_at` می‌مانَد، و اشتراکِ **قبلی برمی‌گردد**",
        () => {
          refundResult.parse(refundRenewal);
          const r = renewalRow.rows[0]!;
          if (r.status !== "refunded") throw new Error(`status=${r.status}`);
          if (r.paid_at === null) throw new Error("paid_at پاک شد (ADR-052)");
          if (!r.refund_ref.startsWith("MOCKRF")) throw new Error(`refund_ref=${r.refund_ref}`);
          if (Number(r.refund_amount_rial) !== Number(r.amount_rial))
            throw new Error("مبلغِ استرداد ≠ مبلغِ پرداخت");
          if (r.invoice_status !== "refunded") throw new Error(`invoice=${r.invoice_status}`);
          if (refundRenewal.subscriptionCanceled !== subAfterRenewal.subscription?.id)
            throw new Error("اشتراکِ تمدید لغو نشد");
          if (refundRenewal.subscriptionRestored === null)
            throw new Error("اشتراکِ قبلی برنگشت (یافته‌ی ۲ی منتقد)");
          if (subAfterRefund.subscription?.id !== refundRenewal.subscriptionRestored)
            throw new Error("اشتراکِ زنده‌ی تیم همان بازگشته نیست");
          if (subAfterRefund.subscription.status !== "active") throw new Error("status");
        },
      );

      let secondRefund: unknown;
      try {
        await sdk.admin.payments.refund(renewal.paymentId, {
          channel: "manual",
          refundRef: "X1",
          reason: "دوباره",
        });
      } catch (e) {
        secondRefund = e;
      }
      const refundAudits = await app.db.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM audit_logs WHERE action = 'payment.refund' AND target_id = $1",
        [renewal.paymentId],
      );
      check("40) استردادِ دوباره ⇒ ۴۰۹ INVALID_TRANSITION و **هیچ** ردیفِ auditِ دوم", () => {
        if (!(secondRefund instanceof SdkError) || secondRefund.status !== 409)
          throw new Error(`خطا: ${String(secondRefund)}`);
        if (secondRefund.code !== "INVALID_TRANSITION")
          throw new Error(`code=${secondRefund.code}`);
        if (Number(refundAudits.rows[0]!.n) !== 1) throw new Error("ردیفِ auditِ دوم نوشته شد");
      });

      // ★ ردیفِ mock با حالتِ عوض‌شده ⇒ ۴۰۹ پیش از هر تماسی (یافته‌ی ۳ی منتقد).
      await app.db.query("UPDATE payments SET gateway_mode = 'production' WHERE id = $1", [
        first.paymentId,
      ]);
      let mismatch: unknown;
      try {
        await sdk.admin.payments.verify(first.paymentId);
      } catch (e) {
        mismatch = e;
      }
      await app.db.query("UPDATE payments SET gateway_mode = 'sandbox' WHERE id = $1", [
        first.paymentId,
      ]);
      check("41) ★ ردیفِ درگاه/حالتِ دیگر ⇒ ۴۰۹ CONFLICT، بدونِ دست‌زدن به ردیف", () => {
        if (!(mismatch instanceof SdkError) || mismatch.status !== 409)
          throw new Error(`خطا: ${String(mismatch)}`);
        if (mismatch.code !== "CONFLICT") throw new Error(`code=${mismatch.code}`);
      });

      const report = await sdk.admin.payments.reconcile({ dryRun: true, batchSize: 5 });
      const reconcileAudit = await app.db.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM audit_logs WHERE action = 'payment.reconcile'",
      );
      check("42) sweepِ دستی (dryRun): گزارش parse می‌شود و ردیفِ auditِ خلاصه نوشته می‌شود", () => {
        reconcileReport.parse(report);
        if (Number(reconcileAudit.rows[0]!.n) < 1) throw new Error("ردیفِ payment.reconcile");
      });

      // ★ ۴۲۸ روی عملِ مخربِ پرداخت — همان گاردِ تعلیق، این‌بار روی استرداد.
      await app.db.query("UPDATE users SET step_up_verified_at = NULL WHERE id = $1", [
        verified.user!.id,
      ]);
      let stale: unknown;
      try {
        await sdk.admin.payments.refund(first.paymentId, {
          channel: "manual",
          refundRef: "R1",
          reason: "بدونِ step-up",
        });
      } catch (e) {
        stale = e;
      }
      // ★ تازه‌کردنِ step-up این‌جا **فیکسچر** است نه چیزی که سنجیده می‌شود (چک‌های ۱۹–۲۱ مسیرِ واقعیِ
      //   OTP را اثبات کرده‌اند). با SQL انجام می‌شود تا یک درخواستِ پیامکِ اضافه، cooldownِ OTP را در
      //   اجراهای پشتِ‌سرِ هم روشن نکند — یک اجرای قرمزِ گذرا دقیقاً از همین آمد.
      await app.db.query("UPDATE users SET step_up_verified_at = now() WHERE id = $1", [
        verified.user!.id,
      ]);
      const refundManual = await sdk.admin.payments.refund(first.paymentId, {
        channel: "manual",
        refundRef: "REF-MANUAL-1",
        reason: "سنجه‌ی قرارداد — ثبتِ دستی",
      });
      const subAfterManual = await sdk.billing.subscription(teamId);
      check(
        "43) ★ استرداد بدونِ step-up ⇒ ۴۲۸؛ بعد از step-up: ثبتِ دستی با مرجعِ خودمان، اشتراک لغو، چیزی برنمی‌گردد",
        () => {
          if (!(stale instanceof SdkError) || stale.status !== 428)
            throw new Error(`انتظار ۴۲۸: ${String(stale)}`);
          if (stale.code !== "STEP_UP_REQUIRED") throw new Error(`code=${stale.code}`);
          refundResult.parse(refundManual);
          if (refundManual.payment.refundedAt === null) throw new Error("refundedAt");
          if (refundManual.subscriptionCanceled === null) throw new Error("اشتراک لغو نشد");
          // ★ بازگرداندن **فقط** دوره‌ای است که همین پرداخت جایگزینش کرده بود (پیوندِ لنگر). روی
          //   تیمی که اجراهای قبلی هم داشته ممکن است چنین ردیفی باشد یا نباشد — پس خودِ **قاعده** assert
          //   می‌شود، نه یک عددِ وابسته به تاریخچه.
          if (refundManual.subscriptionRestored === null) {
            if (subAfterManual.subscription !== null) throw new Error("تیم باید بی‌اشتراک شود");
          } else if (subAfterManual.subscription?.id !== refundManual.subscriptionRestored) {
            throw new Error("اشتراکِ زنده همان بازگشته نیست");
          }
        },
      );
    } finally {
      await app.db.query("UPDATE plans SET is_active = false WHERE code = $1", [probePlan]);
      // هدف کامل پاک می‌شود: بوردها → تیم‌ها → کاربر (نشست‌ها cascade)؛ ردیف‌های audit با actor=staff پایین.
      await app.db.query("DELETE FROM boards WHERE created_by = $1", [targetId]);
      await app.db.query("DELETE FROM teams WHERE owner_user_id = $1", [targetId]);
      await app.db.query("DELETE FROM otp_challenges WHERE destination = $1", [targetPhone]);
      await app.db.query("DELETE FROM users WHERE id = $1", [targetId]);
    }

      // ── فاز ۷ — آمار و وضعیتِ سیستم (ADR-067) ──
      const stats = await sdk.admin.stats({ days: 14 });
      check(
        "45) ★★ GET /admin/stats: DTO سبز، **هر عددِ پولی `number` است نه رشته** (B-2)، و سری دقیقاً ۱۴ سطلِ صفر‌پُر دارد",
        () => {
          adminStats.parse(stats);
          // ★ معیارِ پذیرشِ ۷٫۲ روی **سطحِ API**: هر عددِ پولی عدد است، نه رشته.
          // ⚠️ و عمداً ادعا نمی‌کند که افتادنِ یک `::bigint` را می‌گیرد — با شکستنِ عمدی آزموده شد و
          //   **نگرفت**، چون `toAdminStats` هر مقدار را از `Number()` رد می‌کند. شکلِ خودِ کوئری در
          //   `services/admin-stats.test.ts` قفل است (آن‌جا همان شکستن قرمز می‌شود).
          for (const [k, v] of Object.entries(stats.revenue)) {
            if (typeof v !== "number") throw new Error(`revenue.${k} = ${typeof v}`);
          }
          if (typeof stats.boards.live !== "number") throw new Error("boards.live رشته است");
          if (stats.windowDays !== 14) throw new Error(`windowDays=${stats.windowDays}`);
          for (const [k, arr] of Object.entries(stats.series)) {
            if (arr.length !== 14) throw new Error(`series.${k} = ${arr.length} سطل، نه ۱۴`);
          }
          // ★★ سطل باید **نیمه‌شبِ تهران** باشد، نه نیمه‌شبِ UTC — انحرافِ تاییدشده‌ی «الف».
          //   تهران +۳:۳۰ است، پس لحظه‌ی UTCی سطل باید ۲۰:۳۰ یا ۲۱:۳۰ (ساعتِ تابستانی) باشد.
          for (const p of stats.series.boards) {
            const d = new Date(p.date);
            const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
            if (minutes !== 20 * 60 + 30 && minutes !== 21 * 60 + 30) {
              throw new Error(`سطل نیمه‌شبِ تهران نیست: ${p.date}`);
            }
          }
          if (stats.teams.personal > stats.teams.total) throw new Error("personal > total");
          // ★★ ناوردای متقاطع: سری و مجموعِ پنجره **همان predicate و همان پنجره**‌اند، پس باید
          //   دقیقاً برابر باشند. بدونِ این، یک سریِ سراسر صفر (مثلاً وقتی کلیدِ join با سطل
          //   نمی‌خواند) از همه‌ی چک‌های شکلی سبز رد می‌شد — با شکستنِ عمدی دیده شد.
          const sum = (xs: readonly { count?: number; rial?: number }[]): number =>
            xs.reduce((a2, x) => a2 + (x.count ?? x.rial ?? 0), 0);
          if (sum(stats.series.boards) !== stats.boards.newInWindow) {
            throw new Error(
              `سریِ بورد ${sum(stats.series.boards)} ≠ مجموعِ پنجره ${stats.boards.newInWindow}`,
            );
          }
          if (sum(stats.series.users) !== stats.users.newInWindow) {
            throw new Error(
              `سریِ کاربر ${sum(stats.series.users)} ≠ مجموعِ پنجره ${stats.users.newInWindow}`,
            );
          }
          if (sum(stats.series.revenue) !== stats.revenue.windowGrossRial) {
            throw new Error(
              `سریِ درآمد ${sum(stats.series.revenue)} ≠ مجموعِ پنجره ${stats.revenue.windowGrossRial}`,
            );
          }
        },
      );


      // ── ★★ ۴۹: سطلِ روزانه واقعاً **روزِ تهران** است، نه UTC ──────────────
      //
      // ⚠️ چکِ ۴۵ این را **نمی‌تواند** ببیند و با شکستنِ عمدی ثابت شد: اگر سطل به UTC برگردد،
      //   مجموعِ سری و برچسبِ سطل‌ها **هر دو** همان می‌مانند و فقط ردیف‌ها به روزِ دیگری می‌افتند.
      //   تنها راهِ دیدنش، ردیفی است که روزِ تهران و روزِ UTCش **متفاوت** باشد.
      //
      // تهران +۳:۳۰ است، پس «ساعتِ ۱ بامدادِ امروزِ تهران» در UTC می‌شود ۲۱:۳۰ی **دیروز**.
      // چنین بوردی باید در **آخرین** سطل بنشیند؛ با سطلِ UTC در سطلِ ماقبلِ آخر می‌نشیند.
      const boardTeam = await app.db.query<{ id: string }>(
        "SELECT id FROM teams WHERE owner_user_id = $1 AND deleted_at IS NULL LIMIT 1",
        [verified.user!.id],
      );
      const tzBoardId = randomUUID();
      const before2 = await sdk.admin.stats({ days: 7 });
      await app.db.query(
        `INSERT INTO boards (id, team_id, created_by, title, created_at, updated_at, last_activity_at)
         VALUES ($1, $2, $3, $4,
                 (date_trunc('day', now() AT TIME ZONE 'Asia/Tehran') + interval '1 hour') AT TIME ZONE 'Asia/Tehran',
                 now(), now())`,
        [tzBoardId, boardTeam.rows[0]!.id, verified.user!.id, "بوردِ آزمونِ منطقه‌ی زمانی"],
      );
      const after2 = await sdk.admin.stats({ days: 7 });
      await app.db.query("DELETE FROM boards WHERE id = $1", [tzBoardId]);
      check(
        "49) ★★ بوردِ ساخته‌شده در ۱:۰۰ بامدادِ تهران (= ۲۱:۳۰ی دیروزِ UTC) در **آخرین** سطل می‌نشیند — نه سطلِ قبلی",
        () => {
          const b0 = before2.series.boards;
          const b1 = after2.series.boards;
          if (b0.length !== 7 || b1.length !== 7) throw new Error("طولِ سری ۷ نیست");
          const lastDelta = b1[6]!.count - b0[6]!.count;
          const prevDelta = b1[5]!.count - b0[5]!.count;
          if (lastDelta !== 1) {
            throw new Error(
              `بورد در آخرین سطل ننشست (آخری ${lastDelta}، قبلی ${prevDelta}) — سطل احتمالاً UTC است`,
            );
          }
          if (prevDelta !== 0) throw new Error(`سطلِ قبلی هم عوض شد: ${prevDelta}`);
        },
      );
      const sys = await sdk.admin.system();
      const readyz = await app.inject({ method: "GET", url: "/readyz" });
      check(
        "46) ★★ GET /admin/system: DB سبز، اختلافِ ساعت عدد است، هر چکِ ناموجود `unknown` (نه `fail`)، و /readyz دست‌نخورده",
        () => {
          systemStatus.parse(sys);
          const byKey = new Map(sys.checks.map((c) => [c.key, c]));
          for (const k of ["db", "s3:assets", "s3:snapshots", "s3:backups", "redis", "clock", "backup", "reconcile"]) {
            if (!byKey.has(k)) throw new Error(`چکِ ${k} نیست`);
          }
          if (byKey.get("db")!.state !== "ok") throw new Error(`db = ${byKey.get("db")!.state}`);
          if (byKey.get("s3:assets")!.state !== "ok") throw new Error("باکتِ assets در دسترس نیست");
          // ⚠️ `unknown` = «نپرسیدیم»؛ با `fail` یکی نیست و نباید حالتِ کلی را به fail ببرد.
          if (sys.state === "fail") throw new Error("حالتِ کلی fail است");
          if (typeof sys.clockSkewMs !== "number") throw new Error("اختلافِ ساعت عدد نیست");
          if (Math.abs(sys.clockSkewMs) > 60_000) throw new Error(`اختلافِ ساعتِ نامعقول: ${sys.clockSkewMs}ms`);
          if (sys.backup.staleAfterHours !== 30) throw new Error("آستانه‌ی ۳۰ ساعت نیست");
          // ★ /readyz باید دقیقاً همان چیزی بماند که بود (معیارِ پذیرشِ ۷٫۴).
          if (readyz.statusCode !== 200) throw new Error(`readyz = ${readyz.statusCode}`);
          if (JSON.stringify(readyz.json()) !== JSON.stringify({ status: "ready" })) {
            throw new Error(`readyz عوض شده: ${readyz.payload}`);
          }
        },
      );

      await app.db.query("DELETE FROM feature_flags WHERE key = $1", ["p7-contract"]);
      const flagsBefore = await sdk.admin.featureFlags();
      await app.db.query(
        "INSERT INTO feature_flags (key, enabled, rollout_pct, team_ids) VALUES ($1, true, 25, $2)",
        ["p7-contract", ["018f7c4e-9c1a-7c2b-8e3d-1a2b3c4d5e6f"]],
      );
      const flagsAfter = await sdk.admin.featureFlags();
      await app.db.query("DELETE FROM feature_flags WHERE key = $1", ["p7-contract"]);
      check(
        "47) GET /admin/feature-flags: نمای فقط‌خواندنی — ردیفِ واقعی را می‌بیند و DTOاش سبز است",
        () => {
          for (const f of flagsAfter.items) adminFeatureFlag.parse(f);
          const before = flagsBefore.items.some((f) => f.key === "p7-contract");
          const row = flagsAfter.items.find((f) => f.key === "p7-contract");
          if (before) throw new Error("پرچم پیش از درج هم بود");
          if (row === undefined) throw new Error("پرچمِ درج‌شده دیده نشد");
          if (row.rolloutPct !== 25 || !row.enabled) throw new Error(JSON.stringify(row));
          if (row.teamIds.length !== 1) throw new Error(`teamIds=${JSON.stringify(row.teamIds)}`);
        },
      );

      await app.db.query("UPDATE users SET is_staff = false WHERE id = $1", [verified.user!.id]);
      let statsDenied: unknown;
      let systemDenied: unknown;
      try {
        await sdk.admin.stats();
      } catch (e) {
        statsDenied = e;
      }
      try {
        await sdk.admin.system();
      } catch (e) {
        systemDenied = e;
      }
      await app.db.query("UPDATE users SET is_staff = true WHERE id = $1", [verified.user!.id]);
      check(
        "48) ★ هر سه مسیرِ فاز ۷ staff-only‌اند: کاربرِ عادی ۴۰۳ می‌گیرد، نه ۲۰۰ی خالی",
        () => {
          for (const [name, e] of [["stats", statsDenied], ["system", systemDenied]] as const) {
            if (!(e instanceof SdkError) || e.status !== 403) {
              throw new Error(`${name}: ${String(e)}`);
            }
          }
        },
      );
  } finally {
    await app.db.query(
      "UPDATE users SET is_staff = false, step_up_verified_at = NULL WHERE id = $1",
      [verified.user!.id],
    );
    await app.db.query("DELETE FROM otp_challenges WHERE destination = $1", [phone]);
    // ردیف‌های auditِ این اجرا (FK RESTRICT روی actor — کاربرِ قرارداد می‌مانَد، ردیف‌ها نه).
    await app.db.query("DELETE FROM audit_logs WHERE actor_user_id = $1", [verified.user!.id]);
  }

  // ── ۷٫۱ — `last_seen_at` روی PGِ زنده ───────────────────────────────────────
  //
  // ★ سه ادعا در یک چک، و هیچ‌کدام از تستِ واحد درنمی‌آید (آن فقط شکلِ SQL را می‌سنجد):
  //   ورود می‌نویسد · گلویِ ۱۵ دقیقه‌ای جلوی نوشتنِ بلافاصله را می‌گیرد · refresh بعد از کهنه‌شدن می‌نویسد.
  const seenUserId = verified.user!.id;
  const readSeen = async (): Promise<string | null> => {
    const { rows } = await app.db.query<{ t: string | null }>(
      "SELECT last_seen_at::text AS t FROM users WHERE id = $1",
      [seenUserId],
    );
    return rows[0]?.t ?? null;
  };
  const refreshOnce = async (token: string): Promise<string> => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: token },
    });
    if (res.statusCode !== 200) throw new Error(`refresh ⇒ ${res.statusCode}`);
    const body = res.json() as { refreshToken?: string };
    if (body.refreshToken === undefined) throw new Error("refreshToken برنگشت (APP_ENV=local لازم است)");
    return body.refreshToken;
  };

  await app.db.query("UPDATE users SET last_seen_at = NULL WHERE id = $1", [seenUserId]);
  await sdk.auth.requestOtp({ phone });
  const relogin = await sdk.auth.verifyOtp({ phone, code: "424242" });
  const afterLogin = await readSeen();

  const rotatedToken = await refreshOnce(relogin.refreshToken!);
  const afterThrottle = await readSeen();

  await app.db.query("UPDATE users SET last_seen_at = now() - interval '20 minutes' WHERE id = $1", [
    seenUserId,
  ]);
  const backdated = await readSeen();
  await refreshOnce(rotatedToken);
  const afterStale = await readSeen();

  check(
    "44) last_seen_at: ورود می‌نویسد · گلویِ ۱۵ دقیقه نگه می‌دارد · refreshِ کهنه دوباره می‌نویسد",
    () => {
      if (afterLogin === null) throw new Error("ورود هیچ‌چیز ننوشت");
      if (afterThrottle !== afterLogin) throw new Error("گلو نگرفت — refreshِ بلافاصله هم نوشت");
      if (afterStale === null) throw new Error("مقدار پاک شد");
      if (afterStale === backdated) throw new Error("refresh بعد از کهنگی ننوشت");
    },
  );
  await app.db.query("DELETE FROM otp_challenges WHERE destination = $1", [phone]);

  console.log(`\nsummary: ${pass} pass, ${fail} fail.\n`);
  await app.close();
  process.exit(fail === 0 ? 0 : 1);
}

void main();
