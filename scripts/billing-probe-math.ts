/**
 * probeِ فاز ۱ی M4 — گام ۱٫۵: ریاضیِ پول در ریالِ **صحیح**، بدونِ اختلافِ یک ریال.
 *
 * ── چرا این probe، و چرا قبل از `billing-core` ─────────────────────────
 *
 * [ADR-052](../ARCHITECTURE_DECISIONS.md#adr-052) می‌گوید **یک** تابع هم مبلغِ درگاه
 * را بدهد هم ارقامِ فاکتور را، با **یک** قاعده‌ی گِردکردن. دلیلش یک خرابیِ مشخص است:
 * اگر مبلغِ درگاه در یک مسیر و مبلغِ فاکتور در مسیرِ دیگری حساب شود، کافی است یکی
 * `Math.round` بزند و دیگری `Math.floor` تا مبلغِ ارسالی به verify **یک ریال** با
 * `payments.amount_rial` فرق کند — و زرین‌پال خطای `-50` می‌دهد و یک مشتریِ واقعاً
 * پرداخت‌کرده `verify_failed` ثبت می‌شود.
 *
 * این probe سه چیز را می‌سنجد:
 *   ۱. رابطه‌ی `subtotal − discount + vat === total` روی مبالغِ واقعی، **دقیق**.
 *   ۲. ★ شکستنِ عمدی: دو مسیرِ محاسبه ⇒ اختلافِ ۱ ریال باید **دیده** شود.
 *   ۳. هیچ خروجی‌ای اعشاری یا خارج از محدوده‌ی امن نباشد (P5).
 *
 * ⊕ یک چکِ اضافه که به گام ۳٫۶ مربوط است ولی اینجا رایگان است: مرزِ **سالِ جلالی**
 *   در برابرِ `now()`ِ UTC — چون شماره‌ی فاکتور (`HB-1405-000123`) به سالِ جلالی
 *   بسته است و اگر Node و Postgres سرِ آن مرز دو سالِ متفاوت بدهند، شماره‌گذاری
 *   دقیقاً یک‌بار در سال خراب می‌شود.
 *
 * هیچ وابستگیِ بیرونی ندارد. اجرا: `pnpm billing:probe-math`
 */

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

// ── قاعده‌ی نامزد (کاندیدِ `computeInvoice`ِ فاز ۳) ─────────────────────

interface Coupon {
  percentOff?: number;
  amountOffRial?: number;
}

interface Amounts {
  subtotalRial: number;
  discountRial: number;
  vatRial: number;
  totalRial: number;
}

/**
 * ★ **قاعده‌ی گِردکردنِ واحد:** هر نسبتِ درصدی با `Math.round((base * percent) / 100)`
 * حساب می‌شود — ضرب **قبل از** تقسیم (تا خطای ممیزِ شناور جمع نشود) و `round`
 * (نه `floor`) تا سوگیریِ سیستماتیک به نفعِ یک طرف نداشته باشیم.
 *
 * و مهم‌تر: `totalRial` **مشتق** است، نه محاسبه‌ی مستقل. همین یک خط رابطه‌ی
 * `subtotal − discount + vat === total` را **ساختاراً** تضمین می‌کند، نه با دقت.
 */
function percentOf(base: number, percent: number): number {
  return Math.round((base * percent) / 100);
}

function computeAmounts(
  unitPriceRial: number,
  seats: number,
  coupon: Coupon | null,
  vatPercent: number,
): Amounts {
  const subtotalRial = unitPriceRial * seats;

  let discountRial = 0;
  if (coupon?.percentOff !== undefined) discountRial = percentOf(subtotalRial, coupon.percentOff);
  else if (coupon?.amountOffRial !== undefined) discountRial = coupon.amountOffRial;
  discountRial = Math.min(discountRial, subtotalRial); // تخفیف هرگز از مبلغ بیشتر نیست

  const taxable = subtotalRial - discountRial;
  const vatRial = percentOf(taxable, vatPercent);
  const totalRial = taxable + vatRial; // ← مشتق، نه مستقل

  return { subtotalRial, discountRial, vatRial, totalRial };
}

/** ⚠️ مسیرِ **دوم** — همان چیزی که ADR-052 منعش می‌کند: مبلغِ درگاه جدا حساب شود. */
function gatewayAmountSecondPath(
  unitPriceRial: number,
  seats: number,
  coupon: Coupon | null,
  vatPercent: number,
): number {
  const subtotal = unitPriceRial * seats;
  const discount =
    coupon?.percentOff !== undefined
      ? Math.floor((subtotal * coupon.percentOff) / 100) // ← floor، نه round
      : (coupon?.amountOffRial ?? 0);
  const taxable = subtotal - discount;
  return taxable + Math.floor((taxable * vatPercent) / 100);
}

// ── موردهای آزمون ───────────────────────────────────────────────────────

interface Case {
  label: string;
  unitPriceRial: number;
  seats: number;
  coupon: Coupon | null;
  vatPercent: number;
}

const CASES: Case[] = [
  { label: "پلنِ ماهانه، یک صندلی، بدونِ VAT", unitPriceRial: 1_990_000, seats: 1, coupon: null, vatPercent: 0 },
  { label: "پلنِ ماهانه، ۷ صندلی، VAT ۱۰٪", unitPriceRial: 1_990_000, seats: 7, coupon: null, vatPercent: 10 },
  { label: "★ کوپنِ ۳۳٪ — نسبتِ غیرصحیح", unitPriceRial: 1_990_000, seats: 3, coupon: { percentOff: 33 }, vatPercent: 10 },
  { label: "★ مبلغی که VAT آن دقیقاً x٫۵ می‌شود", unitPriceRial: 1_000_005, seats: 1, coupon: null, vatPercent: 10 },
  { label: "کوپنِ مبلغی بزرگ‌تر از خودِ مبلغ", unitPriceRial: 500_000, seats: 1, coupon: { amountOffRial: 900_000 }, vatPercent: 10 },
  { label: "پلنِ سالانه، ۵۰ صندلی", unitPriceRial: 19_900_000, seats: 50, coupon: { percentOff: 15 }, vatPercent: 10 },
];

function checkInvariant(): CheckResult[] {
  const bad: string[] = [];
  const nonInteger: string[] = [];

  for (const c of CASES) {
    const a = computeAmounts(c.unitPriceRial, c.seats, c.coupon, c.vatPercent);
    if (a.subtotalRial - a.discountRial + a.vatRial !== a.totalRial) {
      bad.push(`${c.label}: ${a.subtotalRial} − ${a.discountRial} + ${a.vatRial} ≠ ${a.totalRial}`);
    }
    for (const [k, v] of Object.entries(a)) {
      if (!Number.isSafeInteger(v)) nonInteger.push(`${c.label} → ${k}=${v}`);
    }
  }

  return [
    {
      name: "۱٫۵ — `subtotal − discount + vat === total` روی هر ۶ مورد، **دقیق**",
      ok: bad.length === 0,
      detail:
        bad.length === 0
          ? `هر ۶ مورد برقرار است. مثال: ${JSON.stringify(computeAmounts(1_990_000, 3, { percentOff: 33 }, 10))}`
          : bad.join("\n    "),
    },
    {
      name: "۱٫۵ — همه‌ی خروجی‌ها عددِ صحیحِ امن‌اند (P5)",
      ok: nonInteger.length === 0,
      detail:
        nonInteger.length === 0
          ? "هیچ مقدارِ اعشاری یا خارج از `Number.isSafeInteger` تولید نشد"
          : nonInteger.join("\n    "),
    },
  ];
}

/** ★ خودآزمون: دو مسیرِ محاسبه باید جایی اختلاف بدهند، وگرنه ADR-052 بی‌معناست. */
function checkTwoPathDrift(): CheckResult {
  const drifts: string[] = [];
  for (const c of CASES) {
    const one = computeAmounts(c.unitPriceRial, c.seats, c.coupon, c.vatPercent).totalRial;
    const two = gatewayAmountSecondPath(c.unitPriceRial, c.seats, c.coupon, c.vatPercent);
    if (one !== two) drifts.push(`${c.label}: تابعِ واحد ${one} ولی مسیرِ دوم ${two} (اختلاف ${one - two})`);
  }
  return {
    name: "۱٫۵ خودآزمون — مسیرِ دومِ محاسبه واقعاً اختلاف می‌سازد",
    ok: drifts.length > 0,
    detail:
      drifts.length > 0
        ? `${drifts.length} مورد از ۶ مورد واگرا شد ⇒ خطرِ «۵۰-» واقعی است، نه نظری:\n    ${drifts.join("\n    ")}`
        : "هیچ اختلافی نساخت ⇒ این خودآزمون چیزی را نمی‌سنجد و باید عوض شود.",
  };
}

/** ⊕ مرزِ سالِ جلالی در برابرِ `now()`ِ UTC — ورودیِ گام ۳٫۶. */
function checkJalaliBoundary(): CheckResult {
  const fmt = new Intl.DateTimeFormat("en-CA-u-ca-persian-nu-latn", {
    timeZone: "Asia/Tehran",
    year: "numeric",
  });
  const utcYear = (d: Date): string => String(d.getUTCFullYear());
  const jalaliYear = (d: Date): string => fmt.format(d).split("-")[0]!;

  // آخرین لحظاتِ اسفند به وقتِ UTC — تهران (UTC+3:30) از قبل واردِ سالِ نو شده.
  const justBefore = new Date("2027-03-20T20:00:00Z");
  const justAfter = new Date("2027-03-20T21:00:00Z");

  const before = jalaliYear(justBefore);
  const after = jalaliYear(justAfter);
  const flipped = before !== after;

  return {
    name: "⊕ (ورودیِ گام ۳٫۶) — سالِ جلالی سرِ مرز با روزِ UTC هم‌راستا نیست",
    ok: flipped,
    detail: flipped
      ? `۲۰۲۷-۰۳-۲۰T۲۰:۰۰Z ⇒ سالِ جلالی ${before} · یک ساعت بعد ⇒ ${after}، در حالی که سالِ UTC هر دو ${utcYear(justBefore)} است.\n` +
        "    ★ یعنی شماره‌ی فاکتور و `issued_at` باید از **یک منبعِ زمانِ واحد** بیایند، وگرنه سالی یک‌بار دنباله می‌شکند."
      : `انتظار: تغییرِ سال بینِ دو لحظه. واقعی: هر دو ${before} — مرز را جابه‌جا کن.`,
  };
}

const results = [...checkInvariant(), checkTwoPathDrift(), checkJalaliBoundary()];
for (const r of results) console.log(`${r.ok ? "✔" : "✖"} ${r.name}\n    ${r.detail}`);

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.error(`\n✖ ${failed.length} چک قرمز شد.`);
  process.exit(1);
}
console.log("\n✔ ۱٫۵ اثبات شد: قاعده‌ی واحد نامتناقض است و مسیرِ دوم واقعاً خطرناک.");
