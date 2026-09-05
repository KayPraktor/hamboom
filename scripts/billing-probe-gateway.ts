/**
 * probeِ فاز ۱ی M4 — گام ۱٫۱: قراردادِ **واقعیِ** زرین‌پال، با تماسِ زنده به سندباکس.
 *
 * ── چرا این probe دروازه‌ی کلِ ماژول است ───────────────────────────────
 *
 * [ADR-050](../ARCHITECTURE_DECISIONS.md#adr-050) کلِ یگانگیِ پرداخت را روی این ادعا
 * بنا کرده که **verifyِ دومِ همان تراکنش کدِ ۱۰۱ می‌دهد، نه ۱۰۰**. اگر این غلط باشد،
 * طراحی از پایه غلط است. مستندات این را می‌گوید، ولی مستندات با رفتار یکی نیست —
 * درسِ گران‌قیمتِ M3 (گام ۱۱٫۲) همین بود.
 *
 * ⚠️ **این probe دو مرحله دارد، چون وسطش یک انسان لازم است.** صفحه‌ی سندباکس کپچا و
 * OTP دارد و غیرتعاملی کامل نمی‌شود:
 *
 *   ۱. `node scripts/billing-probe-gateway.ts --request`
 *      چهار چکِ **بدونِ پرداخت** را می‌زند و یک `authority` می‌سازد، سپس URLِ درگاه را
 *      چاپ و در فایلِ حالت ذخیره می‌کند.
 *   ۲. مالک آن URL را در مرورگر باز می‌کند و پرداخت را **کامل** می‌کند.
 *   ۳. `node scripts/billing-probe-gateway.ts --verify`
 *      همان authority را **دوبار** verify می‌کند و باید ۱۰۰ سپس ۱۰۱ ببیند.
 *
 * ★ P2/P3: این تنها چیزی در کلِ M4 است که به اینترنت وصل می‌شود، و عمداً یک **probe**
 *   است نه بخشی از runtime. پیش‌فرضِ توسعه `MockGateway` است
 *   ([ADR-049](../ARCHITECTURE_DECISIONS.md#adr-049)). سندباکس هیچ حساب یا پولی لازم
 *   ندارد — merchant_id هر UUIDِ دلخواهی می‌تواند باشد.
 *
 * اجرا: `pnpm billing:probe-gateway -- --request` سپس `-- --verify`
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const HOST = process.env.ZARINPAL_HOST ?? "https://sandbox.zarinpal.com";
const MERCHANT = process.env.ZARINPAL_MERCHANT_ID ?? "11111111-1111-1111-1111-111111111111";
const CALLBACK = process.env.ZARINPAL_CALLBACK_URL ?? "http://localhost:5173/billing/callback";
const AMOUNT = 15_000; // ریال — بالای کفِ ۱۰۰۰
const STATE_FILE = join(tmpdir(), "hamboom-billing-probe.json");

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

interface GatewayReply {
  status: number;
  /** بدنه‌ی خام — همیشه خوانده می‌شود، حتی روی non-2xx. */
  body: Record<string, unknown>;
  /** کدِ کسب‌وکار، از `data.code` یا `errors.code`. */
  code: number | null;
  /** آیا `errors` آرایه بود (موفق) یا شیء (ناموفق)؟ */
  errorsShape: "array" | "object" | "missing";
}

/**
 * ★★ **قاعده‌ی طلاییِ آداپتور** (ADR-049): هرگز روی `res.ok` شاخه نزن. زرین‌پال برای
 * نتایجِ عادیِ کسب‌وکار non-2xx برمی‌گرداند (۴۲۲ برای ۹-، ۴۰۱ برای ۵۱-). بدنه را
 * همیشه بخوان و روی **کد** تصمیم بگیر.
 */
async function call(path: string, payload: Record<string, unknown>): Promise<GatewayReply> {
  const res = await fetch(`${HOST}/pg/v4/payment/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await res.json()) as Record<string, unknown>;

  const data = body.data as Record<string, unknown> | undefined;
  const errors = body.errors;
  const errorsShape = Array.isArray(errors) ? "array" : errors == null ? "missing" : "object";

  let code: number | null = null;
  if (data && typeof data.code === "number") code = data.code;
  else if (errorsShape === "object") {
    const e = errors as Record<string, unknown>;
    if (typeof e.code === "number") code = e.code;
  }

  return { status: res.status, body, code, errorsShape };
}

const requestPayload = (amount: number, extra: Record<string, unknown> = {}) => ({
  merchant_id: MERCHANT,
  amount,
  currency: "IRR", // ★ همیشه صریح — پیش‌فرض IRR است ولی IRT هم مجاز است
  description: "probeِ فاز ۱ی هم‌بوم — بدونِ پرداختِ واقعی",
  callback_url: CALLBACK,
  ...extra,
});

// ── مرحله‌ی ۱: چک‌های بدونِ پرداخت + ساختِ authority ────────────────────

async function phaseRequest(): Promise<void> {
  const results: CheckResult[] = [];

  // ۱. درخواستِ سالم
  const ok = await call("request.json", requestPayload(AMOUNT));
  const authority = (ok.body.data as Record<string, unknown> | undefined)?.authority;
  const gotAuthority = typeof authority === "string" && authority.length > 0;
  results.push({
    name: "۱٫۱ الف — `request.json` روی سندباکس با merchantِ دلخواه کار می‌کند",
    ok: gotAuthority && ok.code === 100,
    detail: gotAuthority
      ? `HTTP ${ok.status} · code=${ok.code} · authority=«${String(authority)}» (${String(authority).length} کاراکتر) · errors=${ok.errorsShape}`
      : `authority نگرفت. HTTP ${ok.status} · ${JSON.stringify(ok.body).slice(0, 300)}`,
  });

  // ۲. شکلِ `errors` روی خطا — کفِ مبلغ
  const tooSmall = await call("request.json", requestPayload(100));
  results.push({
    name: "۱٫۱ ب ★ — خطای کسب‌وکار **non-2xx** است و `errors` **شیء** می‌شود (نه آرایه)",
    ok: tooSmall.status >= 400 && tooSmall.errorsShape === "object",
    detail:
      tooSmall.status >= 400 && tooSmall.errorsShape === "object"
        ? `مبلغِ ۱۰۰ ریال ⇒ HTTP ${tooSmall.status} · code=${tooSmall.code} · errors=${tooSmall.errorsShape}\n` +
          `    ★ پس schemaی پاسخ باید هر دو شکل را بپذیرد، و آداپتور نباید روی res.ok شاخه بزند`
        : `انتظار: non-2xx + errors شیء. واقعی: HTTP ${tooSmall.status} · errors=${tooSmall.errorsShape}`,
  });

  // ۳. merchantِ نامعتبر — تاییدِ اینکه طولِ ۳۶ اجباری است
  const badMerchant = await call("request.json", {
    ...requestPayload(AMOUNT),
    merchant_id: "too-short",
  });
  results.push({
    name: "۱٫۱ ج — `merchant_id` باید دقیقاً ۳۶ کاراکتر باشد (اعتبارسنجی در بوت، نه سرِ پرداخت)",
    ok: badMerchant.status >= 400 && badMerchant.code !== null,
    detail: `merchantِ کوتاه ⇒ HTTP ${badMerchant.status} · code=${badMerchant.code}`,
  });

  // ۴. verifyِ یک authorityِ پرداخت‌نشده
  if (gotAuthority) {
    const unpaid = await call("verify.json", {
      merchant_id: MERCHANT,
      amount: AMOUNT,
      authority,
    });
    results.push({
      name: "۱٫۱ د — verifyِ تراکنشِ پرداخت‌نشده «پرداخت نشد» می‌دهد، نه استثنا",
      ok: unpaid.code !== null && unpaid.code !== 100 && unpaid.code !== 101,
      detail: `HTTP ${unpaid.status} · code=${unpaid.code} · errors=${unpaid.errorsShape} — یعنی «هنوز پرداخت نشده»، که یک نتیجه است نه خطای شبکه`,
    });
  }

  report(results);

  if (gotAuthority) {
    writeFileSync(
      STATE_FILE,
      JSON.stringify({ authority, amount: AMOUNT, host: HOST, merchant: MERCHANT }, null, 2),
      "utf8",
    );
    console.log(
      "\n" +
        "═".repeat(72) +
        "\n★ مرحله‌ی بعد دستِ توست — این URL را در مرورگر باز کن و پرداخت را کامل کن:\n\n" +
        `    ${HOST}/pg/StartPay/${String(authority)}\n\n` +
        "  (سندباکس است: هیچ پولی جابه‌جا نمی‌شود. کارتِ آزمایشی روی همان صفحه نوشته شده.)\n" +
        "  بعدش بزن:  node scripts/billing-probe-gateway.ts --verify\n" +
        "═".repeat(72),
    );
  }
}

// ── مرحله‌ی ۲: ★★ گذارِ ۱۰۰ → ۱۰۱ ──────────────────────────────────────

async function phaseVerify(): Promise<void> {
  let state: { authority: string; amount: number };
  try {
    state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as typeof state;
  } catch {
    console.error(`✖ فایلِ حالت پیدا نشد (${STATE_FILE}).\n  اول --request را بزن.`);
    process.exit(1);
  }

  const results: CheckResult[] = [];
  const body = { merchant_id: MERCHANT, amount: state.amount, authority: state.authority };

  const first = await call("verify.json", body);
  const second = await call("verify.json", body);

  const paidCodes = [100, 101];
  results.push({
    name: "۱٫۱ ه ★★ — verifyِ اول کدِ ۱۰۰ می‌دهد",
    ok: first.code === 100,
    detail:
      first.code === 100
        ? `HTTP ${first.status} · code=100 · ref_id=${String((first.body.data as Record<string, unknown>)?.ref_id)} · نوعِ ref_id در JS: ${typeof (first.body.data as Record<string, unknown>)?.ref_id}`
        : `انتظار: ۱۰۰. واقعی: HTTP ${first.status} · code=${first.code}. ` +
          (first.code === 101
            ? "★ یعنی این authority قبلاً verify شده — با --request یکی تازه بساز."
            : "پرداخت را در مرورگر کامل کردی؟"),
  });

  results.push({
    name: "۱٫۱ و ★★ — verifyِ **دوم** کدِ ۱۰۱ می‌دهد، نه ۱۰۰ و نه خطا",
    ok: second.code === 101,
    detail:
      second.code === 101
        ? `HTTP ${second.status} · code=101 · errors=${second.errorsShape}\n` +
          "    ★★ پس {۱۰۰،۱۰۱} = پرداخت‌شده، و چکِ `code === 100` یک مشتریِ واقعاً پرداخت‌کرده را «ناموفق» ثبت می‌کند.\n" +
          "    ★ ADR-050 روی همین سوار است و حالا **اثبات‌شده** است، نه فرض."
        : `انتظار: ۱۰۱. واقعی: HTTP ${second.status} · code=${second.code} — ⚠️ ADR-050 باید بازبینی شود!`,
  });

  // ★ شکستنِ عمدی: مبلغِ غلط سرِ verify
  const wrongAmount = await call("verify.json", { ...body, amount: state.amount + 1 });
  results.push({
    name: "۱٫۱ ز خودآزمون — مبلغِ غلط سرِ verify رد می‌شود (خطرِ «اختلافِ یک ریال»)",
    ok: wrongAmount.code !== null && !paidCodes.includes(wrongAmount.code),
    detail: `مبلغ +۱ ریال ⇒ HTTP ${wrongAmount.status} · code=${wrongAmount.code}\n    ★ همان چیزی که ADR-052 با «یک تابع، یک قاعده‌ی گِردکردن» جلویش را می‌گیرد`,
  });

  report(results);
}

function report(results: CheckResult[]): void {
  for (const r of results) console.log(`${r.ok ? "✔" : "✖"} ${r.name}\n    ${r.detail}`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\n✖ ${failed.length} چک قرمز شد.`);
    process.exit(1);
  }
}

const mode = process.argv[2];
if (mode === "--verify") await phaseVerify();
else if (mode === "--request") await phaseRequest();
else {
  console.error("استفاده: node scripts/billing-probe-gateway.ts --request | --verify");
  process.exit(1);
}
