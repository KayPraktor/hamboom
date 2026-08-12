import { decodeMessage, encodeMessage, MSG_TYPES } from "@hamboom/ydoc-schema";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDevBoardAuthority, signDevToken, type BoardAuthority } from "./auth/index.ts";
import { createLogger } from "./log.ts";
import { createRoomManager } from "./room.ts";
import { createRtServer, type RtServer, type RtSession } from "./server.ts";
import { MemoryBoardStore } from "./store/board-store.ts";

/**
 * تست‌های گام ۴٫۱ — **دست‌دادن**.
 *
 * ⚠️ با سرور و سوکتِ **واقعی**، نه ماک: کلِ ادعای این گام «چه چیزی روی سیم رد و
 * بدل می‌شود و در چه ترتیبی» است. یک ماک همان ترتیبی را تایید می‌کند که خودمان
 * نوشته‌ایم.
 */

const SECRET = "a".repeat(32);
const BOARD = "brd_1";
const future = (): number => Math.floor(Date.now() / 1000) + 3600;

const authority = createDevBoardAuthority({ secret: SECRET });
const validToken = (overrides: Record<string, unknown> = {}): string =>
  signDevToken(
    { sub: "usr_9f3c1a", boardId: BOARD, role: "editor", exp: future(), ...overrides } as never,
    SECRET,
  );

let running: RtServer | null = null;
/** خطوطِ لاگِ سرور — نگهبانِ P7 همین‌ها را اسکن می‌کند. */
let logLines: string[] = [];
let joined: RtSession[] = [];

afterEach(async () => {
  await running?.close();
  running = null;
  logLines = [];
  joined = [];
});

async function startServer(overrides: Partial<Parameters<typeof createRtServer>[0]> = {}) {
  running = await createRtServer({
    authority,
    appEnv: "local",
    logger: createLogger({ level: "debug", write: (line) => logLines.push(line) }),
    onJoin: (session) => {
      joined.push(session);
    },
    ...overrides,
  });
  return running;
}

interface Outcome {
  /** اولین پیامِ decode‌شده، اگر آمده باشد. */
  message: ReturnType<typeof decodeMessage>;
  closeCode: number;
  opened: boolean;
}

/** یک اتصالِ کامل تا بسته شدن (یا تا رسیدنِ اولین پیام و بستنِ سرور). */
function connect(port: number, query: string): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${query}`);
    const outcome: Outcome = { message: null, closeCode: 0, opened: false };

    socket.on("open", () => (outcome.opened = true));
    socket.on("message", (data) => {
      outcome.message = decodeMessage(new Uint8Array(data as Buffer));
    });
    socket.on("close", (code) => {
      outcome.closeCode = code;
      resolve(outcome);
    });
    // ردِ **قبل از** upgrade به‌صورت خطای HTTP می‌آید، نه close.
    socket.on("error", () => resolve(outcome));
    setTimeout(() => reject(new Error("اتصال در مهلت تعیین‌شده بسته نشد")), 5_000).unref?.();
  });
}

describe("★★ معیارِ پذیرش — توکنِ معتبر وصل می‌شود", () => {
  it("سوکت باز می‌مانَد و session به اتاق تحویل می‌شود", async () => {
    const server = await startServer();
    const socket = new WebSocket(
      `ws://127.0.0.1:${server.port}/rt?board=${BOARD}&token=${validToken()}`,
    );
    await new Promise((resolve) => socket.on("open", resolve));

    await vi.waitFor(() => expect(joined).toHaveLength(1));
    expect(joined[0]).toMatchObject({ boardId: BOARD, sub: "usr_9f3c1a", role: "editor" });
    // ★ هیچ `HB_ERROR`ی نیامده و سوکت هنوز باز است.
    expect(socket.readyState).toBe(WebSocket.OPEN);

    socket.close();
  });
});

describe("★★ معیارِ پذیرش — سه ردشدن، سه کدِ درست", () => {
  const cases = [
    { name: "بدونِ توکن", query: `/rt?board=${BOARD}`, code: "TOKEN_MISSING" },
    {
      name: "منقضی",
      query: () =>
        `/rt?board=${BOARD}&token=${validToken({ exp: Math.floor(Date.now() / 1000) - 1 })}`,
      code: "TOKEN_EXPIRED",
    },
    {
      name: "دست‌کاری‌شده",
      query: () => `/rt?board=${BOARD}&token=${validToken()}tampered`,
      code: "TOKEN_INVALID",
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.name} → ${testCase.code}`, async () => {
      const server = await startServer();
      const query = typeof testCase.query === "function" ? testCase.query() : testCase.query;
      const outcome = await connect(server.port, query);

      // ★ upgrade **انجام شده** — کلاینتِ ماست و باید کد را بفهمد.
      expect(outcome.opened).toBe(true);
      expect(outcome.message).toEqual({
        type: MSG_TYPES.HB_ERROR,
        code: testCase.code,
        message: expect.any(String),
      });
      // ۱۰۰۸ = policy violation، نه بستنِ عادی.
      expect(outcome.closeCode).toBe(1008);

      // ★★ و مهم‌تر از همه: **هرگز** به اتاق نرسید.
      expect(joined).toEqual([]);
    });
  }

  it("★ توکنِ معتبرِ بوردِ دیگر → `FORBIDDEN` و بدونِ join", async () => {
    const server = await startServer();
    const token = validToken({ boardId: "brd_other" });
    const outcome = await connect(server.port, `/rt?board=${BOARD}&token=${token}`);

    expect(outcome.message).toMatchObject({ code: "FORBIDDEN" });
    expect(joined).toEqual([]);
  });
});

describe("★★ پنجره‌ی دست‌دادن — پیامی که زودتر از اتاق می‌رسد", () => {
  it("پیامِ فرستاده‌شده در لحظه‌ی `open` گم نمی‌شود", async () => {
    // ⚠️ این باگ را **تستِ SIGKILL** پیدا کرد، نه تستِ واحد: کلاینت به محضِ
    // `open` می‌فرستد (خودِ `canvas-sync` همان لحظه step1/step2 می‌دهد)، ولی
    // `open` **قبل از** پایانِ احراز هویت و بارگذاریِ اتاق رخ می‌دهد. تا قبل از
    // `socket.pause()`، آن پیام‌ها به سوکتی می‌رسیدند که هنوز شنونده نداشت و
    // `ws` بی‌صدا دورشان می‌ریخت — یعنی **اولین ژستِ کاربر گم می‌شد**.
    const received: Uint8Array[] = [];
    const server = await startServer({
      onJoin: (session) => {
        // یک بارگذاریِ کند، مثلِ اتاقی که از دیتابیس می‌آید.
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            session.socket.on("message", (data: unknown) => {
              received.push(new Uint8Array(data as ArrayBuffer));
            });
            resolve();
          }, 60);
        });
      },
    });

    const socket = new WebSocket(
      `ws://127.0.0.1:${server.port}/rt?board=${BOARD}&token=${validToken()}`,
    );
    await new Promise((resolve) => socket.on("open", resolve));
    // ★ دقیقاً در لحظه‌ی `open` — قبل از اینکه اتاق آماده باشد.
    socket.send(encodeMessage({ type: MSG_TYPES.HB_AUTH_REFRESH, token: "probe" }));

    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(decodeMessage(received[0]!)).toEqual({
      type: MSG_TYPES.HB_AUTH_REFRESH,
      token: "probe",
    });

    socket.close();
  });
});

describe("★★ ردِ اتاق هم از همان مسیر می‌آید — گام ۴٫۲", () => {
  it("سقفِ نود به کلاینت `SERVER_BUSY` می‌دهد، نه یک قطعِ گنگ", async () => {
    // ⚠️ این ادعا **سیم‌کشی** را می‌آزماید، نه منطقِ اتاق را (آن در
    // `room.test.ts` است): خطای لایه‌ی اتاق باید از همان مسیرِ `HB_ERROR`ِ
    // احراز هویت بیرون بیاید. یعنی سرور نمی‌داند خطا از کجاست، فقط کدش را می‌داند.
    const rooms = createRoomManager({
      store: new MemoryBoardStore(),
      limits: { maxRoomsPerNode: 1, maxDocBytes: 5_000_000, idleTimeoutMs: 60_000 },
      logger: createLogger({ write: (line) => logLines.push(line) }),
    });
    const server = await startServer({ onJoin: (session) => rooms.join(session) });

    const first = new WebSocket(
      `ws://127.0.0.1:${server.port}/rt?board=brd_a&token=${validToken({ boardId: "brd_a" })}`,
    );
    await new Promise((resolve) => first.on("open", resolve));
    await vi.waitFor(() => expect(rooms.size).toBe(1));

    const outcome = await connect(
      server.port,
      `/rt?board=brd_b&token=${validToken({ boardId: "brd_b" })}`,
    );

    expect(outcome.message).toMatchObject({ code: "SERVER_BUSY" });
    expect(outcome.closeCode).toBe(1008);
    // ★ و اتاقِ اول دست‌نخورده مانده.
    expect(rooms.size).toBe(1);

    first.close();
    await rooms.close();
  });
});

describe("مسیرهایی که اصلاً کلاینتِ ما نیستند", () => {
  it("مسیرِ اشتباه و بوردِ غایب اصلاً upgrade نمی‌شوند", async () => {
    const server = await startServer();

    for (const query of ["/", "/socket", `/rt?token=${validToken()}`]) {
      const outcome = await connect(server.port, query);
      expect(outcome.opened).toBe(false);
      expect(outcome.message).toBeNull();
    }
    expect(joined).toEqual([]);
  });
});

describe("★★ گیتِ runtime — ADR-031", () => {
  it("پیاده‌سازیِ توسعه‌ای در production سرور را **بالا نمی‌آورد**", async () => {
    await expect(
      createRtServer({
        authority,
        appEnv: "production",
        logger: createLogger({ write: () => {} }),
      }),
    ).rejects.toThrow(/production/);
  });

  it("★ یک پیاده‌سازیِ واقعی در production مشکلی ندارد", async () => {
    // ⚠️ ضدِ ادعا: اگر گیت روی «production» می‌بست نه روی «توسعه‌ای بودن»، این
    //    تست هم می‌افتاد و معلوم می‌شد گیت بیش از اندازه سفت است.
    const real: BoardAuthority = {
      verify: () => Promise.resolve({ sub: "u", boardId: BOARD, role: "owner", exp: future() }),
    };
    running = await createRtServer({
      authority: real,
      appEnv: "production",
      logger: createLogger({ write: (line) => logLines.push(line) }),
    });
    expect(running.port).toBeGreaterThan(0);
  });
});

describe("★★ نگهبانِ P7 — هیچ PII در لاگ", () => {
  it("توکن و شناسه‌ی خامِ کاربر در خروجیِ لاگ نیستند", async () => {
    const server = await startServer();
    const token = validToken();
    const sub = "usr_9f3c1a";

    // کلِ مسیر: یک اتصالِ موفق و سه ردشدن — لاگِ همه‌شان اسکن می‌شود.
    const ok = new WebSocket(`ws://127.0.0.1:${server.port}/rt?board=${BOARD}&token=${token}`);
    await new Promise((resolve) => ok.on("open", resolve));
    await vi.waitFor(() => expect(joined).toHaveLength(1));
    ok.close();

    await connect(server.port, `/rt?board=${BOARD}`);
    await connect(server.port, `/rt?board=${BOARD}&token=${token}tampered`);

    const output = logLines.join("\n");
    expect(output.length).toBeGreaterThan(0);

    // ★ خودِ توکن — نه کاملش، نه هیچ بخشِ معناداری از امضایش.
    expect(output).not.toContain(token);
    expect(output).not.toContain(token.split(".")[2]);
    // ★ شناسه‌ی خامِ کاربر — فقط شکلِ ماسک‌شده مجاز است.
    expect(output).not.toContain(sub);
    expect(output).toContain("usr_…");
  });

  it("★ نگهبان روی یک نشتِ عمدی **می‌افتد** — یعنی واقعاً چیزی را می‌سنجد", () => {
    // ⚠️ بدونِ این، تستِ بالا می‌توانست فقط به این دلیل سبز باشد که لاگ خالی است.
    const lines: string[] = [];
    const logger = createLogger({ write: (line) => lines.push(line) });
    const token = validToken();

    logger.info("نشتِ عمدی", { token });

    expect(lines.join("")).not.toContain(token);
    expect(lines.join("")).toContain("[redacted]");
  });
});

/**
 * ★★ گام ۴٫۵ — **نقشِ توکن حرفِ آخر نیست**.
 *
 * ⚠️ این حفره‌ی واقعیِ «اعمالِ مجوز روی هر update» است: نقش داخلِ توکن است و توکن
 * **تغییر نمی‌کند**. بدونِ بازپرسی از پورت، کاربری که وسطِ کار تنزل داده شده کافی
 * است تبش را ببندد و باز کند تا با همان توکن دوباره `editor` شود — و کلِ گام ۴٫۵
 * از پشت دور می‌خورد ([ADR-012](../../ARCHITECTURE_DECISIONS.md#adr-012)).
 */
describe("★★ نقشِ جاری بر نقشِ توکن مقدم است — گام ۴٫۵", () => {
  it("توکن `editor` می‌گوید ولی نقشِ جاری `viewer` است → نشست `viewer` می‌شود", async () => {
    const demoting = createDevBoardAuthority({ secret: SECRET });
    demoting.roles.set("usr_9f3c1a", BOARD, "viewer");
    const server = await startServer({ authority: demoting });

    const socket = new WebSocket(
      `ws://127.0.0.1:${server.port}/rt?board=${BOARD}&token=${validToken()}`,
    );
    await new Promise((resolve) => socket.on("open", resolve));
    await vi.waitFor(() => expect(joined).toHaveLength(1));

    // ★ توکن هنوز `editor` می‌گوید؛ نشست `viewer` است.
    expect(joined[0]?.role).toBe("viewer");
    socket.close();
  });

  it("نبودِ نظر یعنی نقشِ توکن معتبر است", async () => {
    const server = await startServer();
    const socket = new WebSocket(
      `ws://127.0.0.1:${server.port}/rt?board=${BOARD}&token=${validToken()}`,
    );
    await new Promise((resolve) => socket.on("open", resolve));
    await vi.waitFor(() => expect(joined).toHaveLength(1));

    expect(joined[0]?.role).toBe("editor");
    socket.close();
  });

  it("★ دسترسیِ برداشته‌شده (`null`) اتصال را با `FORBIDDEN` رد می‌کند", async () => {
    // ⚠️ `null` و «نظری ندارم» نباید یکی رفتار کنند — وگرنه یک کاربرِ اخراج‌شده
    //    با توکنِ قدیمی‌اش تا انقضا وصل می‌مانْد.
    const revoking = createDevBoardAuthority({ secret: SECRET });
    revoking.roles.set("usr_9f3c1a", BOARD, null);
    const server = await startServer({ authority: revoking });

    const outcome = await connect(server.port, `/rt?board=${BOARD}&token=${validToken()}`);

    expect(outcome.message).toMatchObject({ type: MSG_TYPES.HB_ERROR, code: "FORBIDDEN" });
    expect(outcome.closeCode).toBe(1008);
    expect(joined).toHaveLength(0);
  });
});
