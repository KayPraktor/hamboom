import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";

import { encodeMessage, MSG_TYPES, type BoardRole } from "@hamboom/ydoc-schema";
import { WebSocketServer, type WebSocket } from "ws";

import { assertAuthorityUsable, type BoardAuthority } from "./auth/index.ts";
import { createLogger, maskSubject, type Logger } from "./log.ts";
import { RtProtocolError } from "./protocol-error.ts";

/**
 * سرورِ WebSocketِ همگام‌سازی — گام ۴٫۱: **دست‌دادن و احراز هویت**.
 *
 * مسیر: `ws://<host>/rt?board=<boardId>&token=<rtToken>` (PLAN بخش ۵٫۳).
 *
 * ── ★★ دو نوعِ «رد کردن»، و چرا فرق دارند ────────────────────────────
 *
 * | چه چیزی | پاسخ | چرا |
 * |---|---|---|
 * | مسیرِ اشتباه، بدونِ `board` | **HTTP 404/400**، بدونِ upgrade | این اصلاً کلاینتِ ما نیست؛ دست‌دادنِ WS برایش تشریفاتِ بی‌فایده است |
 * | توکنِ نامعتبر/منقضی/غایب | **upgrade می‌شود**، بعد `HB_ERROR` و بستن | کلاینتِ ماست و باید **کدِ خطا** را بفهمد |
 *
 * ⚠️ نکته‌ی دوم عمدی و مهم است: اگر اتصال را در سطحِ HTTP رد کنیم، مرورگر فقط یک
 * خطای عمومیِ WebSocket می‌بیند و کلاینت نمی‌فهمد باید توکن را **تازه** کند یا
 * کاربر را به ورود بفرستد. `0x14 HB_ERROR` دقیقاً برای همین در PLAN تعریف شده:
 * «`{ code, message }` سپس بستنِ اتصال».
 *
 * ── ★ «قبل از join شدن به اتاق» ──────────────────────────────────────
 *
 * `onJoin` تنها دری است که به اتاق باز می‌شود (گام ۴٫۲ پرش می‌کند). هیچ مسیرِ
 * ردشده‌ای به آن نمی‌رسد — و تست این را با یک شاهد می‌سنجد، نه با خواندنِ کد.
 */

/** یک اتصالِ احراز هویت‌شده که به اتاق تحویل می‌شود (گام ۴٫۲ مصرفش می‌کند). */
export interface RtSession {
  socket: WebSocket;
  boardId: string;
  /** شناسه‌ی کاربر. ⚠️ **PII** — برای لاگ از `maskSubject` رد کن. */
  sub: string;
  role: BoardRole;
  /** انقضای توکن، **ثانیه**ی یونیکس — گام ۴٫۵ رویش تایمر می‌گذارد. */
  exp: number;
}

export interface RtServerOptions {
  authority: BoardAuthority;
  /** `APP_ENV` — گیتِ ADR-031 روی همین می‌نشیند. */
  appEnv: string;
  port?: number;
  logger?: Logger;
  /**
   * ★ ورودیِ اتاق (گام ۴٫۲: `RoomManager.join`).
   *
   * ⚠️ **می‌تواند رد کند.** اگر `RtProtocolError` بیندازد — سقفِ نود، سندِ
   * بیش‌ازحد بزرگ — همان مسیرِ ردِ احراز هویت طی می‌شود: `HB_ERROR` و بستن.
   * سرور نمی‌داند خطا از کدام لایه آمده، فقط کدش را می‌داند.
   */
  onJoin?: (session: RtSession) => void | Promise<unknown>;
}

export interface RtServer {
  readonly port: number;
  close(): Promise<void>;
}

/** مسیرِ WebSocketِ ما — هر چیز دیگری اصلاً upgrade نمی‌شود. */
const RT_PATH = "/rt";

/**
 * کدِ بستنِ WebSocket برای ردِ سیاستی.
 *
 * ۱۰۰۸ = «policy violation». عمداً ۱۰۰۰ (بستنِ عادی) نیست: کلاینت باید بتواند
 * «سرور مرا نپذیرفت» را از «اتصال تمام شد» تشخیص دهد، حتی اگر پیامِ `HB_ERROR`
 * را از دست بدهد.
 */
const CLOSE_POLICY = 1008;

/**
 * ⚠️ **`async` است تا شکستِ گیت همیشه یک rejection باشد.**
 *
 * اگر تابع همزمان throw می‌کرد، صداکننده‌ای که `createRtServer(...).catch(...)`
 * می‌نویسد آن را از دست می‌داد. برای یک گیتِ **امنیتی**، «بسته به اینکه چطور
 * صدایش بزنی فرق می‌کند» پذیرفتنی نیست — همان درسی که در `BoardAuthority.verify`
 * هم اعمال شد.
 */
export async function createRtServer({
  authority,
  appEnv,
  port = 0,
  logger = createLogger(),
  onJoin = () => {},
}: RtServerOptions): Promise<RtServer> {
  // ★★ **اولین کار، قبل از هر listen** — ADR-031. اگر اینجا نبود، سرور بالا
  //    می‌آمد و تازه اولین اتصال معلوم می‌کرد که با احراز هویتِ ساختگی کار می‌کند.
  assertAuthorityUsable(authority, appEnv);

  const http = createServer((_request, response) => {
    // این سرور HTTP سرو نمی‌کند؛ فقط جایی برای upgrade است.
    response.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true });

  http.on("upgrade", (request, socket, head) => {
    const target = parseTarget(request);
    if (!target) {
      // ⚠️ بدونِ upgrade — این کلاینتِ ما نیست.
      rejectHandshake(socket, 404, "not found");
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      void authenticate(ws, target, { authority, logger, onJoin });
    });
  });

  await new Promise<void>((resolve) => http.listen(port, resolve));

  const address = http.address();
  const actual = typeof address === "object" && address ? address.port : port;
  logger.info("سرورِ realtime بالا آمد", { port: actual, appEnv });

  return { port: actual, close: () => closeAll(http, wss) };
}

// ─────────────────────────────────────────────────────────────
// دست‌دادن
// ─────────────────────────────────────────────────────────────

interface Target {
  boardId: string;
  token: string;
}

/**
 * مسیر و پارامترها. `null` یعنی «اصلاً کلاینتِ ما نیست».
 *
 * ⚠️ نبودِ **توکن** اینجا `null` برنمی‌گرداند: آن یک کلاینتِ ماست که توکن ندارد و
 * باید `TOKEN_MISSING` بگیرد، نه یک ۴۰۴ی گنگ.
 */
function parseTarget(request: IncomingMessage): Target | null {
  if (!request.url) return null;
  // `host` فقط برای کامل‌شدنِ URL است؛ مقدارش اهمیتی ندارد.
  const url = new URL(request.url, "http://localhost");
  if (url.pathname !== RT_PATH) return null;

  const boardId = url.searchParams.get("board");
  if (!boardId) return null;

  return { boardId, token: url.searchParams.get("token") ?? "" };
}

interface HandshakeDeps {
  authority: BoardAuthority;
  logger: Logger;
  onJoin: (session: RtSession) => void | Promise<unknown>;
}

async function authenticate(
  socket: WebSocket,
  target: Target,
  { authority, logger, onJoin }: HandshakeDeps,
): Promise<void> {
  // ★★ **مکث تا وقتی اتاق شنونده‌اش را سوار کند** — قبل از هر `await`.
  //
  // ⚠️ این را تستِ SIGKILL پیدا کرد، نه بازبینی: کلاینت به محضِ `open` شروع به
  // فرستادن می‌کند (خودِ `canvas-sync` همان لحظه step1/step2 می‌فرستد)، ولی
  // `open` **قبل از** پایانِ احراز هویت و بارگذاریِ اتاق رخ می‌دهد. بدونِ این
  // مکث، آن پیام‌ها به سوکتی می‌رسیدند که هنوز هیچ شنونده‌ای ندارد و `ws`
  // بی‌صدا دورشان می‌ریخت — یعنی اولین ژستِ کاربر گم می‌شد **بدونِ هیچ خطایی**.
  socket.pause();
  try {
    const claims = await authority.verify(target.token, target.boardId);
    const role = await effectiveRole(authority, claims);

    logger.info("اتصال پذیرفته شد", {
      boardId: target.boardId,
      // ★ P7 — شناسه هرگز خام. توکن اصلاً وارد لاگ نمی‌شود.
      sub: maskSubject(claims.sub),
      role,
      // فقط وقتی چیزی برای گفتن هست: نقشِ توکن با نقشِ واقعی نخوانده.
      ...(role === claims.role ? {} : { tokenRole: claims.role }),
    });

    // ★ `await` عمدی: اگر اتاق **رد** کند (سقفِ نود، سندِ بزرگ) باید همین‌جا
    //   گرفته شود و از همان مسیرِ رد برود، نه به‌صورت یک rejectionِ بی‌صاحب.
    await onJoin({
      socket,
      boardId: claims.boardId,
      sub: claims.sub,
      role,
      exp: claims.exp,
    });

    // ★ حالا اتاق شنونده دارد؛ هرچه در این فاصله رسیده بود تحویل می‌شود.
    socket.resume();
  } catch (cause) {
    const error =
      cause instanceof RtProtocolError
        ? cause
        : // خطای نامنتظره‌ی هیچ لایه‌ای نباید سرور را بیندازد و نباید جزئیاتش
          // به کلاینت برود.
          new RtProtocolError("FORBIDDEN", "اتصال برقرار نشد.", String(cause));

    logger.warn("اتصال رد شد", {
      boardId: target.boardId,
      code: error.code,
      // `detail` مالِ سرور است؛ `message` چیزی است که کاربر می‌بیند.
      detail: error.detail,
    });

    // ⚠️ **قبل از بستن باید resume شود.** `pause` گیرنده را متوقف می‌کند، و
    //    سوکتِ متوقف قابِ `close`ِ کلاینت را هم نمی‌خوانَد — یعنی دست‌دادنِ بستن
    //    نیمه‌کاره می‌مانَد و اتصال تا timeout باز. (چهار تستِ ردِ گام ۴٫۱ همین
    //    را نشان دادند.)
    socket.resume();
    denyConnection(socket, error);
  }
}

/**
 * ★★ نقشِ **واقعی**، نه نقشی که توکن ادعا می‌کند — گام ۴٫۵.
 *
 * ⚠️ بدونِ این، اعمالِ مجوز فقط **تا اولین اتصالِ مجدد** دوام دارد: نقش داخلِ
 * توکن است و توکن تغییر نمی‌کند، پس کاربری که به `viewer` تنزل داده شده کافی
 * است تبش را ببندد و باز کند تا با همان توکن دوباره `editor` شود.
 * [ADR-012](../../../ARCHITECTURE_DECISIONS.md#adr-012) دقیقاً برای همین نقش را
 * یک مقدارِ **محاسبه‌شده** تعریف کرده، نه یک claimِ ذخیره‌شده.
 *
 * ★ **و در جهتِ امن fail می‌کند:** اگر پیاده‌سازی نظری نداشته باشد
 * (`undefined` یا اصلاً متد را نداشته باشد) نقشِ توکن می‌مانَد؛ ولی `null` یعنی
 * دسترسی برداشته شده و اتصال **رد** می‌شود.
 */
async function effectiveRole(
  authority: BoardAuthority,
  claims: { sub: string; boardId: string; role: BoardRole },
): Promise<BoardRole> {
  const current = await authority.currentRole?.(claims.sub, claims.boardId);
  if (current === undefined) return claims.role;
  if (current === null) {
    throw new RtProtocolError(
      "FORBIDDEN",
      "به این بورد دسترسی ندارید.",
      "دسترسی برداشته شده؛ توکن هنوز نقشِ قدیمی را حمل می‌کند",
    );
  }
  return current;
}

/**
 * ردِ اتصال با `HB_ERROR` و سپس بستن — قراردادِ PLAN بخش ۵٫۳.
 *
 * ⚠️ `close` **بعد از** فرستادنِ پیام صدا زده می‌شود و با کدِ سیاستی؛ `ws` خودش
 * بافر را قبل از بستن تخلیه می‌کند.
 */
function denyConnection(socket: WebSocket, error: RtProtocolError): void {
  socket.send(
    encodeMessage({ type: MSG_TYPES.HB_ERROR, code: error.code, message: error.message }),
  );
  socket.close(CLOSE_POLICY, error.code);
}

/** ردِ **قبل از** upgrade — پاسخِ خامِ HTTP، بدونِ دست‌دادنِ WebSocket. */
function rejectHandshake(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function closeAll(http: Server, wss: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    // ★ اول سوکت‌های باز، بعد خودِ سرور: `http.close` منتظرِ اتصال‌های زنده
    //   می‌مانَد و بدونِ این، بستن در تست تا timeout طول می‌کشید.
    for (const client of wss.clients) client.terminate();
    wss.close(() => {
      http.close((error) => (error ? reject(error) : resolve()));
    });
  });
}
