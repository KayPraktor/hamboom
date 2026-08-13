import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";

import { decodeMessage, encodeMessage, MSG_TYPES, type BoardRole } from "@hamboom/ydoc-schema";
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
  /** `RT_HEARTBEAT_INTERVAL_MS` — باید **کوتاه‌تر** از idle timeoutِ لودبالانسر باشد. */
  heartbeatMs?: number;
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
  /** آیا `/readyz` سبز است؟ در خاموشیِ مودبانه `false` می‌شود. */
  readonly ready: boolean;
  /**
   * ★★ خاموشیِ **مودبانه** — گام ۴٫۸.
   *
   * از لودبالانسر بیرون می‌رود و کلاینت‌ها را با `1001 Going Away` بدرقه می‌کند،
   * ولی سرور را نمی‌بندد: صداکننده بعدش فرصت دارد کارِ نیمه‌تمام را تخلیه کند و
   * snapshot بگیرد.
   */
  shutdown(): Promise<void>;
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
 * ★ کدِ بستنِ خاموشیِ مودبانه — `1001 Going Away` (الزامِ ADR-006).
 *
 * ⚠️ عمداً ۱۰۰۰ نیست: ۱۰۰۰ یعنی «کار تمام شد» و کلاینت می‌تواند آرام بگیرد.
 * ۱۰۰۱ یعنی «این نود دارد می‌رود» — کلاینت باید **فوراً** دوباره وصل شود، نه با
 * backoff (گام ۵٫۱ سمتِ کلاینت را می‌سازد).
 */
const CLOSE_GOING_AWAY = 1001;

/** سقفِ صبر برای رسیدنِ خداحافظیِ کلاینت‌ها — کلاینتِ مرده نباید گروگان بگیرد. */
const GOODBYE_TIMEOUT_MS = 5_000;

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
  heartbeatMs = 25_000,
  logger = createLogger(),
  onJoin = () => {},
}: RtServerOptions): Promise<RtServer> {
  // ★★ **اولین کار، قبل از هر listen** — ADR-031. اگر اینجا نبود، سرور بالا
  //    می‌آمد و تازه اولین اتصال معلوم می‌کرد که با احراز هویتِ ساختگی کار می‌کند.
  assertAuthorityUsable(authority, appEnv);

  /**
   * ★★ آیا این نود **آماده‌ی گرفتنِ ترافیک** است؟
   *
   * ⚠️ در خاموشیِ مودبانه **اول این `false` می‌شود**، بعد سوکت‌ها بسته می‌شوند.
   * ترتیبِ برعکس یعنی کلاینتی که همین الان بیرون انداختیم، دوباره به **همین**
   * نود برگردد — چون لودبالانسر هنوز آن را سالم می‌داند.
   */
  let ready = true;

  const http = createServer((request, response) => {
    // ── ★ کاوشِ سلامت — بدونِ auth (الزامِ K8s در ADR-006) ──────────
    //
    // ⚠️ دو چیزِ متفاوت‌اند و قاطی‌کردنشان استقرار را خراب می‌کند:
    //   `/healthz` = «زنده‌ام» → اگر رد شود، K8s پاد را **می‌کشد**.
    //   `/readyz`  = «ترافیک بده» → اگر رد شود، فقط از لودبالانسر خارج می‌شود.
    // اگر `healthz` هم در خاموشی رد می‌شد، پاد وسطِ تخلیه کشته می‌شد.
    if (request.url === "/healthz") {
      response.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    if (request.url === "/readyz") {
      response
        .writeHead(ready ? 200 : 503, { "content-type": "text/plain" })
        .end(ready ? "ready" : "draining");
      return;
    }

    // این سرور HTTP سرو نمی‌کند؛ فقط جایی برای upgrade است.
    response.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true });

  http.on("upgrade", (request, socket, head) => {
    // ⚠️ در حالِ خاموشی هیچ اتصالِ تازه‌ای نمی‌پذیریم — وگرنه کلاینتی وصل می‌شود
    //    که چند لحظه بعد با ۱۰۰۱ بیرون انداخته می‌شود.
    if (!ready) {
      rejectHandshake(socket, 503, "shutting down");
      return;
    }

    const target = parseTarget(request);
    if (!target) {
      // ⚠️ بدونِ upgrade — این کلاینتِ ما نیست.
      rejectHandshake(socket, 404, "not found");
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      // ⚠️ **اینجا ثبت می‌شود، نه در رویدادِ `connection`.** با `noServer: true`
      //    آن رویداد **خودش emit نمی‌شود** — `handleUpgrade` فقط این callback را
      //    صدا می‌زند. با تکیه بر `connection`، هیچ سوکتی «زنده» علامت نمی‌خورد و
      //    اولین تیکِ heartbeat **همه‌ی کلاینت‌ها را می‌کشت**.
      markAlive(ws);
      void authenticate(ws, target, { authority, logger, onJoin });
    });
  });

  /**
   * ★★ heartbeat — [ADR-006](../../../ARCHITECTURE_DECISIONS.md#adr-006).
   *
   * دو کار می‌کند و هر دو لازم‌اند:
   *
   * ۱. **اتصال را از دیدِ لودبالانسر زنده نگه می‌دارد.** فاصله عمداً کوتاه‌تر از
   *    timeoutِ idleِ Ingress است؛ وگرنه یک بومِ باز ولی ساکت قطع می‌شود.
   * ۲. ★ **اتصالِ نیم‌باز را پیدا می‌کند.** روی شبکه‌ای که وسط راه بسته می‌شود
   *    (ریسکِ صریحِ PLAN بخش ۱۰)، TCP می‌تواند تا دقایق «باز» بماند در حالی که
   *    هیچ بایتی رد نمی‌شود. آن سوکت **نه `close` می‌دهد نه خطا** — یعنی حضورِ
   *    کاربرِ رفته روی بومِ بقیه یخ می‌زند و اتاق هم تخلیه نمی‌شود.
   *
   * ⚠️ پس «پاسخ نداد» یعنی `terminate`، نه `close`: سوکتی که مرده، دستِ‌دادنِ
   * بستن را هم تمام نمی‌کند و `close`ِ مودبانه تا timeout معلق می‌مانَد.
   */
  const alive = new WeakSet<WebSocket>();
  function markAlive(socket: WebSocket): void {
    alive.add(socket);
    socket.on("pong", () => alive.add(socket));
  }

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (!alive.has(client)) {
        logger.debug("اتصالِ بی‌پاسخ بسته شد (heartbeat)");
        client.terminate();
        continue;
      }
      alive.delete(client);
      client.ping();
    }
  }, heartbeatMs);
  // ⚠️ یک تایمرِ heartbeat نباید جلوی خاموش‌شدنِ فرایند را بگیرد.
  heartbeat.unref?.();

  await new Promise<void>((resolve) => http.listen(port, resolve));

  const address = http.address();
  const actual = typeof address === "object" && address ? address.port : port;
  logger.info("سرورِ realtime بالا آمد", { port: actual, appEnv });

  return {
    port: actual,
    get ready() {
      return ready;
    },

    async shutdown() {
      // ★ ترتیب عمدی است: **اول** از چشمِ لودبالانسر بیفت، بعد کلاینت‌ها را
      //   بفرست. برعکسش یعنی همان کلاینت دوباره به همین نود برمی‌گردد.
      ready = false;
      clearInterval(heartbeat);

      /**
       * ★★ **و منتظرِ رسیدنِ خداحافظی می‌مانیم.**
       *
       * ⚠️ `close()` فقط دستِ‌دادنِ بستن را **شروع** می‌کند. اولین نسخه بلافاصله
       * برمی‌گشت و `close()`ِ بعدی سوکت‌ها را `terminate` می‌کرد — یعنی قابِ
       * بستن هرگز نمی‌رسید و کلاینت **۱۰۰۶ (قطعِ غیرعادی)** می‌دید، نه ۱۰۰۱.
       * سنجه‌ی زنده دقیقاً همین را گرفت. «مودبانه» یعنی صبر تا رسیدنِ خبر.
       */
      const goodbyes = [...wss.clients].map(
        (client) =>
          new Promise<void>((resolve) => {
            client.once("close", () => resolve());
            client.close(CLOSE_GOING_AWAY, "going away");
          }),
      );

      if (goodbyes.length > 0) {
        // ⚠️ ولی **بی‌کران هم صبر نمی‌کنیم**: کلاینتی که مرده هرگز جواب نمی‌دهد و
        //    نباید خاموشیِ نود را گروگان بگیرد. سقفِ K8s برای کلِ خاموشی ۶۰
        //    ثانیه است (ADR-006) و این فقط اولین قدم است.
        await Promise.race([
          Promise.all(goodbyes),
          new Promise((resolve) => setTimeout(resolve, GOODBYE_TIMEOUT_MS).unref?.()),
        ]);
      }

      logger.info("خاموشیِ مودبانه: کلاینت‌ها با ۱۰۰۱ بدرقه شدند", {
        clients: goodbyes.length,
      });
    },

    close: () => {
      clearInterval(heartbeat);
      return closeAll(http, wss);
    },
  };
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

    const session: RtSession = {
      socket,
      boardId: claims.boardId,
      sub: claims.sub,
      role,
      exp: claims.exp,
    };

    // ★ `await` عمدی: اگر اتاق **رد** کند (سقفِ نود، سندِ بزرگ) باید همین‌جا
    //   گرفته شود و از همان مسیرِ رد برود، نه به‌صورت یک rejectionِ بی‌صاحب.
    await onJoin(session);

    wireAuthRefresh(session, { authority, logger });

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
 * ★★ `0x10 HB_AUTH_REFRESH` — توکنِ تازه روی اتصالِ **باز** (گام ۵٫۱).
 *
 * ⚠️ **تا این گام، این پیام بی‌صدا نادیده گرفته می‌شد.** از گام ۲٫۴ در پروتکل
 * تعریف شده بود ولی `handleMessage`ِ اتاق فقط SYNC/AWARENESS/EPHEMERAL را
 * می‌شناسد و بقیه را `return` می‌کند. یعنی کلاینت می‌توانست بفرستد و هیچ اتفاقی
 * نیفتد — بدترین حالت، چون **شبیهِ کارکردن** است.
 *
 * ── ★ چرا اینجا و نه در `room.ts` ─────────────────────────────────────
 *
 * اتاق `BoardAuthority` را **ندارد و نباید داشته باشد**: کارش سند است، نه
 * هویت. پس این شنونده مستقلاً روی همان سوکت می‌نشیند (`ws` چند شنونده را
 * می‌پذیرد) و اتاق همان‌طور که بود این نوع را نادیده می‌گیرد. مرزِ گام ۴٫۱
 * دست‌نخورده می‌مانَد: احراز هویت یک جاست.
 *
 * ── ★★ سه قیدِ امنیتی ─────────────────────────────────────────────────
 *
 * ۱. **هویت نباید عوض شود.** توکنِ معتبرِ کاربرِ دیگر نباید نشستِ این یکی را
 *    تصاحب کند؛ وگرنه «تازه‌سازی» به یک ارتقای رایگانِ دسترسی تبدیل می‌شود.
 * ۲. **نقش از `effectiveRole` می‌آید، نه از claimِ توکن** ([ADR-012](../../../ARCHITECTURE_DECISIONS.md#adr-012)) —
 *    همان مسیرِ دست‌دادن. وگرنه کاربرِ تنزل‌داده‌شده با یک توکنِ قدیمیِ هنوز
 *    معتبر نقشش را پس می‌گرفت؛ دقیقاً حفره‌ای که گام ۴٫۵ بست.
 * ۳. **ردِ تازه‌سازی اتصال را نمی‌بندد** ([ADR-038](../../../ARCHITECTURE_DECISIONS.md#adr-038)).
 *    نشستِ فعلی از قبل معتبر است و سرور وسطِ کار انقضا را دوباره نمی‌سنجد؛
 *    کشتنِ آن یعنی یک تپقِ گذرای سرویسِ احراز هویت همه را بیرون بیندازد.
 */
type AuthDeps = Pick<HandshakeDeps, "authority" | "logger">;

function wireAuthRefresh(session: RtSession, { authority, logger }: AuthDeps): void {
  session.socket.on("message", (data: ArrayLike<number> | ArrayBuffer) => {
    const bytes = new Uint8Array(data as ArrayBuffer);
    // ⚠️ میان‌برِ تک‌بایتی: `0x10` کمتر از ۱۲۸ است، پس `varUint`ش دقیقاً یک بایت
    //    است. مسیرِ داغِ هر update نباید برای این یک پیام دوباره decode شود.
    if (bytes[0] !== MSG_TYPES.HB_AUTH_REFRESH) return;
    const message = decodeMessage(bytes);
    if (message?.type !== MSG_TYPES.HB_AUTH_REFRESH) return;
    void refreshAuth(session, message.token, { authority, logger });
  });
}

async function refreshAuth(
  session: RtSession,
  token: string,
  { authority, logger }: AuthDeps,
): Promise<void> {
  try {
    const claims = await authority.verify(token, session.boardId);
    if (claims.sub !== session.sub) {
      throw new RtProtocolError(
        "FORBIDDEN",
        "توکنِ تازه مالِ این نشست نیست.",
        "sub در توکنِ تازه با نشستِ جاری نمی‌خواند",
      );
    }

    const role = await effectiveRole(authority, claims);
    session.exp = claims.exp;
    if (role === session.role) return;

    // ★ همان قاعده‌ی `applyRoleChange`: **خودِ نشست** عوض می‌شود، چون
    //   `handleMessage`ِ اتاق روی `session.role` قضاوت می‌کند.
    session.role = role;
    logger.info("نقش با تازه‌سازیِ توکن عوض شد", {
      boardId: session.boardId,
      sub: maskSubject(session.sub),
      role,
    });
    session.socket.send(encodeMessage({ type: MSG_TYPES.HB_PERMISSION, role }));
  } catch (cause) {
    const error =
      cause instanceof RtProtocolError
        ? cause
        : new RtProtocolError("TOKEN_INVALID", "توکنِ تازه پذیرفته نشد.", String(cause));

    logger.warn("تازه‌سازیِ توکن رد شد", {
      boardId: session.boardId,
      sub: maskSubject(session.sub),
      code: error.code,
      detail: error.detail,
    });
    // ⚠️ **بدونِ بستن** — قیدِ ۳ بالا.
    session.socket.send(
      encodeMessage({ type: MSG_TYPES.HB_ERROR, code: error.code, message: error.message }),
    );
  }
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
