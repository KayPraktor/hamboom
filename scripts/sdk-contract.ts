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
import { randomUUID } from "node:crypto";

import { MockGateway } from "../packages/billing-core/src/index.ts";
import { buildApp } from "../apps/api/src/app.ts";
import { loadApiConfig } from "../apps/api/src/config.ts";
import {
  board,
  boardSummary,
  folder,
  invoice,
  plan,
  subscription,
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
  const config = { ...loadApiConfig(), OTP_DEV_FIXED_CODE: "424242" };
  // ★ درگاه **صریح** تزریق می‌شود، نه از `PAYMENT_PROVIDER`ِ محیط: این اسکریپت نباید بسته به
  //   `.env`ِ کسی به سندباکسِ واقعی وصل شود (P2/P3).
  const gateway = new MockGateway({ checkoutBaseUrl: "http://local/api/v1/billing/mock/pay" });
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
    for (const hidden of ["pro", "team", "personal"]) {
      if (codes.includes(hidden)) throw new Error(`${hidden} نباید عمومی باشد (قیمت تایید نشده)`);
    }
    // ★ سقفِ نامحدود روی سیم `-1` است، نه `null` و نه `Infinity` (که JSON اصلاً ندارد).
    //   ⚠️ `Plan` سقف‌ها را **تخت** دارد (`maxBoards`)، برخلافِ `Team` که `limits` تودرتوست.
    for (const p of publicPlans.plans) {
      if (!Number.isInteger(p.maxBoards)) throw new Error("maxBoards عددِ صحیح نیست");
      if (!Number.isInteger(p.priceMonthlyRial)) throw new Error("priceMonthlyRial عددِ صحیح نیست");
    }
  });

  // پلنِ آزمایشیِ **پولی** — `free` صفر است و اصلاً به درگاه نمی‌رود.
  const probePlan = "sdk_contract";
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
        checkoutBaseUrl: "http://local/api/v1/billing/mock/pay",
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
      await app.db.query("DELETE FROM invoices WHERE id = $1 AND status <> 'paid'", [row.invoice_id]);
    }
  }

  // ⚠️ پلن **حذف نمی‌شود** (اشتراک به `plans(code)` ارجاع دارد و RESTRICT است) — فقط
  //    غیرفعال می‌شود تا اجرای بعدیِ چکِ ۹ سالم بماند.
  await app.db.query("UPDATE plans SET is_active = false WHERE code = $1", [probePlan]);

  console.log(`\nsummary: ${pass} pass, ${fail} fail.\n`);
  await app.close();
  process.exit(fail === 0 ? 0 : 1);
}

void main();
