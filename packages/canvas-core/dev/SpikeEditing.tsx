import { FONT_FAMILY, HamboomCanvas, convertToExcalidrawElements } from "@hamboom/canvas-core";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useState } from "react";

/**
 * spike ویرایش inline و کلیپ‌بورد — تکمیل گام ۱٫۳.
 *
 * **چرا جدا از SpikeText:** ویرایشگر inline اصلاً روی canvas نیست؛ یک
 * `<textarea>` است که روی بوم شناور می‌شود. مسیر کد، مدل جهت‌دهی و رفتار
 * مکان‌نمای آن هیچ ربطی به مسیر رندر ندارد. نتیجه‌ی «رندر متن درست است»
 * هیچ چیزی درباره‌ی ویرایش نمی‌گوید.
 *
 * **چرا خودکار شروع نمی‌شود:** Excalidraw رویدادهای اشاره‌گر مصنوعی
 * (`dispatchEvent`) را نمی‌پذیرد و فقط با ورودی واقعی وارد حالت ویرایش
 * می‌شود. پس صفحه منتظر می‌ماند تا کاربر ویرایشگر را باز کند و به‌محض
 * ظاهر شدن `.excalidraw-wysiwyg` همه‌ی probe ها را اجرا می‌کند.
 */

const FONT_SIZE = 20;

/** رشته‌های آزمون نرمال‌سازی — هر کدام یک تله‌ی شناخته‌شده‌ی فارسی. */
const NORMALIZE_CASES: [label: string, text: string][] = [
  ["فارسی ساده", "سلام دنیا"],
  ["ی و ک عربی (U+064A/U+0643)", "كتابي عربي"],
  ["نیم‌فاصله (ZWNJ)", "می‌خواهم نیم‌فاصله"],
  ["اعداد فارسی", "۱۲۳۴۵۶۷۸۹۰"],
  ["اعداد فارسی + لاتین", "تعداد ۱۲۳ از 456"],
  ["اعراب", "بِسْمِ اللّٰهِ"],
  ["کشیده (tatweel)", "بازـــرگانی"],
  ["علامت راست‌به‌چپ (RLM)", "‏فارسی‏"],
  ["emoji", "هم‌بوم 🎨 است"],
  ["تب — فارسی", "خط\tاول"],
  ["تب — لاتین (شاهد)", "ab\tcd"],
];

const DIR_AUTO_CASES: [label: string, text: string, expected: string][] = [
  ["فارسی خالص", "سلام دنیا", "rtl"],
  ["شروع با فارسی + لاتین", "این یک board است", "rtl"],
  ["شروع با عدد فارسی", "۱۲۳ مورد از ۴۵۶", "rtl"],
  ["شروع با عدد لاتین + فارسی", "456 مورد باقی مانده", "rtl"],
  ["شروع با کلمه‌ی لاتین + فارسی", "board برای تیم ماست", "rtl"],
  ["شروع با گیومه + فارسی", "«سلام دنیا»", "rtl"],
  ["لاتین خالص (شاهد)", "The quick brown fox", "ltr"],
];

const PASTE_TEXT = "می‌خواهم ۱۲۳ مورد از board را با كتابي 🎨";

interface EditorProbe {
  dirAttr: string | null;
  direction: string;
  textAlignInline: string;
  textAlignComputed: string;
  unicodeBidi: string;
  wrap: string;
  whiteSpace: string;
}

interface NormalizeRow {
  label: string;
  inLen: number;
  outLen: number;
  changed: boolean;
  caretBefore: number;
  caretAfter: number;
  caretShouldBe: number;
  caretWrong: boolean;
}

interface PasteRow {
  lossless: boolean;
  zwnj: boolean;
  faDigits: boolean;
  arabicYe: boolean;
  emoji: boolean;
  len: number;
}

/** جهتی که مرورگر با `dir="auto"` برای یک رشته انتخاب می‌کند. */
function resolveAutoDirection(text: string): string {
  const probe = document.createElement("span");
  probe.setAttribute("dir", "auto");
  probe.textContent = text;
  probe.style.cssText = "position:absolute;visibility:hidden";
  document.body.appendChild(probe);
  const dir = getComputedStyle(probe).direction;
  probe.remove();
  return dir;
}

function probeEditor(ta: HTMLTextAreaElement): EditorProbe {
  // با متن فارسی پر می‌کنیم تا dir="auto" واقعاً تصمیم بگیرد؛
  // روی textarea خالی همیشه ltr می‌ماند و نتیجه گمراه‌کننده است.
  ta.value = "سلام دنیا";
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  const cs = getComputedStyle(ta);
  return {
    dirAttr: ta.getAttribute("dir"),
    direction: cs.direction,
    textAlignInline: ta.style.textAlign,
    textAlignComputed: cs.textAlign,
    unicodeBidi: cs.unicodeBidi,
    wrap: ta.wrap,
    whiteSpace: cs.whiteSpace,
  };
}

function probeNormalize(ta: HTMLTextAreaElement): NormalizeRow[] {
  return NORMALIZE_CASES.map(([label, text]) => {
    const caretBefore = Math.floor(text.length / 2);
    ta.value = text;
    ta.selectionStart = caretBefore;
    ta.selectionEnd = caretBefore;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    const out = ta.value;
    const caretAfter = ta.selectionStart;
    const caretShouldBe = caretBefore + (out.length - text.length);
    return {
      label,
      inLen: text.length,
      outLen: out.length,
      changed: out !== text,
      caretBefore,
      caretAfter,
      caretShouldBe,
      caretWrong: caretAfter !== caretShouldBe,
    };
  });
}

function probePaste(ta: HTMLTextAreaElement): PasteRow {
  ta.value = "";
  const dt = new DataTransfer();
  dt.setData("text/plain", PASTE_TEXT);
  ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
  // رفتار پیش‌فرض مرورگر برای رویداد مصنوعی اجرا نمی‌شود، پس مقدار را خودمان
  // می‌گذاریم تا مسیر نرمال‌سازی `oninput` — که پیست واقعی هم از آن رد می‌شود — اجرا شود.
  ta.value = PASTE_TEXT;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  const v = ta.value;
  return {
    lossless: v === PASTE_TEXT,
    zwnj: v.includes("‌"),
    faDigits: v.includes("۱۲۳"),
    arabicYe: v.includes("ي"),
    emoji: v.includes("🎨"),
    len: v.length,
  };
}

export function SpikeEditing() {
  const [editor, setEditor] = useState<EditorProbe | null>(null);
  const [normalize, setNormalize] = useState<NormalizeRow[]>([]);
  const [paste, setPaste] = useState<PasteRow | null>(null);
  const dirAuto = DIR_AUTO_CASES.map(([label, text, expected]) => {
    const resolved = resolveAutoDirection(text);
    return { label, text, expected, resolved, ok: resolved === expected };
  });

  const onReady = useCallback((api: ExcalidrawImperativeAPI) => {
    const elements = convertToExcalidrawElements([
      {
        type: "text",
        x: 100,
        y: 100,
        text: "روی این متن دابل‌کلیک کن",
        fontSize: FONT_SIZE,
        fontFamily: FONT_FAMILY.Excalifont,
      },
    ]);
    // محتوای اولیه‌ی spike، نه ژستِ کاربر → بدون ورودی undo (ADR-026).
    api.updateScene({ elements, captureUpdate: "NEVER" });
    api.scrollToContent(elements, { fitToContent: true });
  }, []);

  // به‌محض باز شدن ویرایشگر، همه‌ی probe ها یک‌بار اجرا می‌شوند.
  useEffect(() => {
    let done = false;
    const run = () => {
      if (done) return;
      const ta = document.querySelector<HTMLTextAreaElement>(".excalidraw-wysiwyg");
      if (!ta) return;
      done = true;
      const e = probeEditor(ta);
      const n = probeNormalize(ta);
      const p = probePaste(ta);
      setEditor(e);
      setNormalize(n);
      setPaste(p);
      (window as unknown as { __spikeEdit: unknown }).__spikeEdit = {
        editor: e,
        normalize: n,
        paste: p,
        dirAuto,
      };
    };
    const observer = new MutationObserver(run);
    observer.observe(document.body, { childList: true, subtree: true });
    run();
    return () => observer.disconnect();
    // dirAuto در هر رندر بازساخته می‌شود ولی مقدارش ثابت است؛ وابستگی لازم نیست.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="hb-page">
      <header className="hb-header">
        <div className="hb-header-main">
          <h1 className="hb-title">spike ویرایش inline و کلیپ‌بورد</h1>
          <p className="hb-subtitle">
            تکمیل گام ۱٫۳ — روی متن روی بوم <strong>دابل‌کلیک کن</strong> تا probe ها اجرا شوند
          </p>
        </div>
      </header>

      <main className="hb-canvas-host hb-spike-canvas">
        <HamboomCanvas onReady={onReady} />
      </main>

      <section className="hb-spike-results">
        <h2>۱. ویرایشگر inline (textarea شناور)</h2>
        {editor === null ? (
          <p className="hb-waiting">
            منتظر باز شدن ویرایشگر… روی متن روی بوم دابل‌کلیک کن (یا ابزار متن را انتخاب کن و روی
            بوم کلیک کن).
          </p>
        ) : (
          <dl className="hb-rows hb-rows-block">
            {(
              [
                ["صفت dir", editor.dirAttr ?? "—", editor.dirAttr === "auto"],
                [
                  "direction محاسبه‌شده (با متن فارسی)",
                  editor.direction,
                  editor.direction === "rtl",
                ],
                ["unicode-bidi", editor.unicodeBidi, editor.unicodeBidi === "plaintext"],
                ["text-align (inline از عنصر)", editor.textAlignInline || "—", false],
                ["text-align محاسبه‌شده", editor.textAlignComputed, false],
                ["wrap", editor.wrap, true],
                ["white-space", editor.whiteSpace, true],
              ] as [string, string, boolean][]
            ).map(([k, v, ok]) => (
              <div className="hb-row" key={k}>
                <dt>{k}</dt>
                <dd>
                  {v} {ok ? "✅" : "⚠️"}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <h2>۲. نرمال‌سازی ورودی و مکان‌نما</h2>
        <table className="hb-table">
          <thead>
            <tr>
              <th>مورد</th>
              <th>طول ورودی</th>
              <th>طول خروجی</th>
              <th>متن عوض شد؟</th>
              <th>مکان‌نما</th>
              <th>باید می‌بود</th>
              <th>درست؟</th>
            </tr>
          </thead>
          <tbody>
            {normalize.length === 0 ? (
              <tr>
                <td colSpan={7}>—</td>
              </tr>
            ) : (
              normalize.map((n) => (
                <tr key={n.label}>
                  <td>{n.label}</td>
                  <td className="hb-num">{n.inLen}</td>
                  <td className="hb-num">{n.outLen}</td>
                  <td>{n.changed ? "بله" : "خیر"}</td>
                  <td className="hb-num">{n.caretAfter}</td>
                  <td className="hb-num">{n.caretShouldBe}</td>
                  <td>{n.caretWrong ? "❌" : "✅"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <h2>۳. جهت‌یابی خودکار (dir=&quot;auto&quot;)</h2>
        <table className="hb-table">
          <thead>
            <tr>
              <th>مورد</th>
              <th>متن</th>
              <th>انتخاب مرورگر</th>
              <th>انتظار</th>
              <th>درست؟</th>
            </tr>
          </thead>
          <tbody>
            {dirAuto.map((d) => (
              <tr key={d.label}>
                <td>{d.label}</td>
                <td className="hb-cell-text">{d.text}</td>
                <td className="hb-num">{d.resolved}</td>
                <td className="hb-num">{d.expected}</td>
                <td>{d.ok ? "✅" : "❌"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>۴. کپی/پیست</h2>
        {paste === null ? (
          <p className="hb-waiting">—</p>
        ) : (
          <dl className="hb-rows hb-rows-block">
            {(
              [
                ["بدون تلفات", paste.lossless],
                ["نیم‌فاصله حفظ شد", paste.zwnj],
                ["اعداد فارسی حفظ شدند", paste.faDigits],
                ["ی عربی حفظ شد (تبدیل نشد)", paste.arabicYe],
                ["emoji حفظ شد", paste.emoji],
              ] as [string, boolean][]
            ).map(([k, v]) => (
              <div className="hb-row" key={k}>
                <dt>{k}</dt>
                <dd>{v ? "بله ✅" : "خیر ❌"}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}
