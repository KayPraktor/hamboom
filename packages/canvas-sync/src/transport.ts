/**
 * seamِ ترابری — [ADR-030](../../../ARCHITECTURE_DECISIONS.md#adr-030).
 *
 * آداپتور فقط این interface را می‌شناسد، نه `ws` را. دو دلیل:
 *
 * ۱. **فاز ۳ بدونِ شبکه آزموده می‌شود.** دو `Y.Doc` مستقیم به هم وصل می‌شوند و
 *    هر باگِ binder همان‌جا دیده می‌شود، نه پشتِ لایه‌ی شبکه. همان درسِ M1 که
 *    آداپتورِ لوکال قبل از هر شبکه‌ای ساخته شد.
 * ۲. **ADR-030 عبور از `ws` را به یک عددِ بنچمارک گره زده** (گام ۶٫۳). ترابری که
 *    پشتِ یک seam باشد بدونِ بازنویسیِ binder عوض می‌شود.
 *
 * ⚠️ بایت‌هایی که از اینجا رد می‌شوند **پیامِ قاب‌بندی‌شده‌ی گام ۲٫۴** اند
 * (`encodeMessage`)، نه updateِ خام. ترابری خودش هیچ‌وقت بازشان نمی‌کند — همان
 * قاب در فاز ۴ روی WebSocket هم می‌رود، پس آداپتور عوض نمی‌شود.
 */

/**
 * ★★ وضعیتِ ترابری — ورودیِ `ConnectionState`ِ قراردادِ M1 (گام ۵٫۱).
 *
 * ⚠️ **این همان `ConnectionState` نیست، و عمداً.** ترابری از `pendingChanges`
 * چیزی نمی‌داند (آن را آداپتور می‌شمارد) و از `peers` هم نه (آن از کانالِ حضور
 * می‌آید). اینجا فقط چیزی است که **خودِ سوکت** می‌داند. نگاشتش به پنج حالتِ
 * قرارداد در [`adapter.ts`](./adapter.ts) است — یک‌جا، نه پخش‌شده.
 */
export type TransportStatus =
  /** در حالِ تلاش. `attempt` از ۱ شروع می‌شود. */
  | { phase: "connecting"; attempt: number }
  /**
   * سوکت باز است.
   *
   * ★ `resumed` یعنی این **اتصالِ دوباره** است، نه اولی — و برای آداپتور یعنی
   * «دست‌دادنِ sync را از نو بزن». سرور هیچ حافظه‌ای از نشستِ قبلی ندارد.
   */
  | { phase: "open"; resumed: boolean }
  /** قطع شد و تلاشِ بعدی زمان‌بندی شده. `nextRetryMs` **اندازه‌گیری‌پذیر** است. */
  | { phase: "retrying"; attempt: number; nextRetryMs: number }
  /**
   * تلاش **متوقف** شد.
   *
   * - `fatal` — سرور ما را رد کرد (کدِ ۱۰۰۸). تلاشِ دوباره فقط حلقه می‌سازد.
   * - `offline` — خودِ مرورگر می‌گوید شبکه نیست. تلاش بی‌فایده است تا `online`.
   */
  | { phase: "stopped"; reason: "fatal" | "offline"; code: string; message: string };

export interface SyncTransport {
  /** فرستادنِ یک پیامِ قاب‌بندی‌شده به بقیه. */
  send(message: Uint8Array): void;
  /** ثبتِ گیرنده. **تابعِ لغو برمی‌گرداند** — بدونش هر reconnect یک نشتی است. */
  onMessage(handler: (message: Uint8Array) => void): () => void;
  /**
   * اختیاری: گزارشِ وضعیت (گام ۵٫۱).
   *
   * ★ **نبودنش یعنی «من هیچ‌وقت قطع نمی‌شوم»** — دقیقاً حالتِ `LocalTransport`.
   * آداپتور در آن حالت مثلِ فاز ۳ رفتار می‌کند: یک‌بار دست می‌دهد و تمام.
   */
  onStatus?(handler: (status: TransportStatus) => void): () => void;
  /** اختیاری: برقراری و قطعِ اتصال (فاز ۴). */
  connect?(): Promise<void>;
  disconnect?(): void;
}

/**
 * ترابریِ درون‌حافظه‌ای — **جای سرور را در فاز ۳ می‌گیرد.**
 *
 * معادلِ `LocalSyncHub`ِ M1، یک لایه پایین‌تر: آنجا `ElementChangeSet` پخش می‌شد،
 * اینجا updateِ خامِ Yjs. یعنی همان مسیرِ واقعیِ CRDT آزموده می‌شود، نه یک
 * میان‌بُر.
 */
export class LocalTransportHub {
  private readonly members = new Set<LocalTransport>();

  join(member: LocalTransport): void {
    this.members.add(member);
  }

  leave(member: LocalTransport): void {
    this.members.delete(member);
  }

  /** پخش به همه **جز فرستنده** — فرستنده update را از قبل روی سندِ خودش دارد. */
  publish(from: LocalTransport, update: Uint8Array): void {
    for (const member of this.members) {
      if (member !== from) member.receive(update);
    }
  }

  get size(): number {
    return this.members.size;
  }
}

/** یک سرِ `LocalTransportHub`. */
export class LocalTransport implements SyncTransport {
  private readonly handlers = new Set<(update: Uint8Array) => void>();

  constructor(private readonly hub: LocalTransportHub) {
    hub.join(this);
  }

  /**
   * پیوستنِ دوباره به hub.
   *
   * ⚠️ **لازم است، نه تشریفاتی:** `disconnect` عضویت را برمی‌دارد، پس بدونِ این،
   * یک `connect` بعد از `disconnect` روی همان آداپتور **مرده** می‌مانَد — و
   * StrictMode دقیقاً همین چرخه را می‌سازد. در گام ۳٫۲ یک تست همین را گرفت.
   * ترابریِ واقعیِ فاز ۴ هم دقیقاً همین کار را می‌کند (اتصالِ دوباره‌ی WebSocket).
   */
  connect(): Promise<void> {
    this.hub.join(this);
    return Promise.resolve();
  }

  send(message: Uint8Array): void {
    this.hub.publish(this, message);
  }

  onMessage(handler: (message: Uint8Array) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  disconnect(): void {
    this.hub.leave(this);
    this.handlers.clear();
  }

  /** فراخوانیِ داخلی توسط hub. */
  receive(message: Uint8Array): void {
    for (const handler of this.handlers) handler(message);
  }
}
