import { detectBaseDirection } from "../text/bidi";

/**
 * جهت ویرایشگر inline — سومین مصرف‌کننده‌ی جهت در [ADR-024](../../../../ARCHITECTURE_DECISIONS.md#adr-024).
 *
 * ── مسئله ─────────────────────────────────────────────────────────────
 *
 * موتور روی textarea ویرایشگر `dir="auto"` می‌گذارد. این بهتر از هیچ است، ولی
 * `auto` الگوریتم استاندارد یونیکد را اجرا می‌کند: **اولین کاراکتر قوی** جهت را
 * تعیین می‌کند. spike گام ۱٫۳ب نشان داد این روی «board برای تیم ماست» جواب
 * `ltr` می‌دهد — و شروع جمله‌ی فارسی با یک اصطلاح انگلیسی در بورد فارسی رایج است.
 *
 * نتیجه‌ی عملی این ناهماهنگی بدتر از خودِ خطاست: بوم از `detectBaseDirection`
 * (اکثریت) استفاده می‌کند و ویرایشگر از `auto` (اولین حرف). پس متن **هنگام ورود
 * و خروج از حالت ویرایش می‌پرد** — دقیقاً همان چیزی که ADR-024 با «یک منبع
 * واحد برای هر سه مصرف‌کننده» جلویش را می‌گیرد.
 *
 * ── راه‌حل ─────────────────────────────────────────────────────────────
 *
 * صفت `dir` با مقدار صریحِ `detectBaseDirection` جایگزین می‌شود و با هر تغییر
 * متن به‌روز می‌ماند (جهت می‌تواند وسط تایپ عوض شود).
 *
 * **`text-align` عمداً دست‌نخورده می‌ماند.** آن از `element.textAlign` می‌آید و
 * همان چیزی است که بوم هم استفاده می‌کند؛ اگر اینجا override شود، ویرایشگر و
 * بوم از هم جدا می‌شوند و دوباره همان پرش را می‌سازیم.
 */

/** انتخابگر textarea ویرایشگر — توسط موتور ساخته می‌شود. */
const EDITOR_SELECTOR = ".excalidraw-wysiwyg";

/** جهت را از روی محتوای فعلی روی textarea اعمال می‌کند. */
function applyDirection(editor: HTMLTextAreaElement): void {
  const direction = detectBaseDirection(editor.value);
  if (editor.getAttribute("dir") !== direction) {
    editor.setAttribute("dir", direction);
  }
}

/**
 * ویرایشگرهای inline را پایش می‌کند و جهتشان را با منبع واحد هم‌راستا نگه می‌دارد.
 *
 * چون textarea را موتور به‌صورت پویا می‌سازد و حذف می‌کند، به‌جای گرفتن یک
 * ارجاع، کل زیردرخت پایش می‌شود.
 *
 * @param root ریشه‌ی پایش. پیش‌فرض `document.body`.
 * @returns تابع توقف.
 */
export function guardEditorDirection(root: ParentNode = document.body): () => void {
  const tracked = new WeakSet<HTMLTextAreaElement>();

  const attach = (editor: HTMLTextAreaElement) => {
    if (tracked.has(editor)) return;
    tracked.add(editor);
    applyDirection(editor);
    // موتور خودش listener روی input دارد؛ این یکی اضافه می‌شود و تداخلی ندارد.
    editor.addEventListener("input", () => applyDirection(editor));
  };

  const scan = () => {
    for (const editor of root.querySelectorAll<HTMLTextAreaElement>(EDITOR_SELECTOR)) {
      attach(editor);
    }
  };

  scan();

  const observer = new MutationObserver(scan);
  observer.observe(root, { childList: true, subtree: true });

  return () => observer.disconnect();
}
