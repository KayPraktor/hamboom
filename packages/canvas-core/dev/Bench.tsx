import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useRef, useState } from "react";

import {
  createShape,
  createSticky,
  createText,
  HamboomCanvas,
  toExcalidraw,
} from "@hamboom/canvas-core";

/**
 * صفحه‌ی بنچمارکِ کارایی — گام ۵٫۴.
 *
 * محیطِ خودکارِ Claude رندرِ واقعی ندارد (پنجره مخفی، composite نمی‌شود)، پس این
 * صفحه را **مالک روی مرورگرِ خودش** اجرا می‌کند و عدد را برمی‌گرداند.
 *
 * روشِ اندازه‌گیری: N عنصرِ واقعی می‌سازد، بعد یک حلقه‌ی `requestAnimationFrame` به
 * مدتِ ۴ ثانیه scrollX/scrollY/zoom را **هر فریم** عوض می‌کند (همان کارِ رندرِ
 * pan/zoomِ واقعی — کلِ صحنه repaint می‌شود). FPS = تعدادِ فریم ÷ مدت. اگر زیر ۳۰
 * افتاد، cullingِ عناصرِ خارج از viewport لازم است ([TODO](../../../TODO.md) گام ۵٫۴).
 */

interface BenchResult {
  sceneCount: number;
  avgFps: number;
  worstFps: number;
  p95FrameMs: number;
  pctFramesAbove30: number;
  pass: boolean;
}

/** ~`target` عنصرِ صحنه بساز — ترکیبِ استیکی/شکل/متن برای بارِ رندرِ واقع‌گرایانه. */
function buildScene(target: number): unknown[] {
  const els: unknown[] = [];
  const cols = Math.ceil(Math.sqrt(target));
  const GX = 200;
  const GY = 150;
  let i = 0;
  while (els.length < target) {
    const x = (i % cols) * GX - (cols * GX) / 2;
    const y = Math.floor(i / cols) * GY - 500;
    const kind = i % 4;
    if (kind === 0) {
      createSticky({ x, y, text: `یادداشت ${i}`, authorId: "bench" }).elements.forEach((e) =>
        els.push(toExcalidraw(e)),
      );
    } else if (kind === 1) {
      createShape({
        shape: "rectangle",
        x,
        y,
        width: 140,
        height: 90,
        text: `کارت ${i}`,
        authorId: "bench",
      }).elements.forEach((e) => els.push(toExcalidraw(e)));
    } else if (kind === 2) {
      createShape({
        shape: "ellipse",
        x,
        y,
        width: 110,
        height: 110,
        authorId: "bench",
      }).elements.forEach((e) => els.push(toExcalidraw(e)));
    } else {
      els.push(toExcalidraw(createText({ x, y, text: `متنِ آزاد ${i}`, authorId: "bench" })));
    }
    i++;
  }
  return els;
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="hb-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function Bench() {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [status, setStatus] = useState(
    "بوم آماده — یک اندازه را بزن (تبِ مرورگر باید جلو و دیده باشد).",
  );
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BenchResult | null>(null);

  const run = useCallback(
    async (target: number) => {
      const api = apiRef.current;
      if (!api || running) return;
      setRunning(true);
      setResult(null);

      setStatus(`ساختِ ~${target} عنصر…`);
      await new Promise((r) => setTimeout(r, 30));
      api.updateScene({ elements: buildScene(target) as never, captureUpdate: "NEVER" });
      const sceneCount = api.getSceneElements().length;
      await new Promise((r) => setTimeout(r, 400)); // اولین رندر بنشیند
      setStatus(`اندازه‌گیریِ pan/zoom روی ${sceneCount} عنصر (۴ ثانیه)…`);

      const DURATION = 4000;
      const frameMs: number[] = [];
      await new Promise<void>((resolve) => {
        let last = performance.now();
        const start = last;
        const loop = (t: number) => {
          frameMs.push(t - last);
          last = t;
          const p = (t - start) / 1000;
          api.updateScene({
            appState: {
              scrollX: Math.sin(p * 2) * 600,
              scrollY: Math.cos(p * 1.5) * 400,
              zoom: { value: 1 + 0.25 * Math.sin(p) },
            } as never,
            captureUpdate: "NEVER",
          });
          if (t - start < DURATION) requestAnimationFrame(loop);
          else resolve();
        };
        requestAnimationFrame((t) => {
          last = t;
          requestAnimationFrame(loop);
        });
      });

      const fts = frameMs.slice(3); // چند فریمِ گرم‌کردن را بینداز
      const total = fts.reduce((a, b) => a + b, 0);
      const avgFps = Math.round((fts.length / total) * 1000);
      const worstFps = Math.round(1000 / Math.max(...fts));
      const sorted = [...fts].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
      const pctAbove30 = Math.round((fts.filter((f) => f <= 1000 / 30).length / fts.length) * 100);
      const res: BenchResult = {
        sceneCount,
        avgFps,
        worstFps,
        p95FrameMs: Math.round(p95 * 10) / 10,
        pctFramesAbove30: pctAbove30,
        pass: avgFps >= 30,
      };
      (window as unknown as { __benchResult: BenchResult }).__benchResult = res;
      setResult(res);
      setStatus("تمام — عدد را برایم بفرست (روی window.__benchResult هم هست).");
      setRunning(false);
    },
    [running],
  );

  return (
    <div className="hb-page">
      <header className="hb-header">
        <div className="hb-header-main">
          <h1 className="hb-title">بنچمارکِ کارایی</h1>
          <p className="hb-subtitle">هدفِ گام ۵٫۴: ۲۰۰۰ عنصر در pan/zoom بالای ۳۰fps</p>
        </div>

        <div className="hb-style-group" role="group" aria-label="اندازه‌ی بنچمارک">
          {[1000, 2000, 3000, 5000].map((n) => (
            <button
              key={n}
              type="button"
              className="hb-style-chip"
              disabled={running}
              onClick={() => void run(n)}
            >
              {n} عنصر
            </button>
          ))}
        </div>

        <dl className="hb-rows">
          <ResultRow label="وضعیت" value={status} />
          {result ? (
            <>
              <ResultRow label="عناصرِ صحنه" value={String(result.sceneCount)} />
              <ResultRow
                label="FPS میانگین"
                value={`${result.avgFps}  ${result.pass ? "✓ قبول (≥۳۰)" : "✗ رد (<۳۰)"}`}
              />
              <ResultRow label="بدترین FPS" value={String(result.worstFps)} />
              <ResultRow label="فریمِ p95" value={`${result.p95FrameMs}ms`} />
              <ResultRow label="٪ فریمِ ≥۳۰fps" value={`${result.pctFramesAbove30}٪`} />
            </>
          ) : null}
        </dl>
      </header>

      <main className="hb-canvas-host">
        <HamboomCanvas
          onReady={(api) => {
            apiRef.current = api;
          }}
        />
      </main>
    </div>
  );
}
