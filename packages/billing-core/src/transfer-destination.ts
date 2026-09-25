/**
 * مقصدِ واریز برای کارت‌به‌کارت/شبا — اعتبارسنجیِ **بوت**
 * ([ADR-070](../../../ARCHITECTURE_DECISIONS.md#adr-070)).
 *
 * ★★ **چرا این فایل وجود دارد، در حالی که «خالی نباشد» ساده‌تر بود.**
 *
 * این مقدار را یک آدم **یک بار** در `.env.production` تایپ می‌کند و از آن به بعد **هر مشتری**
 * پولش را به همان می‌ریزد. جابه‌جاییِ یک رقم یعنی پول به حسابِ یک **غریبه** می‌رود، ما هیچ
 * خطایی نمی‌بینیم (استک کاملاً سالم است)، و تنها راهِ فهمیدنش شکایتِ مشتری است — همان کلاسِ
 * خرابیِ بی‌صدایی که کلِ این ریپو دنبالش می‌گردد. هر دو استاندارد یک رقمِ اشتباه و جابه‌جاییِ
 * دو رقمِ مجاور را می‌گیرند، پس گارد **در بوت** می‌شکند نه سرِ اولین مشتری.
 *
 * ⚠️ چیزی که این فایل **نمی‌تواند** بگیرد: شماره‌ای که معتبر است ولی مالِ کسِ دیگری است.
 * برای آن فقط یک واریزِ آزمایشیِ واقعی جواب می‌دهد (RUNBOOK).
 */

/** یک مقصدِ معتبر و نرمال‌شده. دستِ‌کم یکی از `card`/`sheba` ناتهی است. */
export interface TransferDestination {
  /** ۱۶ رقم، بدونِ فاصله و خط‌تیره. */
  card: string | null;
  /** `IR` + ۲۴ رقم، بدونِ فاصله. */
  sheba: string | null;
  holderName: string;
  bankName: string | null;
}

export interface TransferDestinationInput {
  card?: string | undefined;
  sheba?: string | undefined;
  holderName?: string | undefined;
  bankName?: string | undefined;
}

export class InvalidTransferDestinationError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(
      "مقصدِ واریزِ کارت‌به‌کارت معتبر نیست:\n" +
        problems.map((p) => `  • ${p}`).join("\n") +
        "\n  (ADR-070 — مقادیرِ CARD_TRANSFER_* در .env.production)",
    );
    this.name = "InvalidTransferDestinationError";
    this.problems = problems;
  }
}

const digitsOnly = (raw: string): string => raw.replace(/[\s-]/g, "");

/**
 * Luhn — همان چکِ استانداردِ کارت‌های بانکی.
 *
 * ⊕ عمداً فقط روی رشته‌ی **۱۶رقمیِ** نرمال‌شده صدا زده می‌شود؛ خودش طول را نمی‌سنجد.
 */
export function luhnOk(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * mod-97ِ IBAN روی شبای ایران (`IR` + ۲۴ رقم).
 *
 * ⚠️ عددِ حاصل از ۲۶ کاراکتر بزرگ‌تر از `Number.MAX_SAFE_INTEGER` است، پس باقیمانده
 * **رقم‌به‌رقم** گرفته می‌شود — نه با `BigInt` (که لازم نیست) و نه با `Number` (که بی‌صدا
 * گرد می‌کند و هر شبایی را «معتبر» نشان می‌دهد).
 */
export function shebaOk(value: string): boolean {
  if (!/^IR\d{24}$/.test(value)) return false;
  // چهار کاراکترِ اول به انتها می‌رود؛ `I`=۱۸ و `R`=۲۷.
  const rearranged = `${value.slice(4)}1827${value.slice(2, 4)}`;
  let remainder = 0;
  for (const ch of rearranged) {
    remainder = (remainder * 10 + (ch.charCodeAt(0) - 48)) % 97;
  }
  return remainder === 1;
}

/**
 * ★ همه‌ی ایرادها **با هم** گزارش می‌شوند، نه اولی.
 *
 * همان قاعده‌ی `assertProductionConfig` در M5 فاز ۴: اپراتوری که یک‌یک ایرادها را کشف
 * می‌کند، سه بار استقرار را تکرار می‌کند.
 */
export function resolveTransferDestination(input: TransferDestinationInput): TransferDestination {
  const problems: string[] = [];

  const rawCard = (input.card ?? "").trim();
  const rawSheba = (input.sheba ?? "").trim().toUpperCase().replace(/\s/g, "");
  const holderName = (input.holderName ?? "").trim();
  const bankName = (input.bankName ?? "").trim();

  let card: string | null = null;
  if (rawCard.length > 0) {
    const normalized = digitsOnly(rawCard);
    if (!/^\d{16}$/.test(normalized)) {
      problems.push("CARD_TRANSFER_CARD_NUMBER باید دقیقاً ۱۶ رقم باشد.");
    } else if (!luhnOk(normalized)) {
      problems.push("CARD_TRANSFER_CARD_NUMBER چکِ Luhn را رد نمی‌کند — احتمالاً یک رقم اشتباه است.");
    } else {
      card = normalized;
    }
  }

  let sheba: string | null = null;
  if (rawSheba.length > 0) {
    const normalized = rawSheba.startsWith("IR") ? rawSheba : `IR${rawSheba}`;
    if (!/^IR\d{24}$/.test(normalized)) {
      problems.push("CARD_TRANSFER_SHEBA باید `IR` و ۲۴ رقم باشد.");
    } else if (!shebaOk(normalized)) {
      problems.push("CARD_TRANSFER_SHEBA چکِ mod-97 را رد نمی‌کند — احتمالاً یک رقم اشتباه است.");
    } else {
      sheba = normalized;
    }
  }

  // ★★ گاردِ اصلی: بدونِ مقصد، صفحه‌ی پرداخت یک کادرِ خالی نشان می‌دهد و کاربر پولش را
  //    به هیچ‌جا نمی‌فرستد — شکستی که فقط مشتری می‌بیندش.
  if (card === null && sheba === null && problems.length === 0) {
    problems.push(
      "دستِ‌کم یکی از CARD_TRANSFER_CARD_NUMBER یا CARD_TRANSFER_SHEBA باید تنظیم شود.",
    );
  }
  // ⚠️ نامِ صاحبِ حساب تزئینی نیست: کاربر پیش از زدنِ دکمه‌ی واریز آن را با چیزی که اپِ
  //    بانکش نشان می‌دهد تطبیق می‌دهد. نبودش یعنی برداشتنِ تنها راستی‌آزماییِ سمتِ کاربر.
  if (holderName.length === 0) {
    problems.push("CARD_TRANSFER_HOLDER_NAME تنظیم نشده — کاربر نمی‌تواند مقصد را تطبیق دهد.");
  }

  if (problems.length > 0) throw new InvalidTransferDestinationError(problems);

  return { card, sheba, holderName, bankName: bankName.length > 0 ? bankName : null };
}
