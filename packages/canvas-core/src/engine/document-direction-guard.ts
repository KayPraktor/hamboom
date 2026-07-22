/**
 * نگهبان جهت سند — مقابله با تصرف `documentElement` توسط Excalidraw.
 *
 * ── مسئله ─────────────────────────────────────────────────────────────
 *
 * Excalidraw هنگام مقداردهی زبان، این دو خط را روی **کل سند** اجرا می‌کند:
 *
 * ```js
 * document.documentElement.dir  = language.rtl ? "rtl" : "ltr";
 * document.documentElement.lang = language.code;
 * ```
 *
 * یعنی یک کامپوننت جاسازی‌شده، جهت کل اپلیکیشن میزبان را عوض می‌کند. برای
 * هم‌بوم که پوسته‌اش همیشه RTL است ([ADR-016](../../../../ARCHITECTURE_DECISIONS.md#adr-016))
 * این پذیرفتنی نیست.
 *
 * بدتر: فارسی اصلاً انتخاب نمی‌شود. Excalidraw فهرست زبان‌ها را با
 * `.filter(lang => percentages[lang.code] >= 85)` هرس می‌کند و `fa-IR` روی
 * **۸۴** است — با اختلاف یک واحد حذف می‌شود. نتیجه: `langCode="fa-IR"` بی‌صدا
 * به انگلیسی برمی‌گردد و جهت سند `ltr` می‌شود.
 *
 * ── چرا این راه‌حل، فعلاً ────────────────────────────────────────────────
 *
 * این یک راه‌حل **موقت و عمداً کوچک** است تا گام ۱٫۱ بتواند تمام شود.
 * راه‌حل درست یک patch روی پکیج بالادست است (پله‌ی B در
 * [ADR-003](../../../../ARCHITECTURE_DECISIONS.md#adr-003)) که در گام ۱٫۴
 * اعمال می‌شود — بعد از اینکه spike گام ۱٫۳ فهرست کامل patch های لازم را داد.
 * تا آن موقع، به‌جای جنگیدن با کتابخانه، فقط اثر جانبی‌اش را خنثی می‌کنیم.
 *
 * وقتی patch اعمال شد، این فایل باید حذف شود.
 */

export interface DocumentDirection {
  dir: "rtl" | "ltr";
  lang: string;
}

/** مقدار پیش‌فرض هم‌بوم. */
export const HAMBOOM_DOCUMENT_DIRECTION: DocumentDirection = { dir: "rtl", lang: "fa" };

/**
 * جهت و زبان سند را تثبیت می‌کند و هر تغییری از بیرون را برمی‌گرداند.
 *
 * @returns تابع توقف نگهبان.
 */
export function guardDocumentDirection(
  expected: DocumentDirection = HAMBOOM_DOCUMENT_DIRECTION,
): () => void {
  const root = document.documentElement;

  const enforce = () => {
    if (root.getAttribute("dir") !== expected.dir) root.setAttribute("dir", expected.dir);
    if (root.getAttribute("lang") !== expected.lang) root.setAttribute("lang", expected.lang);
  };

  enforce();

  // فقط همین دو صفت پایش می‌شوند — نه کل زیردرخت. هزینه‌اش عملاً صفر است.
  const observer = new MutationObserver(enforce);
  observer.observe(root, { attributes: true, attributeFilter: ["dir", "lang"] });

  return () => observer.disconnect();
}
