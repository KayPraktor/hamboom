/**
 * کارتِ «حساب معلق شده است» — M6 ۵٫۲ ([ADR-066](../../../../ARCHITECTURE_DECISIONS.md#adr-066) §۴).
 *
 * ★ در **هر سه** نقطه‌ی ورودِ رابط رندر می‌شود (`RequireAuth`، `IndexRedirect`، `LoginPage`): یافته‌ی بازبینیِ ۵٫۵
 * نشان داد `/` و `/login` وضعیتِ `suspended` را «anonymous» می‌گرفتند و کاربر را به فرمِ ورود می‌بردند — که آن‌جا
 * OTPِ بی‌صدا فقط سردرگمش می‌کند («کد فرستاده شد» و هرگز نمی‌آید). عمداً کوچک: در chunkِ ورودی می‌نشیند.
 */
export function SuspendedNotice() {
  return (
    <div className="card auth-card" role="alert">
      <h1>حساب معلق شده است</h1>
      <p className="field-hint">
        دسترسیِ این حساب به هم‌بوم موقتاً بسته شده. اگر فکر می‌کنی اشتباه است، با پشتیبانی تماس
        بگیر.
      </p>
    </div>
  );
}
