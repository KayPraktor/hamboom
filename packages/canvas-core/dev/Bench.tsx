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
  // توزیعِ زمانیِ فریم‌های کند (>۳۳ms) — تعیین می‌کند jank warmup است یا پایدار.
  slowFrames: number;
  slowPerSecond: number[]; // شمارشِ فریمِ کند در هر ثانیه (۴ سطل)
  worstFrameAtMs: number; // زمانِ بدترین فریم از شروع
  warmupSlow: number; // فریمِ کند در ۵۰۰ms اول
  steadySlow: number; // فریمِ کند بعد از ۵۰۰ms
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
      // هر فریم: مدت (dt) و زمانِ وقوع از شروع (at) — at برای توزیعِ زمانی لازم است.
      const frames: { dt: number; at: number }[] = [];
      await new Promise<void>((resolve) => {
        let last = performance.now();
        const start = last;
        const loop = (t: number) => {
          frames.push({ dt: t - last, at: t - start });
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

      const SLOW_MS = 1000 / 30; // ۳۳٫۳ms = مرزِ ۳۰fps
      // آمارِ سرخط: ۳ فریمِ اولِ warmup را می‌اندازد (مثلِ قبل، تا میانگین منصف باشد).
      const dts = frames.slice(3).map((f) => f.dt);
      const total = dts.reduce((a, b) => a + b, 0);
      const avgFps = Math.round((dts.length / total) * 1000);
      const worstFps = Math.round(1000 / Math.max(...dts));
      const sorted = [...dts].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
      const pctAbove30 = Math.round((dts.filter((d) => d <= SLOW_MS).length / dts.length) * 100);

      // توزیعِ زمانی روی **کلِ** فریم‌ها (شاملِ warmup) — تا معلوم شود jank کجاست.
      const slow = frames.filter((f) => f.dt > SLOW_MS);
      const slowPerSecond = [0, 0, 0, 0];
      for (const f of slow) {
        const bucket = Math.min(3, Math.floor(f.at / 1000));
        slowPerSecond[bucket] = (slowPerSecond[bucket] ?? 0) + 1;
      }
      const worst = frames.reduce((m, f) => (f.dt > m.dt ? f : m), frames[0]!);

      const res: BenchResult = {
        sceneCount,
        avgFps,
        worstFps,
        p95FrameMs: Math.round(p95 * 10) / 10,
        pctFramesAbove30: pctAbove30,
        pass: avgFps >= 30,
        slowFrames: slow.length,
        slowPerSecond,
        worstFrameAtMs: Math.round(worst.at),
        warmupSlow: slow.filter((f) => f.at < 500).length,
        steadySlow: slow.filter((f) => f.at >= 500).length,
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
              <ResultRow label="فریمِ کند (>۳۳ms)" value={String(result.slowFrames)} />
              <ResultRow
                label="پخشِ فریمِ کند (هر ثانیه)"
                value={result.slowPerSecond.join(" · ")}
              />
              <ResultRow
                label="warmup / پایدار"
                value={`${result.warmupSlow} (۵۰۰ms اول) / ${result.steadySlow} (بعد)`}
              />
              <ResultRow label="بدترین فریم در" value={`${result.worstFrameAtMs}ms`} />
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
