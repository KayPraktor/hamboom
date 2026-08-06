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

export interface SyncTransport {
  /** فرستادنِ یک پیامِ قاب‌بندی‌شده به بقیه. */
  send(message: Uint8Array): void;
  /** ثبتِ گیرنده. **تابعِ لغو برمی‌گرداند** — بدونش هر reconnect یک نشتی است. */
  onMessage(handler: (message: Uint8Array) => void): () => void;
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

  send(update: Uint8Array): void {
    this.hub.publish(this, update);
  }

  onMessage(handler: (update: Uint8Array) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  disconnect(): void {
    this.hub.leave(this);
    this.handlers.clear();
  }

  /** فراخوانیِ داخلی توسط hub. */
  receive(update: Uint8Array): void {
    for (const handler of this.handlers) handler(update);
  }
}
