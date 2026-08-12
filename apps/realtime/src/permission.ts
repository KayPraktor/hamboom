import { BOARD_ROLES, type BoardRole } from "@hamboom/ydoc-schema";

/**
 * سیاستِ مجوز — گام ۴٫۵، [ADR-012](../../../ARCHITECTURE_DECISIONS.md#adr-012).
 *
 * ── ★★ چرا یک فایلِ جدا برای چند خط شرط ──────────────────────────────
 *
 * ADR-012 اسمِ حفره را برده: «رایج‌ترین باگ امنیتی در محصولات مشابه این است که
 * REST درست چک می‌کند ولی WebSocket نه». آن باگ از یک شرطِ **پخش‌شده** می‌آید —
 * یک `if` اینجا، یک `if` آنجا، و یکی که یادت رفت. اینجا تنها جایی است که
 * جمله‌ی «چه کسی حق نوشتن دارد» نوشته می‌شود؛ بقیه فقط صدایش می‌زنند.
 *
 * ── ★ و چرا `commenter` هم نمی‌نویسد (fail closed) ────────────────────
 *
 * نقشِ `commenter` قرار است **فقط سنجاقِ کامنت** بنویسد، نه عنصر. تشخیصِ اینکه
 * یک updateِ باینریِ Yjs کدام ریشه را دست می‌زند، **قبل از اعمالش**، کارِ
 * کوچکی نیست (و بعد از اعمال، Yjs عقب‌گرد ندارد). پس تا وقتی آن تفکیک ساخته
 * نشده، `commenter` مثلِ `viewer` رفتار می‌شود.
 *
 * ⚠️ این یک انتخابِ **آگاهانه‌ی fail-closed** است، نه فراموشی: مسیرِ کامنت هنوز
 * در کلاینت وجود ندارد (کارِ M3)، پس امروز چیزی را نمی‌شکند — ولی اگر برعکسش
 * را می‌گذاشتیم، یک `commenter` می‌توانست کلِ بورد را جابه‌جا کند. ثبت‌شده در
 * PROGRESS به‌عنوانِ گپِ **G-2**.
 */

/** نقش‌هایی که حق دارند در **سند** بنویسند. */
const WRITERS: readonly BoardRole[] = ["owner", "editor"];

/**
 * آیا این نقش می‌تواند سند را تغییر دهد؟
 *
 * ★ ورودی‌اش عمداً `unknown` است: نقش می‌تواند از توکن، از پیامِ یک نودِ دیگر
 * (گام ۴٫۷)، یا از پیاده‌سازیِ M3 بیاید. هر مقداری که **نشناسیم** یعنی نه —
 * همان قاعده‌ی fail-closedِ `decodeMessage` در `ydoc-schema`.
 */
export function mayWriteDocument(role: unknown): boolean {
  return isBoardRole(role) && WRITERS.includes(role);
}

/**
 * آیا این نقش می‌تواند حضور/ephemeral بفرستد؟
 *
 * ⚠️ **بله، حتی `viewer`** — و این عمدی است، نه سهل‌گیری: تماشاگری که مکان‌نمایش
 * دیده نمی‌شود، از نظرِ بقیه **در اتاق نیست**. چیزی هم پایدار نمی‌شود
 * ([ADR-022](../../../ARCHITECTURE_DECISIONS.md#adr-022))، پس سطحِ حمله‌اش با
 * نوشتن در سند یکی نیست.
 */
export function mayBroadcastPresence(role: unknown): boolean {
  return isBoardRole(role);
}

function isBoardRole(value: unknown): value is BoardRole {
  return typeof value === "string" && (BOARD_ROLES as readonly string[]).includes(value);
}
