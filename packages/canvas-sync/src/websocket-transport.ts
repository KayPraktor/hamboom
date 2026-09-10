import { decodeMessage, encodeMessage, HB_ERROR_CODES, MSG_TYPES } from "@hamboom/ydoc-schema";

import { backoffDelayMs, RECONNECT_BACKOFF, type BackoffOptions } from "./backoff.ts";
import type { SyncTransport, TransportStatus } from "./transport.ts";

/**
 * ★ صادراتِ دوباره‌ی تایپ‌های seam.
 *
 * این فایل زیرمسیرِ `@hamboom/canvas-sync/transport` است و عمداً **بدونِ
 * `canvas-core`** — یعنی در Nodeِ خالص هم بارگذاری می‌شود. (barrelِ اصلی
 * نمی‌شود: `@hamboom/canvas-core` هنگام لودِ ماژول به `window` دست می‌زند —
 * یافته‌ی گام ۱٫۲.) پس سنجه‌ی زنده باید همه‌چیزِ لازمش را از همین‌جا بگیرد.
 */
export type { SyncTransport, TransportStatus } from "./transport.ts";
export { backoffCeilingMs, backoffDelayMs, RECONNECT_BACKOFF } from "./backoff.ts";
export type { BackoffOptions } from "./backoff.ts";

/**
 * ترابریِ WebSocketِ کلاینت — **گام ۵٫۱**.
 *
 * جای `LocalTransportHub`ِ فاز ۳ را می‌گیرد و همان `SyncTransport` است، پس
 * **هیچ خطی از binder عوض نمی‌شود** — قولی که [ADR-030](../../../ARCHITECTURE_DECISIONS.md#adr-030)
 * داده بود.
 *
 * ── ★★ سه کدِ بستن، سه رفتارِ متفاوت ([ADR-039](../../../ARCHITECTURE_DECISIONS.md#adr-039)) ──
 *
 * سرور نیمه‌ی خودش را در فاز ۴ تمام کرد و هر سه حالت را **از هم جدا** روی سیم
 * می‌فرستد. اگر کلاینت هر سه را یکسان ببیند، یا کاربر را در حلقه‌ی بی‌پایانِ
 * تلاش می‌اندازد یا بی‌دلیل منتظرش می‌گذارد:
 *
 * | کد | یعنی | کارِ اینجا |
 * |---|---|---|
 * | **۱۰۰۱** | خاموشیِ مودبانه‌ی نود (گام ۴٫۸) | **فوری** — نودِ دیگری آماده است و `/readyz`ِ این یکی از قبل قرمز شده |
 * | **۱۰۰۸** | ردِ احراز هویت/مجوز (گام ۴٫۱) | بسته به **کدِ `HB_ERROR`** — جدولِ `REACTIONS` |
 * | هر چیزِ دیگر (۱۰۰۶، خطای شبکه) | مرگِ ناگهانی | backoff **+ jitter** |
 *
 * ── ★★ چرا پیامِ خروجی در حالتِ قطع **بافر نمی‌شود** ──────────────────
 *
 * وسوسه‌اش زیاد است، ولی اشتباه است: Yjs یک CRDT است و اولین کاری که این
 * ترابری بعد از هر باز شدن انجام می‌دهد، **دست‌دادنِ کاملِ sync** است — که کلِ
 * حالت را می‌برد، نه تکه‌های گم‌شده را. بافر کردن یعنی حافظه‌ی بی‌کران برای
 * داده‌ای که همان لحظه تکراری می‌شود. پس پیامِ فرستاده‌شده روی سوکتِ بسته
 * **عمداً دور ریخته می‌شود** و شمرده می‌شود (`droppedWhileDown`).
 *
 * ⚠️ همین قاعده برای حضور و ephemeral هم درست است، و آنجا بدیهی‌تر: مکان‌نمای
 * ده‌ثانیه پیش برای هیچ‌کس ارزشی ندارد.
 *
 * ── ★★ دو قطعی که هرگز `close` نمی‌دهند (M5 گام ۹٫۱) ─────────────────────
 *
 * جدولِ بالا یک فرضِ پنهان دارد: **یک قابِ بستن می‌رسد**. روی شبکه‌ی ایران دو حالتِ
 * رایج دقیقاً همان‌هایی‌اند که هیچ قابی نمی‌رسد، و `rt:reconnect` هر دو را اندازه گرفت:
 *
 * | حالت | چه چیزی روی سیم است | پیش از این گام |
 * |---|---|---|
 * | **نشستِ نیم‌باز** — NATی که وسطِ کار می‌میرد، تعویضِ شبکه، DPI | TCP «باز»، صفر بایت | سرور در دو تیکِ heartbeat می‌بندد (ADR-006)؛ کلاینت **تا بی‌نهایت** `open` |
 * | **دست‌دادنِ معلق** — TCP وصل، upgrade بی‌جواب | همان، از قبل از `open` | **تا بی‌نهایت** `connecting` |
 *
 * مرورگر قابِ pingِ سرور را به JS نشان نمی‌دهد، پس نیمه‌ی کلاینت باید روی **پیامِ
 * سطحِ برنامه** بنشیند: سرور در هر تیکِ heartbeat یک `HB_ROOM_INFO` هم می‌فرستد
 * (`apps/realtime/src/room.ts`)، و این‌جا دو نگهبان هست — `connectTimeoutMs` (سوکتی که
 * باز نمی‌شود) و `silenceTimeoutMs` (سوکتِ بازی که هیچ پیامی نمی‌آورد). هر دو به همان
 * مسیرِ backoffِ جدولِ بالا می‌ریزند؛ چیزِ تازه‌ای در ماشینِ حالت نیست، فقط دو ماشه‌ی تازه.
 *
 * ⚠️ **جفت‌شدگی با سرور:** `silenceTimeoutMs` باید از **دو برابرِ** فاصله‌ی keepaliveِ
 * سرور (`RT_HEARTBEAT_INTERVAL_MS`، ۲۵s) بیشتر باشد، وگرنه یک keepaliveِ گم‌شده اتصالِ
 * سالم را می‌اندازد. پیش‌فرضِ ۷۵s سه برابر است — دو keepaliveِ پیاپی می‌توانند گم شوند.
 * `rt:reconnect` این نامساوی را روی هر دو طرف **assert** می‌کند، نه فقط این کامنت.
 */

// ─────────────────────────────────────────────────────────────
// مرزِ محیط — عمداً نه `lib.dom` و نه `@types/node`
// ─────────────────────────────────────────────────────────────

/**
 * حداقلی‌ترین چیزی که از یک WebSocket لازم داریم.
 *
 * ⚠️ **عمداً `WebSocket`ِ ambient نیست.** این فایل هم در مرورگر typecheck
 * می‌شود (که `lib.dom` دارد) و هم از `scripts/`ِ ریشه (که فقط `types: ["node"]`
 * دارد). یک تایپِ خودبسنده تنها چیزی است که هر دو را راضی می‌کند — و مزیتِ
 * دومش این است که تست بدونِ هیچ سوکتِ واقعی fake می‌سازد.
 */
export interface WebSocketLike {
  binaryType: string;
  send(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: (() => void) | null;
}

export interface TransportTimers {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const systemTimers: TransportTimers = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

interface SocketConstructor {
  new (url: string): WebSocketLike;
}

/**
 * سازنده‌ی پیش‌فرض — `WebSocket`ِ **سراسری**.
 *
 * در مرورگر همان چیزی است که انتظار می‌رود، و در Node ۲۴ هم وجود دارد (پس
 * سنجه‌ی زنده‌ی `rt:reconnect` همین ترابریِ محصولی را می‌راند، نه یک کلاینتِ
 * دست‌ساز). جای دیگری اگر نبود، پیامِ صریح بهتر از `undefined is not a
 * constructor` است.
 */
function globalSocket(url: string): WebSocketLike {
  const constructor = (globalThis as { WebSocket?: SocketConstructor }).WebSocket;
  if (!constructor) {
    throw new Error("‏[hamboom] WebSocketِ سراسری در این محیط نیست. گزینه‌ی createSocket را بده.");
  }
  return new constructor(url);
}

// ─────────────────────────────────────────────────────────────
// سیاستِ واکنش به بسته‌شدن
// ─────────────────────────────────────────────────────────────

/** بستنِ عادی — چیزی که خودمان در `disconnect` می‌فرستیم. */
const CLOSE_NORMAL = 1000;
/** خاموشیِ مودبانه‌ی نود (گام ۴٫۸). */
const CLOSE_GOING_AWAY = 1001;
/** ردِ سیاستی — احراز هویت یا مجوز (گام ۴٫۱). */
const CLOSE_POLICY = 1008;

/** چه کار کنیم بعد از بسته‌شدن. */
export type CloseReaction = "immediate" | "backoff" | "fatal";

/** مهلتِ باز شدنِ سوکت — M5 گام ۹٫۱. دست‌دادنی که ۱۰ ثانیه جواب نگرفته، نمی‌گیرد. */
export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
/**
 * نگهبانِ سکوت — M5 گام ۹٫۱. ★ **۳ × ۲۵s**: keepaliveِ سرور هر ۲۵ ثانیه می‌آید و دو
 * تای پیاپی می‌توانند گم شوند بی‌آنکه اتصالِ سالم بیفتد. اگر `RT_HEARTBEAT_INTERVAL_MS`
 * را بالا بردی، این را هم ببر — `rt:reconnect` نامساوی را می‌سنجد.
 */
export const DEFAULT_SILENCE_TIMEOUT_MS = 75_000;

/**
 * ★★ سقفِ تلاش‌های **فوریِ پیاپی** — بدونِ آن، «فوری» یک حلقه‌ی تنگ است.
 *
 * دو سناریوی واقعی هر دو به همین می‌رسند:
 *
 * - نودی که گیر کرده و به هر اتصال ۱۰۰۱ می‌دهد.
 * - ⚠️ **تامین‌کننده‌ی توکنی که توکنِ منقضی را کَش کرده.** آن‌وقت هر بار
 *   `TOKEN_EXPIRED` می‌گیریم، «فوری» تفسیرش می‌کنیم، و با **همان** توکن
 *   بلافاصله دوباره می‌کوبیم — تا ابد، با تمامِ توانِ CPU.
 *
 * پس بعد از این تعداد، «فوری» به backoff تنزل می‌کند. **fatal نمی‌شود**: یک
 * توکنِ تازه هنوز می‌تواند برسد و کاربر نباید برای همیشه بیرون بمانَد.
 */
const MAX_IMMEDIATE_RETRIES = 2;

/**
 * ★★ جدولِ واکنش — **از خودِ `HB_ERROR_CODES` می‌آید، نه از حدس.**
 *
 * آن ثابت در گام ۲٫۳ عمداً کدها را از هم جدا کرد چون «کارِ کلاینت در هرکدام
 * فرق می‌کند»، و کامنت‌های خودش این جدول را تقریباً کلمه‌به‌کلمه نوشته‌اند:
 * `SERVER_BUSY` صریحاً «موقتی، دوباره تلاش کن» است و `DOC_TOO_LARGE` صریحاً
 * «دائمی». پس اینجا فقط همان‌ها به کد ترجمه شده‌اند.
 */
const REACTIONS: Record<string, CloseReaction> = {
  /** توکن کهنه است — یک توکنِ تازه دقیقاً همین را رفع می‌کند. */
  [HB_ERROR_CODES.TOKEN_EXPIRED]: "immediate",
  /** سقفِ اتاقِ این نود پر است — **موقتی**، ولی هجوم بی‌فایده است. */
  [HB_ERROR_CODES.SERVER_BUSY]: "backoff",
  /** اتاق در حالِ تخلیه است — چند لحظه بعد دوباره بالا می‌آید. */
  [HB_ERROR_CODES.ROOM_CLOSED]: "backoff",
  /** «اصلاً وارد نشده‌ای» — تلاشِ دوباره با همان چیز، همان جواب. */
  [HB_ERROR_CODES.TOKEN_MISSING]: "fatal",
  /** امضا نخواند — رویدادِ امنیتی، نه خطای گذرا. */
  [HB_ERROR_CODES.TOKEN_INVALID]: "fatal",
  [HB_ERROR_CODES.FORBIDDEN]: "fatal",
  [HB_ERROR_CODES.DOC_TOO_LARGE]: "fatal",
  /** کاربر باید صفحه را رفرش کند (گام ۵٫۳ پیامش را می‌سازد). */
  [HB_ERROR_CODES.CLIENT_TOO_OLD]: "fatal",
};

/**
 * ★ **fail closed روی کدِ ناشناخته.**
 *
 * سرورِ جدیدتر می‌تواند کدی بفرستد که این کلاینت نمی‌شناسد. اگر «شاید گذرا
 * باشد» فرض کنیم، یک کلاینتِ قدیمی برای همیشه به سروری می‌کوبد که صریحاً ردش
 * کرده. سکوتِ محترمانه بهتر از حلقه است — همان قاعده‌ی `readRole` در
 * `protocol.ts`، یک لایه بالاتر.
 */
export function closeReaction(code: number, errorCode: string | null): CloseReaction {
  if (code === CLOSE_GOING_AWAY) return "immediate";
  if (code !== CLOSE_POLICY) return "backoff";
  if (!errorCode) return "fatal";
  return REACTIONS[errorCode] ?? "fatal";
}

// ─────────────────────────────────────────────────────────────
// ترابری
// ─────────────────────────────────────────────────────────────

export interface WebSocketTransportOptions {
  /**
   * نشانیِ اتاق **بدونِ توکن** — مثلاً `ws://localhost:3001/rt?board=<id>`.
   * توکن جداگانه و در لحظه‌ی هر تلاش اضافه می‌شود.
   */
  url: string;
  /**
   * ★★ توکن — برای **هر تلاش** دوباره صدا زده می‌شود، نه یک‌بار.
   *
   * ⚠️ این ریزه‌کاری نیست: توکنِ `rt` شصت‌ثانیه‌ای است و اتصالِ مجدد می‌تواند
   * دقایق بعد باشد. با یک توکنِ کَش‌شده، هر بازگشتِ کلاینت پس از یک قطعیِ
   * طولانی با `TOKEN_EXPIRED` رد می‌شود — یعنی دقیقاً همان حالتی که این گام
   * برای رفعش نوشته شده.
   */
  token: () => string | Promise<string>;
  backoff?: BackoffOptions;
  createSocket?: (url: string) => WebSocketLike;
  timers?: TransportTimers;
  /**
   * فاصله‌ی `HB_AUTH_REFRESH` روی اتصالِ **باز**. `۰` خاموشش می‌کند.
   *
   * پیش‌فرض ۴۵ ثانیه، چون توکن ۶۰ ثانیه‌ای است و پانزده ثانیه حاشیه برای
   * انحرافِ ساعت و رفت‌وبرگشت می‌مانَد.
   */
  authRefreshMs?: number;
  /**
   * ★★ مهلتِ اتصال (M5 گام ۹٫۱) — سوکتی که تا این مدت `open` نشده، انداخته می‌شود و
   * تلاشِ بعدی با backoff زمان‌بندی می‌شود. `۰` خاموشش می‌کند (فقط برای تست).
   *
   * اندازه‌گیری‌شده: بدونِ آن، دست‌دادنِ معلق (TCP وصل، upgrade بی‌جواب) کلاینت را
   * **تا بی‌نهایت** در `connecting` نگه می‌داشت.
   */
  connectTimeoutMs?: number;
  /**
   * ★★ نگهبانِ سکوت (M5 گام ۹٫۱) — سوکتِ بازی که این مدت **هیچ** پیامی نیاورده، مرده
   * فرض می‌شود: انداخته می‌شود و تلاشِ بعدی با backoff می‌آید. هر پیامِ ورودی تایمر را
   * از نو می‌شمارد. `۰` خاموشش می‌کند (فقط برای تست).
   *
   * ⚠️ باید > ۲ × فاصله‌ی keepaliveِ سرور باشد (پیش‌فرض ۳×). دلیلش در سرِ فایل.
   */
  silenceTimeoutMs?: number;
  /** ⚠️ P7 — هرگز توکن یا نشانیِ حاوی توکن به این نمی‌رود. */
  logger?: (message: string, fields?: Record<string, unknown>) => void;
}

export interface WebSocketTransport extends SyncTransport {
  connect(): Promise<void>;
  disconnect(): void;
  onStatus(handler: (status: TransportStatus) => void): () => void;
  /** وضعیتِ فعلی — برای تست و برای اتصالِ دیرهنگامِ شنونده. */
  readonly status: TransportStatus;
  /** شمارشِ پیام‌هایی که روی سوکتِ بسته دور ریخته شدند (نگاه کن به بالا). */
  readonly droppedWhileDown: number;
}

const OFFLINE_STATUS: TransportStatus = {
  phase: "stopped",
  reason: "offline",
  code: "NETWORK_OFFLINE",
  message: "شبکه‌ای در دسترس نیست.",
};

export function createWebSocketTransport(options: WebSocketTransportOptions): WebSocketTransport {
  const {
    url,
    token,
    backoff = RECONNECT_BACKOFF,
    createSocket = globalSocket,
    timers = systemTimers,
    authRefreshMs = 45_000,
    connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    silenceTimeoutMs = DEFAULT_SILENCE_TIMEOUT_MS,
    logger = () => undefined,
  } = options;

  const messageHandlers = new Set<(message: Uint8Array) => void>();
  const statusHandlers = new Set<(status: TransportStatus) => void>();

  let status: TransportStatus = { phase: "connecting", attempt: 1 };
  let socket: WebSocketLike | null = null;
  /**
   * ★ نسلِ تلاش — همان الگوی `epoch`ِ آداپتور.
   *
   * بینِ «توکن را بگیر» و «سوکت را بساز» یک `await` هست، و در آن فاصله
   * `disconnect` یا یک تلاشِ تازه ممکن است رسیده باشد. بدونِ این شمارنده،
   * سوکتِ رهاشده‌ی قبلی با `close`ِ دیرهنگامش یک زمان‌بندیِ دومِ اتصال راه
   * می‌انداخت — دو حلقه‌ی موازی که هیچ‌کدام نمی‌داند دیگری هست.
   */
  let generation = 0;
  /**
   * تعدادِ تلاشِ **ناموفقِ پیاپی** در سریِ فعلی — با هر باز شدنِ موفق صفر می‌شود.
   *
   * پس `connecting` شماره‌ی تلاشِ **جاری** را می‌گوید (`attempt + 1`) و
   * `retrying` شماره‌ی تلاشی که **شکست خورد**. صفر شدنش بعد از موفقیت لازم است:
   * یک قطعیِ تکی پس از دو ساعت کار نباید از فاصله‌ی سی‌ثانیه‌ای شروع کند.
   */
  let attempt = 0;
  /** تلاش‌های **فوریِ** پیاپیِ بدونِ موفقیت — سقفش `MAX_IMMEDIATE_RETRIES`. */
  let immediateRuns = 0;
  let started = false;
  let retryTimer: unknown = null;
  let refreshTimer: unknown = null;
  /** مهلتِ اتصال — از ساختِ سوکت تا `open` (گام ۹٫۱). */
  let connectTimer: unknown = null;
  /** نگهبانِ سکوت — از `open`، و از هر پیامِ ورودی، از نو (گام ۹٫۱). */
  let silenceTimer: unknown = null;
  /** آخرین `HB_ERROR`ِ رسیده — برای پیامِ فارسی هنگام بسته‌شدن. */
  let lastError: { code: string; message: string } | null = null;
  let droppedWhileDown = 0;

  function publish(next: TransportStatus): void {
    status = next;
    for (const handler of statusHandlers) handler(next);
  }

  function clearTimer(handle: unknown): null {
    if (handle !== null) timers.clearTimeout(handle);
    return null;
  }

  /** بستنِ سوکتِ فعلی **بدونِ** راه‌انداختنِ منطقِ اتصالِ مجدد. */
  function dropSocket(code: number): void {
    const current = socket;
    socket = null;
    refreshTimer = clearTimer(refreshTimer);
    connectTimer = clearTimer(connectTimer);
    silenceTimer = clearTimer(silenceTimer);
    if (!current) return;
    // ★ اول شنونده‌ها را برمی‌داریم: `close` روی سوکتی که خودمان انداختیم
    //   نباید مثلِ یک قطعیِ واقعی رفتار کند.
    current.onopen = null;
    current.onmessage = null;
    current.onclose = null;
    current.onerror = null;
    try {
      current.close(code);
    } catch {
      // سوکتی که هنوز باز نشده `close` را رد می‌کند؛ خودش بعداً می‌میرد.
    }
  }

  function isBrowserOffline(): boolean {
    const nav = (globalThis as { navigator?: { onLine?: unknown } }).navigator;
    // ⚠️ فقط جهتِ **منفی** قابلِ اتکاست: `false` یعنی قطعاً شبکه نیست، ولی
    //    `true` هیچ چیزی درباره‌ی رسیدن به سرور نمی‌گوید.
    return typeof nav?.onLine === "boolean" && !nav.onLine;
  }

  function scheduleRetry(reaction: Exclude<CloseReaction, "fatal">): void {
    if (isBrowserOffline()) {
      publish(OFFLINE_STATUS);
      return;
    }

    // ★ ۱۰۰۱ یعنی «نودِ دیگری آماده است» — صبر کردن فقط قطعیِ بی‌دلیل است.
    //   ولی نه بی‌نهایت بار؛ چرایی‌اش بالای `MAX_IMMEDIATE_RETRIES`.
    const rush = reaction === "immediate" && immediateRuns < MAX_IMMEDIATE_RETRIES;
    // ⚠️ **فقط با یک اتصالِ موفق صفر می‌شود، نه اینجا.** نسخه‌ی اول در همین
    //    شاخه صفرش می‌کرد و نتیجه‌اش ۰، ۰، backoff، ۰، ۰، backoff بود — یعنی
    //    دو تلاش از هر سه هنوز بی‌فاصله. تست گرفتش.
    if (rush) immediateRuns += 1;

    attempt += 1;
    const delay = rush ? 0 : backoffDelayMs(attempt, backoff);
    publish({ phase: "retrying", attempt, nextRetryMs: delay });
    retryTimer = timers.setTimeout(() => {
      retryTimer = null;
      void openSocket();
    }, delay);
  }

  function scheduleAuthRefresh(): void {
    if (authRefreshMs <= 0) return;
    refreshTimer = timers.setTimeout(() => {
      refreshTimer = null;
      void (async () => {
        const mine = generation;
        const fresh = await token();
        // بینِ درخواست و رسیدنِ توکن ممکن است اتصال عوض شده باشد.
        if (mine !== generation || !socket) return;
        socket.send(encodeMessage({ type: MSG_TYPES.HB_AUTH_REFRESH, token: fresh }));
        scheduleAuthRefresh();
      })().catch((cause: unknown) => {
        // ⚠️ شکستِ تازه‌سازی اتصال را نمی‌بندد: نشستِ فعلی از قبل معتبر است و
        //    سرور وسطِ کار انقضا را دوباره نمی‌سنجد. کشتنِ آن یعنی یک تپقِ
        //    گذرای سرویسِ احراز هویت همه را بیرون بیندازد.
        logger("تازه‌سازیِ توکن نشد", { error: String(cause) });
      });
    }, authRefreshMs);
  }

  function handleClose(mine: number, code: number, reason: string): void {
    if (mine !== generation) return;
    socket = null;
    refreshTimer = clearTimer(refreshTimer);
    connectTimer = clearTimer(connectTimer);
    silenceTimer = clearTimer(silenceTimer);

    // ★ کدِ خطا از **دو** جا: `denyConnection`ِ سرور آن را در `reason`ِ قابِ
    //   بستن می‌گذارد، و همان لحظه یک `HB_ERROR` هم می‌فرستد. اولی کوتاه‌تر و
    //   مطمئن‌تر است ولی می‌تواند در مسیر گم شود؛ دومی پیامِ فارسی را هم دارد.
    const errorCode = reason || lastError?.code || null;
    const reaction = closeReaction(code, errorCode);
    logger("اتصال بسته شد", { code, errorCode, reaction, attempt });

    if (reaction === "fatal") {
      publish({
        phase: "stopped",
        reason: "fatal",
        code: errorCode ?? String(code),
        message: lastError?.message ?? "سرور اتصال را نپذیرفت.",
      });
      return;
    }

    scheduleRetry(reaction);
  }

  /**
   * ★★ نگهبانِ سکوت (گام ۹٫۱) — از `open` و از هر پیامِ ورودی از نو.
   *
   * ⚠️ «مرده فرض شد» یعنی همان مسیرِ قطعیِ ناگهانی: سوکت انداخته می‌شود (بدونِ
   * دست‌دادنِ بستن — روی مسیرِ مرده تا timeout معلق می‌مانَد) و backoff شروع می‌شود.
   * `attempt` بعد از هر `open`ِ موفق صفر شده، پس اولین تلاش با فاصله‌ی پایه می‌آید.
   */
  function armSilence(mine: number): void {
    if (silenceTimeoutMs <= 0) return;
    silenceTimer = clearTimer(silenceTimer);
    silenceTimer = timers.setTimeout(() => {
      silenceTimer = null;
      if (mine !== generation || !socket) return;
      logger("اتصال مرده فرض شد", { reason: "silence", silenceTimeoutMs, attempt });
      dropSocket(CLOSE_NORMAL);
      scheduleRetry("backoff");
    }, silenceTimeoutMs);
  }

  /** ★★ مهلتِ اتصال (گام ۹٫۱) — از ساختِ سوکت تا `open`. */
  function armConnectTimeout(mine: number): void {
    if (connectTimeoutMs <= 0) return;
    connectTimer = clearTimer(connectTimer);
    connectTimer = timers.setTimeout(() => {
      connectTimer = null;
      if (mine !== generation || !socket) return;
      logger("مهلتِ اتصال تمام شد", { reason: "connect-timeout", connectTimeoutMs, attempt });
      dropSocket(CLOSE_NORMAL);
      scheduleRetry("backoff");
    }, connectTimeoutMs);
  }

  async function openSocket(): Promise<void> {
    const mine = ++generation;
    publish({ phase: "connecting", attempt: attempt + 1 });

    let target: string;
    try {
      const fresh = await token();
      if (mine !== generation) return;
      const separator = url.includes("?") ? "&" : "?";
      target = `${url}${separator}token=${encodeURIComponent(fresh)}`;
    } catch (cause) {
      // نگرفتنِ توکن یک قطعیِ گذرا است، نه ردِ سرور — پس backoff، نه fatal.
      logger("توکن گرفته نشد", { error: String(cause) });
      if (mine === generation) scheduleRetry("backoff");
      return;
    }

    let next: WebSocketLike;
    try {
      next = createSocket(target);
    } catch (cause) {
      logger("سوکت ساخته نشد", { error: String(cause) });
      if (mine === generation) scheduleRetry("backoff");
      return;
    }

    // ⚠️ بدونِ این، مرورگر داده‌ی باینری را `Blob` تحویل می‌دهد و هر پیام یک
    //    خواندنِ **ناهمگام** لازم دارد — یعنی ترتیبِ پیام‌ها تضمین نمی‌شود.
    next.binaryType = "arraybuffer";
    socket = next;
    lastError = null;
    armConnectTimeout(mine);

    next.onopen = () => {
      if (mine !== generation) return;
      connectTimer = clearTimer(connectTimer);
      const resumed = started;
      started = true;
      attempt = 0;
      immediateRuns = 0;
      publish({ phase: "open", resumed });
      scheduleAuthRefresh();
      armSilence(mine);
    };

    next.onmessage = (event) => {
      if (mine !== generation) return;
      // ★ هر پیامِ ورودی یعنی مسیر زنده است — پیش از decode، تا پیامِ ناشناخته هم بشمارد.
      armSilence(mine);
      const bytes = toBytes(event.data);
      if (!bytes) return;
      rememberError(bytes);
      for (const handler of messageHandlers) handler(bytes);
    };

    next.onclose = (event) => {
      handleClose(mine, event.code, event.reason);
    };

    next.onerror = () => {
      // ⚠️ `error` همیشه یک `close` هم به دنبال دارد، پس اینجا فقط لاگ است.
      //    واکنش در `onclose` جمع شده تا دو مسیرِ موازی نداشته باشیم.
      logger("خطای سوکت", { attempt });
    };
  }

  /**
   * ★ نگه‌داشتنِ آخرین `HB_ERROR` — با یک بررسیِ **تک‌بایتی**، نه decodeِ کامل.
   *
   * هر پیامِ رسیده از این مسیر رد می‌شود (مسیرِ داغِ همه‌ی updateها)، پس decode
   * کردنِ همه‌شان فقط برای پیدا کردنِ یک خطا هدررفت است. `0x14` کمتر از ۱۲۸
   * است، پس `varUint`ش دقیقاً یک بایت است و مقایسه‌ی اولین بایت **معادلِ**
   * خواندنِ نوع است.
   */
  function rememberError(bytes: Uint8Array): void {
    if (bytes[0] !== MSG_TYPES.HB_ERROR) return;
    const message = decodeMessage(bytes);
    if (message?.type !== MSG_TYPES.HB_ERROR) return;
    lastError = { code: message.code, message: message.message };
  }

  function onNetworkOffline(): void {
    if (!started && status.phase === "connecting") return;
    retryTimer = clearTimer(retryTimer);
    dropSocket(CLOSE_NORMAL);
    publish(OFFLINE_STATUS);
  }

  function onNetworkOnline(): void {
    if (status.phase !== "stopped" || status.reason !== "offline") return;
    attempt = 0;
    void openSocket();
  }

  /**
   * ★ رویدادهای شبکه‌ی مرورگر — تنها جایی که حالتِ `offline` از آن می‌آید.
   *
   * در Node وجود ندارند و این عمدی است: آنجا `navigator.onLine` هم نیست، پس
   * سنجه‌ی زنده هرگز به این حالت نمی‌رسد و نگهبانش یک تستِ واحد با محیطِ
   * ساختگی است. ادعای بیشتر از این، ادعای آزموده‌نشده بود.
   */
  function wireNetworkEvents(): () => void {
    const target = globalThis as {
      addEventListener?: (type: string, handler: () => void) => void;
      removeEventListener?: (type: string, handler: () => void) => void;
    };
    if (!target.addEventListener || !target.removeEventListener) return () => undefined;
    target.addEventListener("offline", onNetworkOffline);
    target.addEventListener("online", onNetworkOnline);
    return () => {
      target.removeEventListener?.("offline", onNetworkOffline);
      target.removeEventListener?.("online", onNetworkOnline);
    };
  }

  let unwireNetwork: (() => void) | null = null;

  return {
    get status() {
      return status;
    },

    get droppedWhileDown() {
      return droppedWhileDown;
    },

    /**
     * ⚠️ **منتظرِ باز شدنِ سوکت نمی‌مانَد، و این عمدی است.**
     *
     * اگر منتظر می‌مانْد، بازکردنِ یک بورد در لحظه‌ای که سرور بالا نیست به یک
     * `throw` تبدیل می‌شد و بوم اصلاً mount نمی‌شد — در حالی که کارِ درست نشان
     * دادنِ «در حالِ اتصالِ مجدد» است. آداپتور دست‌دادن را روی رویدادِ `open`
     * می‌زند، نه اینجا.
     */
    connect() {
      unwireNetwork ??= wireNetworkEvents();
      attempt = 0;
      if (isBrowserOffline()) {
        publish(OFFLINE_STATUS);
        return Promise.resolve();
      }
      void openSocket();
      return Promise.resolve();
    },

    disconnect() {
      generation++;
      retryTimer = clearTimer(retryTimer);
      dropSocket(CLOSE_NORMAL);
      unwireNetwork?.();
      unwireNetwork = null;
      started = false;
      messageHandlers.clear();
      statusHandlers.clear();
    },

    send(message) {
      if (!socket || status.phase !== "open") {
        droppedWhileDown++;
        return;
      }
      socket.send(message);
    },

    onMessage(handler) {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },

    onStatus(handler) {
      statusHandlers.add(handler);
      return () => statusHandlers.delete(handler);
    },
  };
}

/**
 * داده‌ی رسیده → بایت.
 *
 * مرورگر با `binaryType = "arraybuffer"` یک `ArrayBuffer` می‌دهد؛ بعضی
 * پیاده‌سازی‌ها مستقیم `Uint8Array`. رشته یعنی کسی متن فرستاده که پروتکلِ ما
 * نیست — بی‌صدا دور ریخته می‌شود، مثلِ نوعِ پیامِ ناشناخته.
 */
function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return null;
}
