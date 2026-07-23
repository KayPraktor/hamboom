import {
  HB_LOOK,
  HB_RADIUS,
  HB_SIZE,
  HB_STICKY_PALETTE,
  HB_TYPO,
  WCAG_AA_LARGE,
  WCAG_AA_TEXT,
  contrastRatio,
} from "@hamboom/canvas-core";

/**
 * صفحه‌ی پالت — گام ۳٫۱.
 *
 * دوازده رنگ را با متن فارسی واقعی نشان می‌دهد، نه فقط مربع رنگی: کنتراست
 * را باید روی همان چیزی سنجید که کاربر می‌بیند. عدد کنتراست هم کنارش
 * می‌آید تا اگر روزی رنگی اضافه شد و تست شکست، اینجا هم بشود دید کجا.
 */

const PREVIEW_TEXT = "ایده‌ی جدید برای تیم";

function Swatch({ swatch }: { swatch: (typeof HB_STICKY_PALETTE)[number] }) {
  const textRatio = contrastRatio(swatch.text, swatch.bg);
  const accentRatio = contrastRatio(swatch.accent, swatch.bg);

  return (
    <figure className="hb-swatch">
      <div
        className="hb-swatch-note"
        style={{
          background: swatch.bg,
          color: swatch.text,
          borderRadius: HB_RADIUS.sticky,
          // ADR-016 — منطقی، نه فیزیکی.
          borderInlineStartColor: swatch.accent,
        }}
      >
        <span className="hb-swatch-text">{PREVIEW_TEXT}</span>
      </div>
      <figcaption>
        <strong>{swatch.nameFa}</strong>
        <dl className="hb-swatch-meta">
          <div>
            <dt>bg</dt>
            <dd>{swatch.bg}</dd>
          </div>
          <div>
            <dt>متن</dt>
            <dd>
              {textRatio.toFixed(2)} {textRatio >= WCAG_AA_TEXT ? "✅" : "❌"}
            </dd>
          </div>
          <div>
            <dt>accent</dt>
            <dd>
              {accentRatio.toFixed(2)} {accentRatio >= WCAG_AA_LARGE ? "✅" : "❌"}
            </dd>
          </div>
        </dl>
      </figcaption>
    </figure>
  );
}

export function Palette() {
  return (
    <div className="hb-page">
      <header className="hb-header">
        <div className="hb-header-main">
          <h1 className="hb-title">پالت استیکی</h1>
          <p className="hb-subtitle">گام ۳٫۱ — دوازده رنگ با کنتراست زنده</p>
        </div>
        <dl className="hb-rows">
          <div className="hb-row">
            <dt>آستانه متن</dt>
            <dd>{WCAG_AA_TEXT}</dd>
          </div>
          <div className="hb-row">
            <dt>آستانه accent</dt>
            <dd>{WCAG_AA_LARGE}</dd>
          </div>
          <div className="hb-row">
            <dt>roughness</dt>
            <dd>{HB_LOOK.roughness}</dd>
          </div>
          <div className="hb-row">
            <dt>اندازه استیکی</dt>
            <dd>
              {HB_SIZE.sticky.width}×{HB_SIZE.sticky.height}
            </dd>
          </div>
          <div className="hb-row">
            <dt>lineHeight</dt>
            <dd>{HB_TYPO.lineHeight}</dd>
          </div>
        </dl>
      </header>

      <main className="hb-spike-results">
        <div className="hb-swatch-grid">
          {HB_STICKY_PALETTE.map((swatch) => (
            <Swatch key={swatch.key} swatch={swatch} />
          ))}
        </div>
      </main>
    </div>
  );
}
