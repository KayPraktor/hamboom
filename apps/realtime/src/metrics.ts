import { memoryUsage } from "node:process";
import { getHeapStatistics } from "node:v8";

/**
 * ★★ متریک‌های `apps/realtime` — M5 گام ۵٫۱/۵٫۲ ([ADR-061](../../../ARCHITECTURE_DECISIONS.md#adr-061)).
 *
 * ── چرا این فایل اصلاً وجود دارد ─────────────────────────────────────────
 *
 * [ADR-048](../../../ARCHITECTURE_DECISIONS.md#adr-048) تریگرِ room affinity را با یک
 * **عدد** نوشت: «بیشینه‌ی حافظه‌ی مقیمِ اتاق‌ها از ~۶۰٪ heap بگذرد». ولی تا امروز آن عدد
 * **هیچ‌جا گزارش نمی‌شد** — یعنی معیارِ تصمیمِ خودمان اندازه‌ناپذیر بود.
 * **تریگری که قابلِ اندازه‌گیری نباشد تریگر نیست، آرزوست.**
 *
 * ── ⚠️ چه چیزی اندازه‌گیری است و چه چیزی تخمین ───────────────────────────
 *
 * **اندازه‌گیریِ دقیق:** `heapUsed`، سقفِ heap، تعدادِ اتاق و نشست، و **حجمِ سندِ** هر
 * اتاق (`encodeStateAsUpdate`).
 *
 * ★ **تخمین:** حافظه‌ی **مقیمِ** هر اتاق. راهِ دقیقش گرفتنِ heap snapshot است که در یک
 * سرویسِ زنده هزینه‌ی مکثِ چندصدمیلی‌ثانیه‌ای دارد — پس روی نمایشِ درون‌حافظه‌ایِ Yjs یک
 * ضریب زده می‌شود که [`docs/realtime-baseline.md`](../../../docs/realtime-baseline.md)
 * **اندازه‌اش گرفته**: در چهار مقیاس (۵۰۰ تا ۵۰۰۰ عنصر) نسبتِ حافظه به سند بین ۱۹٫۷ و
 * ۲۰٫۸ ماند. ⚠️ نامِ متریک هم همین را می‌گوید (`_estimated_`) تا کسی با عددِ دقیق
 * اشتباهش نگیرد، و `hamboom_rt_room_memory_ratio` خودِ ضریب را منتشر می‌کند تا اگر روزی
 * غلط شد، از روی همان داشبورد قابلِ تشخیص باشد.
 *
 * ⊕ و [`infra:probe-metrics`](../../../scripts/infra-probe-metrics.ts) این تخمین را با یک
 * اندازه‌گیریِ **واقعیِ** heap (با `--expose-gc`) مقایسه می‌کند — همان روشِ `rt:bench`.
 */

/**
 * ★ نسبتِ **اندازه‌گیری‌شده‌ی** حافظه‌ی مقیمِ اتاق به حجمِ سند.
 *
 * از [`docs/realtime-baseline.md`](../../../docs/realtime-baseline.md): ۰٫۳۵MB→۷٫۱MB ·
 * ۰٫۷۲MB→۱۴٫۶MB · ۱٫۸۲MB→۳۷٫۱MB · ۳٫۶۶MB→۷۶٫۰MB. یعنی ۲۰٫۳ · ۲۰٫۳ · ۲۰٫۴ · ۲۰٫۸.
 *
 * ⚠️ **این ضریب یک ثابتِ فیزیکی نیست** — به نمایشِ درون‌حافظه‌ایِ نسخه‌ی Yjs بسته است و
 * با ارتقای آن می‌تواند عوض شود. به همین دلیل منتشر می‌شود، و probe می‌سنجدش.
 */
export const ROOM_MEMORY_RATIO = 20;

/** هر اتاق حداکثر با این فاصله دوباره اندازه‌گیری می‌شود (نه در هر scrape). */
const DOC_SIZE_TTL_MS = 30_000;

export interface RoomSample {
  boardId: string;
  sessions: number;
  /** اندازه‌گیریِ **دقیق** — بایت‌های `encodeStateAsUpdate`. */
  docBytes: number;
  /** ★ **تخمین** — `docBytes × ROOM_MEMORY_RATIO`. */
  estimatedResidentBytes: number;
}

export interface RealtimeMetricsInput {
  rooms: RoomSample[];
  /** اتصال‌های WSِ باز (شاملِ آن‌هایی که هنوز به اتاقی نپیوسته‌اند). */
  connections: number;
  /** ★ شمارنده‌ی تجمعیِ اتصالِ رد‌شده — نرخِ reconnectِ ریسکِ PLAN §۱۰ از این درمی‌آید. */
  handshakesRejected: number;
  handshakesAccepted: number;
}

/**
 * کشِ حجمِ سند — `encodeStateAsUpdate` روی بوردِ ۵۰۰۰عنصری چند مگابایت allocate
 * می‌کند، و انجامش در **هر** scrape یعنی متریک خودش منبعِ فشارِ حافظه شود.
 */
export function createDocSizeCache(ttlMs = DOC_SIZE_TTL_MS, now: () => number = Date.now) {
  const cache = new Map<string, { bytes: number; at: number }>();
  return {
    /** مقدارِ تازه یا کشی. `measure` فقط وقتی صدا زده می‌شود که کش کهنه باشد. */
    get(boardId: string, measure: () => number): number {
      const hit = cache.get(boardId);
      const t = now();
      if (hit && t - hit.at < ttlMs) return hit.bytes;
      const bytes = measure();
      cache.set(boardId, { bytes, at: t });
      return bytes;
    },
    forget(boardId: string): void {
      cache.delete(boardId);
    },
    get size(): number {
      return cache.size;
    },
  };
}

/** یک خطِ متریکِ Prometheus (نامِ متریک، توضیح، نوع، مقدار). */
function metric(name: string, help: string, type: "gauge" | "counter", value: number): string {
  return [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, `${name} ${String(value)}`].join("\n");
}

/**
 * متنِ `/metrics` را می‌سازد — قالبِ متنیِ Prometheus، بدونِ هیچ وابستگیِ تازه.
 *
 * ⚠️ **هیچ برچسبِ per-board منتشر نمی‌شود.** شناسه‌ی بورد در یک سیستمِ مشترک، داده‌ی
 * مشتری است؛ و کاردینالیتیِ بی‌مرز هر سیستمِ متریکی را می‌کُشد. فقط **تجمیع** می‌رود
 * بیرون: مجموع، بیشینه، و شمار.
 */
export function renderRealtimeMetrics(input: RealtimeMetricsInput): string {
  const heap = memoryUsage().heapUsed;
  const heapLimit = getHeapStatistics().heap_size_limit;
  const docTotal = input.rooms.reduce((n, r) => n + r.docBytes, 0);
  const estTotal = input.rooms.reduce((n, r) => n + r.estimatedResidentBytes, 0);
  const estMax = input.rooms.reduce((n, r) => Math.max(n, r.estimatedResidentBytes), 0);
  const sessions = input.rooms.reduce((n, r) => n + r.sessions, 0);

  return (
    [
      metric("hamboom_rt_rooms", "اتاق‌های مقیم در حافظه‌ی این نود", "gauge", input.rooms.length),
      metric("hamboom_rt_sessions", "نشست‌های پیوسته به اتاق‌ها", "gauge", sessions),
      metric("hamboom_rt_connections", "اتصال‌های باز WebSocket", "gauge", input.connections),
      metric(
        "hamboom_rt_handshakes_accepted_total",
        "دست‌دادن‌های پذیرفته‌شده از زمانِ بالاآمدن",
        "counter",
        input.handshakesAccepted,
      ),
      metric(
        "hamboom_rt_handshakes_rejected_total",
        "دست‌دادن‌های ردشده (توکن/ظرفیت) — نرخِ reconnect از این درمی‌آید",
        "counter",
        input.handshakesRejected,
      ),
      metric(
        "hamboom_rt_room_doc_bytes",
        "مجموعِ حجمِ سندِ اتاق‌ها — اندازه‌گیریِ دقیق",
        "gauge",
        docTotal,
      ),
      metric(
        "hamboom_rt_room_memory_ratio",
        "ضریبِ اندازه‌گیری‌شده‌ی حافظه‌ی مقیم به حجمِ سند (realtime-baseline)",
        "gauge",
        ROOM_MEMORY_RATIO,
      ),
      metric(
        "hamboom_rt_room_estimated_memory_bytes",
        "★ تخمینِ حافظه‌ی مقیمِ همه‌ی اتاق‌ها — تریگرِ ADR-048",
        "gauge",
        estTotal,
      ),
      metric(
        "hamboom_rt_room_estimated_memory_max_bytes",
        "★★ بزرگ‌ترین اتاق — همان چیزی که ADR-048 با ۶۰٪ heap مقایسه‌اش می‌کند",
        "gauge",
        estMax,
      ),
      metric("hamboom_rt_heap_used_bytes", "heapUsedِ فرایند", "gauge", heap),
      metric("hamboom_rt_heap_limit_bytes", "سقفِ heapِ V8", "gauge", heapLimit),
      /**
       * ★★ **خودِ تریگرِ ADR-048، از قبل حساب‌شده.**
       *
       * ⚠️ عمداً محاسبه‌شده منتشر می‌شود و به داشبورد سپرده نمی‌شود: وقتی معیارِ
       * تصمیم یک فرمول در جای دیگری باشد، همان فرمول است که کهنه می‌شود.
       */
      metric(
        "hamboom_rt_adr048_trigger_ratio",
        "تخمینِ بزرگ‌ترین اتاق ÷ سقفِ heap — ADR-048 روی ۰٫۶ تصمیم می‌گیرد",
        "gauge",
        heapLimit > 0 ? estMax / heapLimit : 0,
      ),
    ].join("\n") + "\n"
  );
}
