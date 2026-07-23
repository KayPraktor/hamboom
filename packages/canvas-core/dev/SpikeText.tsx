import {
  FONT_FAMILY,
  HamboomCanvas,
  convertToExcalidrawElements,
  getCanvasTextDirectionInvocations,
  isCanvasTextDirectionInstalled,
} from "@hamboom/canvas-core";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useState } from "react";

/**
 * صفحه‌ی spike متن فارسی — گام ۱٫۳ از TODO.md.
 *
 * **این صفحه کد محصولی نیست؛ ابزار جمع‌آوری شواهد است.**
 *
 * خروجی: جدول عددی زیر صفحه + بازرسی چشمی روی بوم. نتیجه در
 * `docs/spike-persian-text.md` ثبت و به یک تصمیم صریح درباره‌ی پله‌ی
 * [ADR-003](../../../ARCHITECTURE_DECISIONS.md#adr-003) تبدیل می‌شود.
 */

interface TestCase {
  id: string;
  label: string;
  text: string;
  /** چه چیزی را می‌سنجد */
  probes: string;
}

const CASES: TestCase[] = [
  {
    id: "simple",
    label: "فارسی ساده تک‌خطی",
    text: "سلام دنیا",
    probes: "شکل‌دهی حروف (چسبیدن)",
  },
  {
    id: "paragraph",
    label: "پاراگراف فارسی (شکست خط)",
    text: "هم‌بوم یک بوم همکاری آنلاین است که تیم‌ها می‌توانند روی آن با هم فکر کنند، ایده بسازند و کارها را سازمان بدهند بدون اینکه به ابزار خارجی نیاز داشته باشند.",
    probes: "شکست خط، شکستن لیگاتور",
  },
  {
    id: "mixed",
    label: "فارسی + انگلیسی",
    text: "این یک board برای team ماست",
    probes: "ترتیب bidi",
  },
  {
    id: "numbers",
    label: "فارسی + عدد فارسی و لاتین",
    text: "تعداد ۱۲۳ مورد از 456 مورد",
    probes: "bidi عددی",
  },
  {
    id: "punctuation",
    label: "نشانه‌گذاری و پرانتز",
    text: "آیا این درست است؟ (داخل پرانتز) — بله!",
    probes: "جای نشانه‌گذاری در انتهای خط",
  },
  {
    id: "zwnj",
    label: "نیم‌فاصله و emoji",
    text: "می‌خواهم نیم‌فاصله را می‌آزمایم 🎨 و هم‌بوم",
    probes: "ZWNJ (U+200C)، emoji",
  },
  {
    id: "longword",
    label: "کلمه‌ی بلندتر از ظرف (شکست اجباری)",
    text: "دانشگاهعلومپزشکیوخدماتبهداشتیدرمانیتهران",
    probes: "شکست وسط کلمه — آیا لیگاتور می‌شکند؟",
  },
  {
    id: "alljoining",
    label: "کلمه‌ی تماماً چسبان (آزمون قطعی شکست)",
    // «س» از هر دو طرف می‌چسبد؛ هر شکستی در این رشته یک اتصال را پاره می‌کند.
    text: "سسسسسسسسسسسسسسسسسسسسسسسسسسسسسس",
    probes: "آیا شکست اجباری اتصال حروف را پاره می‌کند؟",
  },
  {
    id: "latin-control",
    label: "شاهد لاتین",
    text: "The quick brown fox jumps",
    probes: "مقایسه — باید درست باشد",
  },
];

const FONT_SIZE = 20;

interface Measurement {
  id: string;
  /** عرضی که Excalidraw برای عنصر حساب کرده */
  engineWidth: number;
  /** عرض واقعی از measureText روی کل رشته */
  realWidth: number;
  /** جمع عرض تک‌تک کاراکترها — روشی که Excalidraw داخلاً استفاده می‌کند */
  charSumWidth: number;
  /** خطای نسبی engine در برابر واقعیت */
  engineErrorPct: number;
  /** خطای روش کاراکتربه‌کاراکتر در برابر واقعیت */
  charSumErrorPct: number;
  /** متن بعد از wrap — تعداد خط */
  lineCount: number;
  /** آیا فونت Vazirmatn واقعاً برای این رشته استفاده شد */
  usedVazirmatn: boolean;
}

/** اندازه‌گیری واقعی با canvas 2d — مرجع حقیقت. */
function measureReal(text: string, fontString: string): number {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return NaN;
  ctx.font = fontString;
  return ctx.measureText(text).width;
}

/** جمع عرض تک‌تک کاراکترها — همان الگویی که Excalidraw در charWidth.calculate دارد. */
function measureCharSum(text: string, fontString: string): number {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return NaN;
  ctx.font = fontString;
  let total = 0;
  for (const char of text) total += ctx.measureText(char).width;
  return total;
}

/**
 * آیا مرورگر برای این رشته واقعاً Vazirmatn را انتخاب کرد؟
 * روش: عرض رشته با فونت هدف را با عرض همان رشته وقتی فونت وجود ندارد مقایسه می‌کنیم.
 */
function usesVazirmatn(text: string, family: string): boolean {
  // `document.fonts.check` دقیقاً می‌گوید آیا برای همه‌ی کاراکترهای این رشته
  // یک face لودشده در آن خانواده وجود دارد. مقایسه‌ی عرض برای این کار قابل
  // اتکا نیست، چون فاصله و نشانه‌گذاری از face لاتین می‌آیند.
  const persianOnly = [...text].filter((ch) => /[؀-ۿ]/.test(ch)).join("");
  if (persianOnly.length === 0) return false;
  return document.fonts.check(`${FONT_SIZE}px ${family}`, persianOnly);
}

export function SpikeText() {
  const [rows, setRows] = useState<Measurement[]>([]);
  const [fontStringUsed, setFontStringUsed] = useState("");
  const [dirHook, setDirHook] = useState({ installed: false, invocations: 0 });

  /**
   * ★ تایید ADR-023 — این عدد باید هنگام کار با بوم بالا برود.
   *
   * اگر روی صفر بماند، یعنی موتور از مسیر
   * `CanvasRenderingContext2D.prototype.fillText` رد نمی‌شود و راه‌حل wrapper
   * جواب نمی‌دهد — آن‌وقت باید به patch (P-1) برگردیم. عمداً زنده به‌روز می‌شود
   * تا با یک نگاه، بدون ابزار، قابل بررسی باشد.
   */
  useEffect(() => {
    const id = window.setInterval(() => {
      setDirHook({
        installed: isCanvasTextDirectionInstalled(),
        invocations: getCanvasTextDirectionInvocations(),
      });
    }, 400);
    return () => window.clearInterval(id);
  }, []);

  const onReady = useCallback((api: ExcalidrawImperativeAPI) => {
    const skeletons = CASES.map((c, i) => ({
      type: "text" as const,
      x: 60,
      y: 60 + i * 90,
      text: c.text,
      fontSize: FONT_SIZE,
      fontFamily: FONT_FAMILY.Excalifont,
    }));

    // گروه دوم: متن مقید داخل ظرف با عرض ثابت — دقیقاً حالت استیکی‌نوت.
    // شکست خط فقط در این حالت اتفاق می‌افتد؛ متن آزاد با autoResize هرگز نمی‌شکند.
    const WRAP_WIDTH = 220;
    const containerSkeletons = CASES.map((c, i) => ({
      type: "rectangle" as const,
      x: 700 + i * 260,
      y: 60,
      width: WRAP_WIDTH,
      height: WRAP_WIDTH,
      label: {
        text: c.text,
        fontSize: FONT_SIZE,
        fontFamily: FONT_FAMILY.Excalifont,
      },
    }));

    const elements = convertToExcalidrawElements([...skeletons, ...containerSkeletons]);
    api.updateScene({ elements });
    api.scrollToContent(elements, { fitToContent: true });

    // برای بازرسی دستی از کنسول در حین spike
    (window as unknown as { __api: unknown; __converted: unknown }).__api = api;
    (window as unknown as { __api: unknown; __converted: unknown }).__converted = elements;

    // Excalidraw رشته‌ی فونت را این‌طور می‌سازد: `${fontSize}px ${familyName}`
    const fontString = `${FONT_SIZE}px Excalifont`;
    setFontStringUsed(fontString);

    // یک تیک صبر می‌کنیم تا اندازه‌گیری و wrap موتور تمام شود.
    window.setTimeout(() => {
      const scene = api.getSceneElements();
      const wrapped = scene.filter((el) => el.type === "text" && el.containerId);
      const measurements: Measurement[] = CASES.map((c, i) => {
        const el = scene[i];
        const engineWidth = el && "width" in el ? el.width : NaN;
        const wrappedEl = wrapped[i];
        const renderedText =
          wrappedEl && "text" in wrappedEl ? String(wrappedEl.text) : String(c.text);
        const realWidth = measureReal(c.text, fontString);
        const charSumWidth = measureCharSum(c.text, fontString);
        return {
          id: c.id,
          engineWidth: Math.round(engineWidth * 10) / 10,
          realWidth: Math.round(realWidth * 10) / 10,
          charSumWidth: Math.round(charSumWidth * 10) / 10,
          engineErrorPct: Math.round(((engineWidth - realWidth) / realWidth) * 1000) / 10,
          charSumErrorPct: Math.round(((charSumWidth - realWidth) / realWidth) * 1000) / 10,
          lineCount: renderedText.split("\n").length,
          usedVazirmatn: usesVazirmatn(c.text, "Excalifont"),
        };
      });
      setRows(measurements);
      // برای بازرسی برنامه‌ای از بیرون
      (window as unknown as { __spike: unknown }).__spike = {
        measurements,
        fontString,
        wrappedLines: wrapped.map((el) => ("text" in el ? String(el.text).split("\n") : [])),
      };
    }, 600);
  }, []);

  return (
    <div className="hb-page">
      <header className="hb-header">
        <div className="hb-header-main">
          <h1 className="hb-title">spike متن فارسی</h1>
          <p className="hb-subtitle">گام ۱٫۳ — جمع‌آوری شواهد، نه کد محصولی</p>
        </div>
        <dl className="hb-rows">
          <div className="hb-row">
            <dt>فونت</dt>
            <dd>{fontStringUsed || "—"}</dd>
          </div>
          <div className="hb-row">
            <dt>hook جهت نصب است؟</dt>
            <dd>{dirHook.installed ? "بله" : "خیر"}</dd>
          </div>
          <div className="hb-row">
            <dt>فراخوانی hook</dt>
            <dd>
              {dirHook.invocations} {dirHook.invocations > 0 ? "✅" : "⚠️"}
            </dd>
          </div>
        </dl>
      </header>

      <main className="hb-canvas-host hb-spike-canvas">
        <HamboomCanvas onReady={onReady} />
      </main>

      <section className="hb-spike-results">
        <h2>اندازه‌گیری</h2>
        <table className="hb-table">
          <thead>
            <tr>
              <th>مورد</th>
              <th>متن</th>
              <th>عرض موتور</th>
              <th>عرض واقعی</th>
              <th>جمع کاراکتری</th>
              <th>خطای موتور</th>
              <th>خطای کاراکتری</th>
              <th>خط</th>
              <th>Vazirmatn؟</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9}>در حال اندازه‌گیری…</td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={r.id}>
                  <td>{CASES[i]?.label}</td>
                  <td className="hb-cell-text">{CASES[i]?.text}</td>
                  <td className="hb-num">{r.engineWidth}</td>
                  <td className="hb-num">{r.realWidth}</td>
                  <td className="hb-num">{r.charSumWidth}</td>
                  <td className="hb-num">{r.engineErrorPct}%</td>
                  <td className="hb-num">{r.charSumErrorPct}%</td>
                  <td className="hb-num">{r.lineCount}</td>
                  <td>{r.usedVazirmatn ? "بله" : "خیر"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <h2>مقایسه‌ی رندر DOM (مرجع درست)</h2>
        <ul className="hb-dom-samples">
          {CASES.map((c) => (
            <li key={c.id}>
              <span className="hb-sample-label">{c.probes}</span>
              <span className="hb-sample-text">{c.text}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
