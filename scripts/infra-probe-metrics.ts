/**
 * ★★ سنجه‌ی M5 گام ۵٫۱ — **تخمینِ حافظه‌ی اتاق را با یک اندازه‌گیریِ واقعی بسنج.**
 *
 * ── چرا این سنجه لازم است ────────────────────────────────────────────────
 *
 * `/metrics` عددی به نامِ `hamboom_rt_room_estimated_memory_bytes` منتشر می‌کند که
 * **تخمین** است: حجمِ سند × ضریبِ ثابت. تریگرِ [ADR-048](../ARCHITECTURE_DECISIONS.md#adr-048)
 * روی همین عدد تصمیم می‌گیرد — پس اگر ضریب غلط باشد، تصمیمِ ظرفیتِ کلِ سیستم غلط است،
 * و **هیچ تستی این را نمی‌گیرد** چون همه‌ی تست‌ها همان ضریب را باور می‌کنند.
 *
 * این‌جا ضریب با همان روشِ `rt:bench` **اندازه‌گیری** می‌شود: `heapUsed` قبل و بعدِ
 * ساختنِ یک سندِ واقعی، با `global.gc()` بینشان.
 *
 * ⚠️ **بدونِ `--expose-gc` عددِ حافظه قابلِ استناد نیست** و سنجه همین را می‌گوید،
 * به‌جای اینکه یک عددِ نویزی را به‌عنوان اثبات جا بزند.
 *
 * ── ★ و یک چکِ دوم: `/metrics` واقعاً بالا می‌آید ─────────────────────────
 *
 * هر دو سرور با یک درخواستِ **واقعی** سنجیده می‌شوند (نه با unit test)، چون شکلِ
 * خروجیِ Prometheus و در دسترس بودنِ مسیر، چیزی است که فقط اجرا نشانش می‌دهد.
 *
 * اجرا: `pnpm infra:probe-metrics` (بعد از `pnpm db:up`).
 */
import { boardRoots, createBoardDoc, SCHEMA_VERSION } from "@hamboom/ydoc-schema";
import * as Y from "yjs";

import { ROOM_MEMORY_RATIO } from "../apps/realtime/src/metrics.ts";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: CheckResult[] = [];
const record = (name: string, ok: boolean, detail: string): void => {
  results.push({ name, ok, detail });
};

/** ★ GCِ اجباری — بدونِ `--expose-gc` در دسترس نیست. */
const forceGc = (globalThis as { gc?: () => void }).gc;

async function settleHeap(): Promise<number> {
  // دو بار GC و یک وقفه: نسلِ اولِ زباله معمولاً در پاسِ دوم آزاد می‌شود.
  forceGc?.();
  await new Promise((r) => setTimeout(r, 50));
  forceGc?.();
  return process.memoryUsage().heapUsed;
}

/** یک سندِ واقعیِ هم‌بوم با `n` عنصرِ استیکی می‌سازد. */
function buildDoc(n: number): Y.Doc {
  const doc = createBoardDoc();
  const { elements } = boardRoots(doc);
  doc.transact(() => {
    for (let i = 0; i < n; i += 1) {
      const el = new Y.Map<unknown>();
      el.set("id", `probe-${String(i)}`);
      el.set("type", "sticky");
      el.set("x", i * 12);
      el.set("y", i * 7);
      el.set("width", 200);
      el.set("height", 200);
      el.set("text", `یادداشتِ آزمایشی شماره ${String(i)} — متنی به‌اندازه‌ی یک استیکیِ واقعی`);
      el.set("color", "#ffd43b");
      el.set("schemaVersion", SCHEMA_VERSION);
      elements.set(`probe-${String(i)}`, el);
    }
  });
  return doc;
}

async function measureRatio(
  elements: number,
): Promise<{ docBytes: number; ratio: number; kbPerElement: number }> {
  const before = await settleHeap();
  const doc = buildDoc(elements);
  const docBytes = Y.encodeStateAsUpdate(doc).byteLength;
  const after = await settleHeap();
  const residentBytes = after - before;
  // ⚠️ `doc` عمداً تا این‌جا زنده نگه داشته می‌شود، وگرنه GC وسطِ اندازه‌گیری می‌بردش.
  doc.destroy();
  return {
    docBytes,
    ratio: residentBytes / docBytes,
    kbPerElement: residentBytes / elements / 1024,
  };
}

/** یک `GET` با سقفِ زمانی — سنجه نباید روی سروری که نیست آویزان بماند. */
async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`وضعیت ${String(res.status)}`);
  return res.text();
}

async function main(): Promise<void> {
  // ── ۱: ضریبِ حافظه، اندازه‌گیری‌شده ────────────────────────────────
  {
    const name = "★★ ضریبِ حافظه‌ی اتاق با اندازه‌گیریِ واقعی می‌خوانَد";
    if (!forceGc) {
      record(name, false, "بدونِ `--expose-gc` اجرا شد — عددِ حافظه قابلِ استناد نیست.");
    } else {
      try {
        const small = await measureRatio(500);
        const large = await measureRatio(2000);
        /**
         * ★★ **این سنجه دقیقاً همان چیزی را نمی‌سنجد که `rt:bench` سنجید، و ادعایش هم
         * همان نیست.**
         *
         * ⚠️ `rt:bench` اتاقی را می‌سنجد که از **مسیرِ واقعیِ سرور** ساخته شده (updateها
         * یکی‌یکی از پروتکل، لاگِ update، awareness) و ~۲۰× داد. این‌جا سند در **یک
         * تراکنش** ساخته می‌شود، پس ساختارهای داخلیِ کمتری دارد و نسبت طبیعتاً
         * **پایین‌تر** درمی‌آید (اندازه‌گیری: ~۱۱–۱۳×).
         *
         * پس ادعا این است: **تخمین از مرتبه‌ی درست است و ثابتِ ۲۰× محافظه‌کارانه است** —
         * یعنی حافظه را دست‌بالا می‌گیرد. برای یک تریگرِ ظرفیت این جهتِ **امن** است:
         * زودتر هشدار می‌دهد، نه دیرتر. یک بازه‌ی تنگ این‌جا فقط سنجه‌ای می‌ساخت که
         * تصادفی قرمز شود و بعد کسی خاموشش کند.
         */
        const ok =
          small.ratio > 8 &&
          small.ratio <= ROOM_MEMORY_RATIO * 1.75 &&
          large.ratio > 8 &&
          large.ratio <= ROOM_MEMORY_RATIO * 1.75;
        record(
          name,
          ok,
          `۵۰۰ عنصر ⇒ ${small.ratio.toFixed(1)}× (${small.kbPerElement.toFixed(1)}KB/عنصر) · ` +
            `۲۰۰۰ عنصر ⇒ ${large.ratio.toFixed(1)}× (${large.kbPerElement.toFixed(1)}KB/عنصر) · ` +
            `ثابتِ منتشرشده ${String(ROOM_MEMORY_RATIO)}× · rt:bench روی اتاقِ واقعی ~۲۰× و ~۱۵KB/عنصر`,
        );
      } catch (error) {
        record(name, false, `خودِ چک شکست: ${String((error as Error).message)}`);
      }
    }
  }

  // ── ۲ و ۳: `/metrics` روی هر دو سرورِ **زنده** ─────────────────────
  const targets = [
    {
      name: "`/metrics`ِ realtime پاسخ می‌دهد و گیجِ ADR-048 را دارد",
      url: process.env.RT_METRICS_URL ?? "http://127.0.0.1:15401/metrics",
      must: ["hamboom_rt_room_estimated_memory_max_bytes", "hamboom_rt_adr048_trigger_ratio"],
    },
    {
      name: "`/metrics`ِ api پاسخ می‌دهد و شمارنده‌های آشتی‌دهی/استخر را دارد",
      url: process.env.API_METRICS_URL ?? "http://127.0.0.1:15402/metrics",
      must: [
        "hamboom_api_reconcile_activated_total",
        "hamboom_api_pool_waiting",
        "hamboom_api_payments_stale_pending",
      ],
    },
  ];

  for (const target of targets) {
    try {
      const body = await fetchText(target.url);
      const missing = target.must.filter((m) => !body.includes(m));
      record(
        target.name,
        missing.length === 0,
        missing.length === 0
          ? `${String(body.split("\n").filter((l) => l && !l.startsWith("#")).length)} متریک`
          : `متریکِ گم‌شده: ${missing.join("، ")}`,
      );
    } catch (error) {
      record(
        target.name,
        false,
        `${target.url} در دسترس نبود (${String((error as Error).message)}) — سرور را بالا بیاور`,
      );
    }
  }

  for (const r of results) console.log(`${r.ok ? "✔" : "✖"} ${r.name}\n    ${r.detail}`);
  const reds = results.filter((r) => !r.ok);
  if (reds.length > 0) {
    console.error(`\n✖ ${String(reds.length)} چک قرمز شد.`);
    process.exit(1);
  }
  console.log("\n✔ تخمینِ حافظه با اندازه‌گیری خواند و هر دو `/metrics` زنده‌اند.");
}

await main();
