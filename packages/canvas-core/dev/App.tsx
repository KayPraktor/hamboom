import { CANVAS_CORE_NAME, ENGINE_STAGE } from "@hamboom/canvas-core";
import { SYNC_CONTRACT_VERSION } from "@hamboom/canvas-core/sync";

/** یک ردیف از جدول وضعیت. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="hb-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * صفحه‌ی دموی canvas-core.
 *
 * در گام ۰٫۲ این صفحه فقط ثابت می‌کند که سیم‌کشی پکیج درست است: نگاشت
 * `exports`، مسیر alias، TypeScript، و RTL. بوم واقعی در گام ۱٫۱ اینجا می‌نشیند.
 */
export function App() {
  return (
    <main className="hb-shell">
      <h1 className="hb-title">هم‌بوم</h1>
      <p className="hb-subtitle">محیط توسعه‌ی ماژول canvas-core</p>

      <section className="hb-card">
        <h2>وضعیت سیم‌کشی پکیج</h2>
        <dl className="hb-rows">
          <Row label="نام پکیج" value={CANVAS_CORE_NAME} />
          <Row label="زیرمسیر sync" value={`${CANVAS_CORE_NAME}/sync`} />
          <Row label="نسخه‌ی قرارداد sync" value={String(SYNC_CONTRACT_VERSION)} />
          <Row label="پله‌ی ADR-003" value={ENGINE_STAGE} />
        </dl>
      </section>

      <div className="hb-note">
        <p>
          <strong>بوم هنوز اینجا نیست.</strong> گام ۰٫۲ فقط اسکلت پکیج و مسیر توسعه را می‌سازد.
        </p>
        <p>
          گام بعدی ۱٫۱ است: نصب موتور رندر و رندر اولیه‌ی بوم — و بلافاصله بعد از آن، گام ۱٫۳ که
          spike متن فارسی و دروازه‌ی ریسک کل پروژه است.
        </p>
      </div>
    </main>
  );
}
