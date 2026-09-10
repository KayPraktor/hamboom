import { encodeMessage, HB_ERROR_CODES, MSG_TYPES } from "@hamboom/ydoc-schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { backoffCeilingMs } from "./backoff.ts";
import type { TransportStatus } from "./transport.ts";
import {
  closeReaction,
  createWebSocketTransport,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_SILENCE_TIMEOUT_MS,
  type WebSocketLike,
  type WebSocketTransportOptions,
} from "./websocket-transport.ts";

/**
 * تست‌های گام ۵٫۱ — ماشینِ حالتِ اتصالِ مجدد.
 *
 * ⚠️ **زمان‌سنج و سوکت هر دو تزریق می‌شوند، `vi.useFakeTimers` نه.** درسِ گام
 * ۳٫۵: زمان‌بندِ ساختگی به هر ساعتی نمی‌رسد (`lib0/time` مقدارِ `Date.now` را در
 * لحظه‌ی لودِ ماژول می‌گیرد). تزریق ابهام ندارد — و مزیتِ دومش این است که همین
 * تست‌ها ادعا می‌کنند «چه چیزی زمان‌بندی شد»، نه «چقدر گذشت».
 *
 * ★ ادعاهای **رفتارِ روی سیم** (کدِ ۱۰۰۱ واقعی، بازگشتِ بعد از قطعیِ واقعی،
 * فاصله‌های اندازه‌گیری‌شده) کارِ `pnpm rt:reconnect` است، نه اینجا.
 */

class FakeSocket implements WebSocketLike {
  binaryType = "blob";
  readonly sent: Uint8Array[] = [];
  closedWith: number | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {}

  send(data: Uint8Array): void {
    this.sent.push(data);
  }

  close(code?: number): void {
    this.closedWith = code ?? 1000;
  }

  // ── چیزهایی که «سرور» انجام می‌دهد ─────────────────────────────
  open(): void {
    this.onopen?.();
  }

  serverClose(code: number, reason = ""): void {
    this.onclose?.({ code, reason });
  }

  deliver(bytes: Uint8Array): void {
    this.onmessage?.({ data: bytes });
  }

  get token(): string {
    return new URL(this.url, "ws://x").searchParams.get("token") ?? "";
  }
}

function fakeClock() {
  const pending = new Map<number, { run: () => void; ms: number }>();
  let nextId = 1;
  return {
    timers: {
      setTimeout: (run: () => void, ms: number): unknown => {
        const id = nextId++;
        pending.set(id, { run, ms });
        return id;
      },
      clearTimeout: (handle: unknown): void => {
        pending.delete(handle as number);
      },
    },
    delays: (): number[] => [...pending.values()].map((entry) => entry.ms),
    /** شناسه‌ی تایمرهای در انتظار — «از نو زمان‌بندی شد» فقط با این اثبات‌پذیر است. */
    ids: (): number[] => [...pending.keys()],
    size: (): number => pending.size,
    /** همه‌ی زمان‌سنج‌های در انتظار را اجرا می‌کند (هر کدام یک‌بار). */
    fire(): void {
      const jobs = [...pending.values()];
      pending.clear();
      for (const job of jobs) job.run();
    },
  };
}

/** یک microtask تا `await token()`ِ داخلِ ترابری تمام شود. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function harness(overrides: Partial<WebSocketTransportOptions> = {}) {
  const sockets: FakeSocket[] = [];
  const statuses: TransportStatus[] = [];
  const clock = fakeClock();
  let issued = 0;

  const transport = createWebSocketTransport({
    url: "ws://board.test/rt?board=b1",
    token: () => `token-${String(++issued)}`,
    timers: clock.timers,
    // ⚠️ خاموش، مگر تستی صریحاً بخواهدش — وگرنه `fire()` تازه‌سازیِ توکن را هم
    //    راه می‌اندازد و هر ادعای «چند زمان‌سنج در انتظار است» بی‌معنا می‌شود.
    authRefreshMs: 0,
    // ⚠️ همین دلیل برای دو نگهبانِ گام ۹٫۱: `fire()` همه‌ی تایمرها را می‌زند و مهلتِ
    //    اتصال هر سوکتِ هنوز-باز-نشده را می‌انداخت. تست‌های خودشان روشنشان می‌کنند.
    connectTimeoutMs: 0,
    silenceTimeoutMs: 0,
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    ...overrides,
  });

  transport.onStatus((status) => statuses.push(status));

  return {
    transport,
    sockets,
    statuses,
    clock,
    last: (): FakeSocket => {
      const socket = sockets.at(-1);
      if (!socket) throw new Error("هیچ سوکتی ساخته نشد");
      return socket;
    },
    phases: (): string[] => statuses.map((status) => status.phase),
  };
}

describe("closeReaction — جدولِ سیاست", () => {
  it("۱۰۰۱ یعنی فوری: نودِ دیگری آماده است", () => {
    expect(closeReaction(1001, null)).toBe("immediate");
  });

  it("قطعِ ناگهانی یعنی backoff", () => {
    expect(closeReaction(1006, null)).toBe("backoff");
    expect(closeReaction(1011, null)).toBe("backoff");
    expect(closeReaction(1000, null)).toBe("backoff");
  });

  it("۱۰۰۸ به کدِ خطا نگاه می‌کند، نه به خودش", () => {
    expect(closeReaction(1008, HB_ERROR_CODES.TOKEN_EXPIRED)).toBe("immediate");
    expect(closeReaction(1008, HB_ERROR_CODES.SERVER_BUSY)).toBe("backoff");
    expect(closeReaction(1008, HB_ERROR_CODES.ROOM_CLOSED)).toBe("backoff");
    expect(closeReaction(1008, HB_ERROR_CODES.FORBIDDEN)).toBe("fatal");
    expect(closeReaction(1008, HB_ERROR_CODES.TOKEN_MISSING)).toBe("fatal");
    expect(closeReaction(1008, HB_ERROR_CODES.TOKEN_INVALID)).toBe("fatal");
    expect(closeReaction(1008, HB_ERROR_CODES.DOC_TOO_LARGE)).toBe("fatal");
    expect(closeReaction(1008, HB_ERROR_CODES.CLIENT_TOO_OLD)).toBe("fatal");
  });

  it("★ کدِ ناشناخته fail closed است — سکوت بهتر از حلقه", () => {
    expect(closeReaction(1008, "SOMETHING_FROM_THE_FUTURE")).toBe("fatal");
    expect(closeReaction(1008, null)).toBe("fatal");
  });
});

describe("اتصالِ اول", () => {
  it("سوکت می‌سازد و وضعیت را می‌گوید", async () => {
    const net = harness();
    await net.transport.connect();
    await flush();

    expect(net.sockets).toHaveLength(1);
    expect(net.last().binaryType).toBe("arraybuffer");
    expect(net.statuses[0]).toEqual({ phase: "connecting", attempt: 1 });

    net.last().open();
    expect(net.statuses.at(-1)).toEqual({ phase: "open", resumed: false });
  });

  it("★ باز شدنِ دوباره `resumed: true` است — ورودیِ دست‌دادنِ مجددِ آداپتور", async () => {
    const net = harness();
    await net.transport.connect();
    await flush();
    net.last().open();

    net.last().serverClose(1006);
    net.clock.fire();
    await flush();
    net.last().open();

    expect(net.statuses.at(-1)).toEqual({ phase: "open", resumed: true });
  });
});

describe("★★ توکن برای هر تلاش تازه گرفته می‌شود", () => {
  it("سه تلاش، سه توکنِ متفاوت", async () => {
    const net = harness();
    await net.transport.connect();
    await flush();
    expect(net.last().token).toBe("token-1");

    for (const expected of ["token-2", "token-3"]) {
      net.last().serverClose(1006);
      net.clock.fire();
      await flush();
      expect(net.last().token).toBe(expected);
    }
  });

  it("توکنی که گرفته نشد یک قطعیِ گذراست، نه ردِ سرور", async () => {
    const net = harness({
      token: () => {
        throw new Error("سرویسِ توکن جواب نداد");
      },
    });
    await net.transport.connect();
    await flush();

    expect(net.sockets).toHaveLength(0);
    expect(net.statuses.at(-1)?.phase).toBe("retrying");
  });
});

describe("★★ زمان‌بندیِ اتصالِ مجدد", () => {
  it("قطعِ ناگهانی: فاصله رشد می‌کند و در بازه‌ی jitter می‌مانَد", async () => {
    const net = harness();
    await net.transport.connect();
    await flush();

    const scheduled: number[] = [];
    for (let round = 1; round <= 4; round++) {
      net.last().serverClose(1006);
      const status = net.statuses.at(-1);
      expect(status?.phase).toBe("retrying");
      if (status?.phase === "retrying") {
        expect(status.attempt).toBe(round);
        scheduled.push(status.nextRetryMs);
      }
      net.clock.fire();
      await flush();
    }

    for (const [index, delay] of scheduled.entries()) {
      const ceiling = backoffCeilingMs(index + 1);
      expect(delay).toBeGreaterThanOrEqual(ceiling / 2);
      expect(delay).toBeLessThanOrEqual(ceiling);
    }
  });

  it("★★ کدِ ۱۰۰۱ **صبر نمی‌کند** — این کلِ تفاوتِ خاموشیِ مودبانه است", async () => {
    const net = harness();
    await net.transport.connect();
    await flush();
    net.last().open();

    net.last().serverClose(1001, "going away");

    expect(net.statuses.at(-1)).toEqual({ phase: "retrying", attempt: 1, nextRetryMs: 0 });
  });

  it("شمارنده بعد از یک اتصالِ موفق صفر می‌شود", async () => {
    const net = harness();
    await net.transport.connect();
    await flush();

    // سه شکستِ پیاپی → شمارنده روی ۳
    for (let round = 0; round < 3; round++) {
      net.last().serverClose(1006);
      net.clock.fire();
      await flush();
    }
    net.last().open();

    // و حالا یک قطعیِ تازه باید دوباره از تلاشِ ۱ شروع کند.
    net.last().serverClose(1006);
    expect(net.statuses.at(-1)).toMatchObject({ phase: "retrying", attempt: 1 });
  });
});

describe("★★ ردِ سرور", () => {
  it("۱۰۰۸ + FORBIDDEN یعنی توقفِ کامل — نه تلاشِ دیگری، نه زمان‌سنجی", async () => {
    const net = harness();
    await net.transport.connect();
    await flush();

    net.last().deliver(
      encodeMessage({
        type: MSG_TYPES.HB_ERROR,
        code: HB_ERROR_CODES.FORBIDDEN,
        message: "دسترسی نداری.",
      }),
    );
    net.last().serverClose(1008, HB_ERROR_CODES.FORBIDDEN);

    expect(net.statuses.at(-1)).toEqual({
      phase: "stopped",
      reason: "fatal",
      code: HB_ERROR_CODES.FORBIDDEN,
      message: "دسترسی نداری.",
    });
    expect(net.clock.size()).toBe(0);
    net.clock.fire();
    await flush();
    expect(net.sockets).toHaveLength(1);
  });

  it("کدِ خطا از `reason`ِ قابِ بستن هم خوانده می‌شود، حتی اگر `HB_ERROR` گم شود", async () => {
    const net = harness();
    await net.transport.connect();
    await flush();

    net.last().serverClose(1008, HB_ERROR_CODES.TOKEN_MISSING);

    expect(net.statuses.at(-1)).toMatchObject({
      phase: "stopped",
      reason: "fatal",
      code: HB_ERROR_CODES.TOKEN_MISSING,
    });
  });

  it("★ `TOKEN_EXPIRED` فوری با توکنِ تازه دوباره تلاش می‌کند", async () => {
    const net = harness();
    await net.transport.connect();
    await flush();

    net.last().serverClose(1008, HB_ERROR_CODES.TOKEN_EXPIRED);
    expect(net.statuses.at(-1)).toMatchObject({ phase: "retrying", nextRetryMs: 0 });

    net.clock.fire();
    await flush();
    expect(net.sockets).toHaveLength(2);
    expect(net.last().token).toBe("token-2");
  });

  it("★★ «فوری» سقف دارد — وگرنه توکنِ منقضیِ کَش‌شده یک حلقه‌ی تنگ است", async () => {
    // تامین‌کننده‌ی توکنی که همیشه همان چیزِ منقضی را می‌دهد: بدونِ سقف، این
    // حلقه با تمامِ توانِ CPU تا ابد به سرور می‌کوبد.
    const net = harness();
    await net.transport.connect();
    await flush();

    const delays: number[] = [];
    for (let round = 0; round < 4; round++) {
      net.last().serverClose(1008, HB_ERROR_CODES.TOKEN_EXPIRED);
      const status = net.statuses.at(-1);
      if (status?.phase === "retrying") delays.push(status.nextRetryMs);
      net.clock.fire();
      await flush();
    }

    expect(delays.slice(0, 2)).toEqual([0, 0]);
    expect(delays[2]).toBeGreaterThan(0);
    expect(delays[3]).toBeGreaterThan(0);
  });

  it("سقفِ «فوری» با یک اتصالِ موفق صفر می‌شود", async () => {
    const net = harness();
    await net.transport.connect();
    await flush();

    for (let round = 0; round < 3; round++) {
      net.last().serverClose(1001);
      net.clock.fire();
      await flush();
    }
    net.last().open();

    // ★ خاموشیِ مودبانه‌ی بعدی دوباره حقِ «فوری» دارد.
    net.last().serverClose(1001);
    expect(net.statuses.at(-1)).toMatchObject({ phase: "retrying", nextRetryMs: 0 });
  });

  it("★ `SERVER_BUSY` موقتی است — backoff، نه توقف", async () => {
    const net = harness();
    await net.transport.connect();
    await flush();

    net.last().serverClose(1008, HB_ERROR_CODES.SERVER_BUSY);

    const status = net.statuses.at(-1);
    expect(status?.phase).toBe("retrying");
    if (status?.phase === "retrying") expect(status.nextRetryMs).toBeGreaterThan(0);
  });
});

describe("★★ پیامِ خروجی روی سوکتِ بسته دور ریخته می‌شود", () => {
  it("نه بافر می‌شود نه می‌ترکد — فقط شمرده می‌شود", async () => {
    const net = harness();
    await net.transport.connect();
    await flush();

    // هنوز باز نشده
    net.transport.send(new Uint8Array([1]));
    net.last().open();
    net.transport.send(new Uint8Array([2]));
    net.last().serverClose(1006);
    net.transport.send(new Uint8Array([3]));

    expect(net.transport.droppedWhileDown).toBe(2);
    expect(net.sockets[0]?.sent).toHaveLength(1);
  });
});

describe("پیامِ ورودی", () => {
  it("هم `Uint8Array` و هم `ArrayBuffer` تحویل می‌شوند، رشته نه", async () => {
    const net = harness();
    const received: Uint8Array[] = [];
    net.transport.onMessage((bytes) => received.push(bytes));
    await net.transport.connect();
    await flush();
    net.last().open();

    net.last().deliver(new Uint8Array([7, 8]));
    net.last().onmessage?.({ data: new Uint8Array([9]).buffer });
    net.last().onmessage?.({ data: "سلام" });

    expect(received).toHaveLength(2);
    expect([...(received[1] ?? [])]).toEqual([9]);
  });
});

describe("★ تازه‌سازیِ توکن روی اتصالِ باز", () => {
  it("`HB_AUTH_REFRESH` با توکنِ تازه می‌رود و دوباره زمان‌بندی می‌شود", async () => {
    const net = harness({ authRefreshMs: 45_000 });
    await net.transport.connect();
    await flush();
    net.last().open();

    expect(net.clock.delays()).toEqual([45_000]);
    net.clock.fire();
    await flush();

    const [first] = net.last().sent;
    expect(first?.[0]).toBe(MSG_TYPES.HB_AUTH_REFRESH);
    expect(net.clock.delays()).toEqual([45_000]);
  });

  it("با قطعِ اتصال زمان‌سنجِ تازه‌سازی هم می‌رود", async () => {
    const net = harness({ authRefreshMs: 45_000 });
    await net.transport.connect();
    await flush();
    net.last().open();
    net.last().serverClose(1006);

    // فقط زمان‌سنجِ تلاشِ بعدی باقی مانده، نه تازه‌سازی.
    expect(net.clock.delays()).toHaveLength(1);
    expect(net.clock.delays()[0]).not.toBe(45_000);
  });
});

describe("disconnect", () => {
  it("با کدِ ۱۰۰۰ می‌بندد و دیگر برنمی‌گردد", async () => {
    const net = harness();
    await net.transport.connect();
    await flush();
    net.last().open();

    net.transport.disconnect();

    expect(net.last().closedWith).toBe(1000);
    expect(net.clock.size()).toBe(0);
    net.clock.fire();
    await flush();
    expect(net.sockets).toHaveLength(1);
  });

  it("★ `close`ِ سوکتِ رهاشده یک حلقه‌ی دوم راه نمی‌اندازد", async () => {
    const net = harness();
    await net.transport.connect();
    await flush();
    const abandoned = net.last();
    net.transport.disconnect();

    // سوکتِ قدیمی حالا `close` را اعلام می‌کند — نباید هیچ اثری داشته باشد.
    abandoned.serverClose(1006);

    expect(net.clock.size()).toBe(0);
  });
});

describe("★ شبکه‌ی مرورگر", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  function stubBrowserNetwork(online: boolean) {
    const listeners = new Map<string, () => void>();
    vi.stubGlobal("navigator", { onLine: online });
    vi.stubGlobal("addEventListener", (type: string, handler: () => void) => {
      listeners.set(type, handler);
    });
    vi.stubGlobal("removeEventListener", (type: string) => {
      listeners.delete(type);
    });
    return listeners;
  }

  it("`offline` تلاش را متوقف می‌کند و `online` فوراً برش می‌گرداند", async () => {
    const listeners = stubBrowserNetwork(true);
    const net = harness();
    await net.transport.connect();
    await flush();
    net.last().open();

    listeners.get("offline")?.();
    expect(net.statuses.at(-1)).toMatchObject({ phase: "stopped", reason: "offline" });
    expect(net.clock.size()).toBe(0);

    vi.stubGlobal("navigator", { onLine: true });
    listeners.get("online")?.();
    await flush();
    expect(net.sockets).toHaveLength(2);
  });

  it("وقتی مرورگر می‌گوید شبکه نیست، اصلاً سوکتی ساخته نمی‌شود", async () => {
    stubBrowserNetwork(false);
    const net = harness();
    await net.transport.connect();
    await flush();

    expect(net.sockets).toHaveLength(0);
    expect(net.statuses.at(-1)).toMatchObject({ phase: "stopped", reason: "offline" });
  });
});

/**
 * ★★ گام ۹٫۱ — دو قطعی که هرگز `close` نمی‌دهند.
 *
 * ادعای «چقدر طول می‌کشد» کارِ `rt:reconnect` است (رله‌ی سیاه‌چاله، ساعتِ دیوار). این‌جا
 * فقط ماشینِ حالت: چه چیزی زمان‌بندی می‌شود، چه چیزی می‌افتد، و چه چیزی **نمی‌افتد**.
 */
describe("★★ مهلتِ اتصال (گام ۹٫۱)", () => {
  // ⚠️ بلوکِ «رویدادهای شبکه» بالاتر `navigator` را stub می‌کند و آخرین تستش offline
  //    می‌گذارد؛ بدونِ این، این‌جا اصلاً سوکتی ساخته نمی‌شود.
  beforeEach(() => vi.unstubAllGlobals());

  it("پیش‌فرض‌ها روشن‌اند و با سرور جفت‌اند (۳ × ۲۵s)", () => {
    expect(DEFAULT_CONNECT_TIMEOUT_MS).toBe(10_000);
    // ⚠️ اگر `RT_HEARTBEAT_INTERVAL_MS`ِ پیش‌فرض عوض شد، این عدد هم باید عوض شود.
    expect(DEFAULT_SILENCE_TIMEOUT_MS).toBeGreaterThan(2 * 25_000);
  });

  it("سوکتی که باز نمی‌شود انداخته می‌شود و backoff شروع می‌شود", async () => {
    const net = harness({ connectTimeoutMs: 10_000 });
    await net.transport.connect();
    await flush();
    const stuck = net.last();
    expect(net.clock.delays()).toEqual([10_000]);

    net.clock.fire();
    await flush();

    expect(stuck.closedWith).not.toBeNull();
    expect(net.statuses.at(-1)).toMatchObject({ phase: "retrying", attempt: 1 });
    expect(net.statuses.at(-1)).toMatchObject({ nextRetryMs: expect.any(Number) });
    // و بعد از فاصله، سوکتِ **تازه**‌ای ساخته می‌شود — نه همان قبلی.
    net.clock.fire();
    await flush();
    expect(net.sockets).toHaveLength(2);
    expect(net.last()).not.toBe(stuck);
  });

  it("★ سوکتی که به‌موقع باز شد، مهلتش پاک می‌شود — تایمرِ یتیم نمی‌مانَد", async () => {
    const net = harness({ connectTimeoutMs: 10_000 });
    await net.transport.connect();
    await flush();
    net.last().open();

    expect(net.clock.size()).toBe(0);
    expect(net.statuses.at(-1)).toEqual({ phase: "open", resumed: false });
  });

  it("★ تایمرِ نسلِ قبلی سوکتِ نسلِ بعدی را نمی‌اندازد", async () => {
    // ⚠️ همان تله‌ی `generation`: بینِ «توکن را بگیر» و «سوکت را بساز» یک await هست.
    const net = harness({ connectTimeoutMs: 10_000 });
    await net.transport.connect();
    await flush();
    net.last().serverClose(1006);
    // handleClose تایمرِ نسلِ اول را پاک کرده؛ فقط تایمرِ backoff مانده.
    expect(net.clock.delays()).toHaveLength(1);
    net.clock.fire();
    await flush();
    expect(net.sockets).toHaveLength(2);
    net.last().open();
    expect(net.statuses.at(-1)).toMatchObject({ phase: "open" });
  });
});

describe("★★ نگهبانِ سکوت (گام ۹٫۱)", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("سوکتِ بازِ بی‌پیام بعد از مهلت مرده فرض می‌شود و backoff شروع می‌شود", async () => {
    const net = harness({ silenceTimeoutMs: 75_000 });
    await net.transport.connect();
    await flush();
    const quiet = net.last();
    quiet.open();

    expect(net.clock.delays()).toEqual([75_000]);
    net.clock.fire();
    await flush();

    expect(quiet.closedWith).not.toBeNull();
    expect(net.statuses.at(-1)).toMatchObject({ phase: "retrying", attempt: 1 });
    // ★ و ماشینِ حالت همان است: فاصله‌ی تلاشِ اول، نه سقفِ backoff.
    const retrying = net.statuses.at(-1);
    expect(retrying?.phase === "retrying" ? retrying.nextRetryMs : -1).toBeLessThanOrEqual(
      backoffCeilingMs(1),
    );
  });

  it("★ هر پیامِ ورودی تایمر را از نو می‌شمارد — اتصالِ زنده نمی‌افتد", async () => {
    const net = harness({ silenceTimeoutMs: 75_000 });
    await net.transport.connect();
    await flush();
    const live = net.last();
    live.open();

    const armedAtOpen = net.clock.ids();

    // پیش از انقضا یک پیام می‌رسد (همان keepaliveِ سرور: HB_ROOM_INFO).
    live.deliver(encodeMessage({ type: MSG_TYPES.HB_ROOM_INFO, users: 1, seq: 0, save: "saved" }));
    // ★ فقط **یک** تایمرِ سکوت در انتظار است، و **تایمرِ تازه‌ای** است — نه همان قبلی.
    //   بدونِ این مقایسه، «از نو شمردن» با «نشمردن» یک شکل بود: هر دو یک تایمر دارند.
    expect(net.clock.delays()).toEqual([75_000]);
    expect(net.clock.ids()).not.toEqual(armedAtOpen);
    expect(live.closedWith).toBeNull();
    expect(net.statuses.at(-1)).toMatchObject({ phase: "open" });
  });

  it("★ پیامِ ناشناخته هم نشانه‌ی زندگی است — پیش از decode شمرده می‌شود", async () => {
    const net = harness({ silenceTimeoutMs: 75_000 });
    await net.transport.connect();
    await flush();
    const live = net.last();
    live.open();
    const armedAtOpen = net.clock.ids();
    live.deliver(new Uint8Array([0x7f, 1, 2, 3]));
    expect(net.clock.delays()).toEqual([75_000]);
    expect(net.clock.ids()).not.toEqual(armedAtOpen);
    expect(live.closedWith).toBeNull();
  });

  it("با `disconnect` نگهبان هم می‌رود — بعدش هیچ تلاشی زمان‌بندی نمی‌شود", async () => {
    const net = harness({ silenceTimeoutMs: 75_000, connectTimeoutMs: 10_000 });
    await net.transport.connect();
    await flush();
    net.last().open();
    net.transport.disconnect();

    expect(net.clock.size()).toBe(0);
    const before = net.statuses.length;
    net.clock.fire();
    await flush();
    expect(net.statuses.length).toBe(before);
    expect(net.sockets).toHaveLength(1);
  });

  it("★ سوکتِ ردشده (۱۰۰۸ fatal) نگهبانِ سکوت راه نمی‌اندازد", async () => {
    const net = harness({ silenceTimeoutMs: 75_000 });
    await net.transport.connect();
    await flush();
    net.last().open();
    net
      .last()
      .deliver(
        encodeMessage({ type: MSG_TYPES.HB_ERROR, code: HB_ERROR_CODES.FORBIDDEN, message: "نه" }),
      );
    net.last().serverClose(1008, HB_ERROR_CODES.FORBIDDEN);
    expect(net.statuses.at(-1)).toMatchObject({ phase: "stopped", reason: "fatal" });
    expect(net.clock.size()).toBe(0);
  });
});
