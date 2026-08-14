import type { CanvasInbound, ElementChangeSet } from "@hamboom/canvas-core/sync";
import type { HbElement } from "@hamboom/shared-types";

import type { SyncTransport } from "./transport.ts";

/**
 * داربستِ مشترکِ تست‌های **تعارض و همگرایی** (گام ۶٫۲).
 *
 * ⚠️ **این فایل صادر نمی‌شود و از مخرجِ پوشش هم بیرون است** (`vitest.config.ts`).
 * داربستِ تست که در پوشش شمرده شود عدد را بالا می‌برد بدونِ اینکه یک خطِ محصولی
 * بیشتر آزموده شده باشد — دقیقاً همان «پوشش را با تستِ بی‌ادعا بالا نبر».
 *
 * ── چرا `LocalTransportHub` کافی نبود ─────────────────────────────────
 *
 * آن hub **همزمان** پخش می‌کند: تا کاربر A چیزی بنویسد، B همان لحظه دیده است.
 * پس با آن اصلاً نمی‌شود «همزمان» ساخت — هر تعارضی در عمل به یک ترتیبِ سریالی
 * تبدیل می‌شود و تستِ تعارض **بی‌معنا** می‌شود. اینجا هر سر یک صندوقِ ورودی دارد
 * که می‌شود نگهش داشت (`hold`)، بعد با **ترتیبِ دلخواه** تخلیه‌اش کرد
 * (`release`) — یعنی هم پارتیشنِ واقعی، هم ترتیبِ رسیدنِ متفاوت برای هر کلاینت.
 */

/** یک پیامِ نگه‌داشته‌شده. `seq` ترتیبِ **تولید** است، نه ترتیبِ تحویل. */
export interface HeldMessage {
  readonly seq: number;
  readonly bytes: Uint8Array;
}

export class PartitionHub {
  private readonly members = new Set<QueuedTransport>();
  private nextSeq = 0;

  join(member: QueuedTransport): void {
    this.members.add(member);
  }

  leave(member: QueuedTransport): void {
    this.members.delete(member);
  }

  /** پخش به همه **جز فرستنده** — فرستنده update را روی سندِ خودش دارد. */
  publish(from: QueuedTransport, bytes: Uint8Array): void {
    const seq = this.nextSeq++;
    for (const member of this.members) {
      if (member !== from) member.enqueue({ seq, bytes });
    }
  }
}

/** یک سرِ `PartitionHub` که می‌تواند صندوقِ ورودی‌اش را نگه دارد. */
export class QueuedTransport implements SyncTransport {
  private readonly handlers = new Set<(message: Uint8Array) => void>();
  private readonly queue: HeldMessage[] = [];
  private holding = false;

  constructor(private readonly hub: PartitionHub) {
    hub.join(this);
  }

  /** از این لحظه هرچه برسد در صف می‌مانَد — شبیه‌سازیِ پارتیشنِ شبکه. */
  hold(): void {
    this.holding = true;
  }

  /**
   * تخلیه‌ی صف با ترتیبِ دلخواه، و برگرداندنِ **ترتیبی که واقعاً تحویل شد**.
   *
   * ★ خروجی عمداً برگردانده می‌شود: تستِ همگرایی باید بتواند **ثابت کند** که
   * ترتیب‌ها واقعاً فرق داشتند. یک تستِ property-based که همه‌ی کلاینت‌ها را با
   * یک ترتیب تغذیه کند، همگراییِ بی‌معنا اثبات می‌کند.
   */
  release(permute?: (queued: readonly HeldMessage[]) => HeldMessage[]): number[] {
    const ordered = permute ? permute(this.queue) : [...this.queue];
    this.queue.length = 0;
    this.holding = false;
    for (const message of ordered) this.deliver(message.bytes);
    return ordered.map((message) => message.seq);
  }

  /** دور ریختنِ صف — **کنترلِ منفیِ** تستِ همگرایی. */
  drop(): number[] {
    const dropped = this.queue.map((message) => message.seq);
    this.queue.length = 0;
    this.holding = false;
    return dropped;
  }

  get pending(): number {
    return this.queue.length;
  }

  // ── SyncTransport ──────────────────────────────────────────────

  send(message: Uint8Array): void {
    this.hub.publish(this, message);
  }

  onMessage(handler: (message: Uint8Array) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  connect(): Promise<void> {
    this.hub.join(this);
    return Promise.resolve();
  }

  disconnect(): void {
    this.hub.leave(this);
    this.handlers.clear();
  }

  /** فراخوانیِ داخلی توسطِ hub. */
  enqueue(message: HeldMessage): void {
    if (this.holding) this.queue.push(message);
    else this.deliver(message.bytes);
  }

  private deliver(bytes: Uint8Array): void {
    for (const handler of this.handlers) handler(bytes);
  }
}

/** بومِ ساختگی — هرچه گرفت را ثبت می‌کند، بدونِ وابستگی به vitest. */
export interface RecordingCanvas {
  readonly inbound: CanvasInbound;
  readonly remote: ElementChangeSet[];
  readonly documents: unknown[];
  /** همه‌ی شناسه‌هایی که تا الان به‌عنوانِ حذف‌شده رسیده‌اند. */
  deletedIds(): string[];
}

export function recordingCanvas(): RecordingCanvas {
  const remote: ElementChangeSet[] = [];
  const documents: unknown[] = [];
  const inbound: CanvasInbound = {
    applyRemoteChanges: (changes) => remote.push(changes),
    applyPeers: () => {},
    setConnectionState: () => {},
    setSaveState: () => {},
    setPermissions: () => {},
    replaceDocument: (document) => documents.push(document),
    focusOn: () => {},
  };
  return {
    inbound,
    remote,
    documents,
    deletedIds: () => remote.flatMap((changes) => changes.deleted),
  };
}

/**
 * یک عنصرِ معتبر — همان نمونه‌ای که `adapter.test.ts` می‌سازد.
 *
 * ⚠️ `hbElement.parse` روی مسیرِ نوشتن اجرا می‌شود، پس نمونه‌ی ناقص با `ZodError`
 * می‌افتد و علتش هیچ ربطی به تعارض ندارد.
 */
export function element(id: string, overrides: Partial<HbElement> = {}): HbElement {
  return {
    id,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    angle: 0,
    index: "a1",
    frameId: null,
    groupIds: [],
    locked: false,
    strokeColor: "#1a1a1a",
    backgroundColor: "#FFF9B1",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    updated: 0,
    isDeleted: false,
    boundElements: null,
    link: null,
    customData: {
      hb: {
        schema: 1,
        kind: "sticky",
        createdBy: "u_test",
        lastEditedBy: "u_test",
        createdAt: 0,
      },
    },
    ...overrides,
  } as HbElement;
}

/**
 * یک عنصرِ متنی — برای سناریوی تایپِ همزمان.
 *
 * ⚠️ `text` عمداً برابرِ `originalText` گذاشته می‌شود، ولی **ادعای تست فقط روی
 * `originalText` است** ([ADR-034](../../../ARCHITECTURE_DECISIONS.md#adr-034)):
 * `text` مشتق است و تا وقتی `apply-remote` بازمحاسبه‌اش نکرده، بعد از ادغام
 * غلط است.
 */
export function textElement(id: string, originalText: string): HbElement {
  return element(id, {
    type: "text",
    originalText,
    text: originalText,
    fontSize: 20,
    fontFamily: 1,
    textAlign: "right",
    verticalAlign: "top",
    containerId: null,
    lineHeight: 1.6,
    direction: "rtl",
    autoResize: true,
    customData: {
      hb: {
        schema: 1,
        kind: "text",
        createdBy: "u_test",
        lastEditedBy: "u_test",
        createdAt: 0,
      },
    },
  } as Partial<HbElement>);
}

/**
 * PRNGِ قطعی — `Math.random` اینجا سم است.
 *
 * تستِ property-based که با هر اجرا داده‌ی دیگری بسازد، هنگام قرمز شدن
 * **بازتولیدپذیر نیست**؛ و بدتر، یک شکستِ نادر بی‌صدا رد می‌شود. seed در نامِ
 * تست می‌آید تا هر شکستی یک دستورِ اجرای مشخص داشته باشد.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** جابه‌جاییِ Fisher–Yates با PRNGِ داده‌شده. */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/**
 * صبر تا اجرای تایمرهای صفرثانیه‌ای.
 *
 * ⚠️ `await Promise.resolve()` کافی **نیست** — صفِ microtask را خالی می‌کند ولی
 * `setTimeout(fn, 0)`ِ زمان‌بندِ محلی یک macrotask است. همان تله‌ای که در تستِ
 * گام ۵٫۲ یک ادعا را بی‌اثر کرده بود.
 */
export function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
