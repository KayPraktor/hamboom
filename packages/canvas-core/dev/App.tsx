import { CANVAS_CORE_NAME, ENGINE_STAGE, HamboomCanvas } from "@hamboom/canvas-core";
import { SYNC_CONTRACT_VERSION } from "@hamboom/canvas-core/sync";
import { useState } from "react";

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
 * گام ۱٫۱ — بوم واقعی حالا اینجاست. نوار وضعیت بالا برای این می‌ماند که
 * سیم‌کشی پکیج و پله‌ی ADR-003 در یک نگاه دیده شود.
 */
export function App() {
  const [elementCount, setElementCount] = useState(0);

  return (
    <div className="hb-page">
      <header className="hb-header">
        <div className="hb-header-main">
          <h1 className="hb-title">هم‌بوم</h1>
          <p className="hb-subtitle">محیط توسعه‌ی ماژول canvas-core</p>
        </div>
        <dl className="hb-rows">
          <Row label="پکیج" value={CANVAS_CORE_NAME} />
          <Row label="قرارداد sync" value={String(SYNC_CONTRACT_VERSION)} />
          <Row label="پله‌ی ADR-003" value={ENGINE_STAGE} />
          <Row label="تعداد عنصر" value={String(elementCount)} />
        </dl>
      </header>

      <main className="hb-canvas-host">
        <HamboomCanvas
          onReady={(api) => {
            api.onChange((elements) => {
              setElementCount(elements.filter((el) => !el.isDeleted).length);
            });
          }}
        />
      </main>
    </div>
  );
}
