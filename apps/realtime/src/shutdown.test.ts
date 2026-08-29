import { randomBytes } from "node:crypto";
import net from "node:net";

import { WebSocket } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuthError,
  AUTH_ERROR_CODES,
  type BoardAuthority,
  type RtTokenClaims,
} from "./auth/index.ts";
import { createLogger } from "./log.ts";
import { createRtServer, type RtServer, type RtSession } from "./server.ts";
import { gracefulShutdown } from "./shutdown.ts";

/**
 * تست‌های گام ۴٫۸ — **heartbeat، خاموشیِ مودبانه، کاوشِ سلامت**.
 *
 * ⚠️ با سرور و سوکتِ **واقعی**: ادعاها درباره‌ی کدِ بستن، پاسخِ HTTP و ping/pong
 * اند — یعنی چیزهایی که فقط روی سیم معنا دارند. ماک همان چیزی را تایید می‌کرد
 * که خودمان نوشته‌ایم.
 */

const BOARD = "brd_1";

/**
 * ★ فاز ۷: بدلِ تستیِ `BoardAuthority` — این تست‌ها فقط توکنِ معتبر لازم دارند
 * (heartbeat/۱۰۰۱/سلامت)، نه تغییرِ نقش. توکن یک base64(JSON)ِ ساده است؛ تاییدِ
 * واقعیِ JWT کارِ `@hamboom/auth-core` است.
 */
const encodeToken = (claims: RtTokenClaims): string =>
  Buffer.from(JSON.stringify(claims)).toString("base64url");

const authority: BoardAuthority = {
  developmentOnly: false,
  verify(rawToken, boardId) {
    if (rawToken.length === 0) {
      return Promise.reject(new AuthError(AUTH_ERROR_CODES.missing, "توکن لازم است"));
    }
    let claims: RtTokenClaims;
    try {
      claims = JSON.parse(Buffer.from(rawToken, "base64url").toString("utf8")) as RtTokenClaims;
    } catch {
      return Promise.reject(new AuthError(AUTH_ERROR_CODES.invalid, "توکنِ نامعتبر"));
    }
    if (claims.exp * 1000 < Date.now()) {
      return Promise.reject(new AuthError(AUTH_ERROR_CODES.expired, "توکن منقضی شد"));
    }
    if (claims.boardId !== boardId) {
      return Promise.reject(new AuthError(AUTH_ERROR_CODES.forbidden, "بوردِ دیگر"));
    }
    return Promise.resolve(claims);
  },
};
const token = (): string =>
  encodeToken({ sub: "usr_1", boardId: BOARD, role: "editor", exp: Math.floor(Date.now() / 1000) + 3600 });

let running: RtServer | null = null;
let joined: RtSession[] = [];

afterEach(async () => {
  await running?.close();
  running = null;
  joined = [];
});

async function startServer(heartbeatMs?: number): Promise<RtServer> {
  running = await createRtServer({
    authority,
    appEnv: "local",
    ...(heartbeatMs === undefined ? {} : { heartbeatMs }),
    logger: createLogger({ level: "fatal" }),
    onJoin: (session) => {
      joined.push(session);
    },
  });
  return running;
}

function open(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/rt?board=${BOARD}&token=${token()}`);
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

/**
 * یک همتای **مرده**: دست‌دادنِ WebSocket را کامل می‌کند و بعد هیچ‌وقت چیزی
 * نمی‌فرستد — نه pong، نه close.
 */
function deadPeer(port: number): Promise<net.Socket> {
  const key = randomBytes(16).toString("base64");
  const socket = net.connect(port, "127.0.0.1");
  const CRLF = "\r\n";

  return new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.on("connect", () => {
      socket.write(
        [
          `GET /rt?board=${BOARD}&token=${token()} HTTP/1.1`,
          `Host: 127.0.0.1:${String(port)}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join(CRLF),
      );
    });
    socket.once("data", (chunk: Buffer) => {
      const status = chunk.toString().split(CRLF)[0] ?? "";
      if (status.startsWith("HTTP/1.1 101")) resolve(socket);
      else reject(new Error(`دست‌دادن نشد: ${status}`));
    });
  });
}

async function get(port: number, path: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`);
  return { status: response.status, body: await response.text() };
}

describe("★ کاوشِ سلامت — بدونِ auth", () => {
  it("`/healthz` و `/readyz` بدونِ توکن پاسخ می‌دهند", async () => {
    const server = await startServer();

    await expect(get(server.port, "/healthz")).resolves.toMatchObject({ status: 200 });
    await expect(get(server.port, "/readyz")).resolves.toMatchObject({ status: 200 });
  });

  it("مسیرِ ناشناخته همچنان ۴۰۴ است", async () => {
    const server = await startServer();
    await expect(get(server.port, "/whatever")).resolves.toMatchObject({ status: 404 });
  });

  it("★★ در خاموشی، `readyz` رد می‌کند ولی `healthz` **سبز می‌مانَد**", async () => {
    // ⚠️ قاطی‌کردنشان استقرار را خراب می‌کند: اگر `healthz` هم رد شود، K8s پاد
    //    را **وسطِ تخلیه** می‌کشد.
    const server = await startServer();
    await server.shutdown();

    await expect(get(server.port, "/readyz")).resolves.toMatchObject({ status: 503 });
    await expect(get(server.port, "/healthz")).resolves.toMatchObject({ status: 200 });
  });
});

describe("★★ خاموشیِ مودبانه", () => {
  it("★★ کلاینت کدِ **۱۰۰۱ Going Away** می‌گیرد، نه ۱۰۰۰", async () => {
    // ⚠️ فرقش کارِ کلاینت است: ۱۰۰۰ یعنی «تمام شد، آرام بگیر»، ۱۰۰۱ یعنی «این
    //    نود می‌رود، **فوراً** جای دیگر وصل شو».
    const server = await startServer();
    const socket = await open(server.port);
    await vi.waitFor(() => expect(joined).toHaveLength(1));

    const closed = new Promise<number>((resolve) => socket.once("close", resolve));
    await server.shutdown();

    await expect(closed).resolves.toBe(1001);
  });

  it("★ بعد از شروعِ خاموشی، اتصالِ تازه پذیرفته نمی‌شود", async () => {
    // ⚠️ وگرنه کلاینتی وصل می‌شود که چند لحظه بعد بیرون انداخته می‌شود — و در
    //    استقرارِ واقعی دوباره به همین نودِ در حالِ مرگ برمی‌گردد.
    const server = await startServer();
    await server.shutdown();

    await expect(open(server.port)).rejects.toThrow();
    expect(joined).toHaveLength(0);
  });

  it("`ready` بعد از خاموشی `false` است", async () => {
    const server = await startServer();
    expect(server.ready).toBe(true);
    await server.shutdown();
    expect(server.ready).toBe(false);
  });
});

describe("★★ heartbeat", () => {
  it("★★ اتصالِ سالم زنده می‌مانَد — چند دوره‌ی پیاپی", async () => {
    // ⚠️ **این تله‌ی واقعیِ همین گام بود:** با `noServer: true` رویدادِ
    //    `connection` خودش emit **نمی‌شود**، پس اگر «زنده» بودن از آن خوانده
    //    می‌شد، هیچ سوکتی علامت نمی‌خورد و اولین تیک **همه** را می‌کشت.
    const server = await startServer(40);
    const socket = await open(server.port);
    await vi.waitFor(() => expect(joined).toHaveLength(1));

    let closeCode = 0;
    socket.once("close", (code) => (closeCode = code));
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(closeCode).toBe(0);
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  });

  it("★★ سوکتی که pong نمی‌دهد بسته می‌شود", async () => {
    // ⚠️ **کلاینتِ خام، نه `ws`:** خودِ `ws` به ping **خودکار** جواب می‌دهد، پس با
    //    آن نمی‌شود یک همتای مرده ساخت. اینجا دست‌دادن را دستی انجام می‌دهیم و
    //    بعد **ساکت** می‌مانیم — همان اتصالِ نیم‌بازی که TCP دقیقه‌ها طول می‌دهد
    //    تا بفهمد، و روی شبکه‌ی ناپایدار (ریسکِ PLAN بخش ۱۰) عادی است.
    const server = await startServer(40);
    const socket = await deadPeer(server.port);
    await vi.waitFor(() => expect(joined).toHaveLength(1));

    const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("سوکتِ بی‌پاسخ بسته نشد")), 5_000),
    );

    await expect(Promise.race([closed, timeout])).resolves.toBeUndefined();
  });
});

/**
 * ★★ ترتیبِ خاموشی — [`gracefulShutdown`](./shutdown.ts).
 *
 * ⚠️ **این ترتیب تنها ادعای آن ماژول است**، و روی ویندوز حتی سنجه‌ی زنده هم
 * نمی‌تواند با `SIGTERM` راه‌اندازی‌اش کند (`child.kill` آنجا فرایند را بی‌درنگ
 * می‌کشد). پس اینجا مستقیم صدا زده می‌شود.
 */
describe("★★ ترتیبِ خاموشیِ مودبانه", () => {
  function spies() {
    const order: string[] = [];
    return {
      order,
      server: {
        shutdown: () => {
          order.push("server.shutdown");
          return Promise.resolve();
        },
        close: () => {
          order.push("server.close");
          return Promise.resolve();
        },
      },
      rooms: {
        close: () => {
          order.push("rooms.close");
          return Promise.resolve();
        },
      },
      closeResources: () => {
        order.push("resources");
        return Promise.resolve();
      },
    };
  }

  it("★★ اول بدرقه، بعد تخلیه و snapshot، بعد منابع", async () => {
    // ⚠️ اگر `rooms.close` قبل از `server.shutdown` می‌آمد، کلاینت‌ها هنوز وصل
    //    بودند و صفِ نوشتن هیچ‌وقت خالی نمی‌شد.
    const s = spies();
    await gracefulShutdown(s);

    expect(s.order).toEqual(["server.shutdown", "rooms.close", "server.close", "resources"]);
  });

  it("★ شکستِ بستنِ اتاق‌ها جلوی بقیه‌ی خاموشی را نمی‌گیرد", async () => {
    // ⚠️ نودی که اینجا گیر کند، قفلِ صاحبش را هم پس نمی‌دهد و بورد تا انقضای
    //    اجاره بی‌صاحب می‌مانَد.
    const s = spies();
    const failing = {
      close: () => {
        s.order.push("rooms.close");
        return Promise.reject(new Error("اتاق بسته نشد"));
      },
    };

    await expect(
      gracefulShutdown({
        server: s.server,
        rooms: failing,
        closeResources: s.closeResources,
        logger: createLogger({ level: "fatal" }),
      }),
    ).resolves.toBeUndefined();

    expect(s.order).toEqual(["server.shutdown", "rooms.close", "server.close", "resources"]);
  });
});
