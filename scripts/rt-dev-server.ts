import { createServer } from "node:http";

import {
  createDevBoardAuthority,
  createRoomManager,
  createRtServer,
  MemoryBoardBus,
  MemoryOwnerLock,
  MemoryUpdateLog,
  signDevToken,
} from "@hamboom/realtime";
import { MemoryBoardStore } from "@hamboom/realtime";

/**
 * سرورِ realtimeِ **بدونِ زیرساخت** — برای دمو و E2E.
 *
 * ── چرا کنارِ `apps/realtime/src/main.ts` وجود دارد ────────────────────
 *
 * `main.ts` نودِ واقعی است: Postgres، Redis، فایل‌سیستم. برای یک تستِ مرورگر
 * که می‌خواهد فقط **رفتارِ آفلاینِ کلاینت** را بسنجد، آوردنِ داکر به مسیرِ E2E
 * سه هزینه دارد و هیچ‌کدام لازم نیست: کندی، وابستگی به محیط، و یک نقطه‌ی
 * شکستِ بی‌ربط.
 *
 * پس اینجا **همه‌ی پیاده‌سازی‌های حافظه‌ای** به هم وصل می‌شوند — همان‌هایی که
 * تست‌های واحدِ گام‌های ۴٫۲ تا ۴٫۷ رویشان نوشته شده‌اند. سرور، پروتکل، اتاق و
 * مجوز **همان کدِ محصولی** اند؛ فقط انبار در حافظه است.
 *
 * ⚠️ **و این یعنی با هر ری‌استارت، بورد خالی بالا می‌آید.** برای تستِ گام ۵٫۲
 * این نه اشکال که **مزیت** است: اگر بعد از ری‌استارت استیکی‌ها روی سرور دیده
 * شوند، تنها منبعِ ممکنشان کلاینتی است که آفلاین ساخته‌شان.
 *
 * ── ★ نقطه‌ی توکن ─────────────────────────────────────────────────────
 *
 * `GET /dev-token?board=<id>&sub=<id>&role=<role>` یک `rtToken` امضاشده
 * می‌دهد. شکلش عمداً همان چیزی است که M3 باید بسازد (PLAN بخش ۵٫۳)، و مزیتش
 * برای همین گام این است که مرورگر **واقعاً برای هر تلاش یک توکنِ تازه**
 * می‌گیرد — همان چیزی که [ADR-039](../ARCHITECTURE_DECISIONS.md#adr-039)
 * الزام کرده.
 *
 * ⚠️ رازِ توسعه اینجا **ثابت و عمومی** است. `DevBoardAuthority` با
 * `APP_ENV=production` اصلاً بالا نمی‌آید (ADR-031) و این اسکریپت هم همان گیت
 * را از سرِ راهش برنمی‌دارد.
 *
 * اجرا:
 *   node scripts/rt-dev-server.ts            # ۱۵۳۰۰ و ۱۵۳۰۱
 *   node scripts/rt-dev-server.ts 16000      # ۱۶۰۰۰ و ۱۶۰۰۱
 */

const SECRET = "hamboom-dev-only-secret-at-least-32-chars";
const DEFAULT_PORT = 15_300;
/** عمرِ توکن — کوتاه، تا مسیرِ «توکنِ تازه برای هر تلاش» واقعاً پیموده شود. */
const TOKEN_TTL_SECONDS = 60;

const port = Number(process.argv[2] ?? DEFAULT_PORT);
const tokenPort = port + 1;

const rooms = createRoomManager({
  store: new MemoryBoardStore(),
  log: new MemoryUpdateLog(),
  bus: new MemoryBoardBus(),
  ownerLock: new MemoryOwnerLock("dev-node"),
  nodeId: "dev-node",
  limits: { maxRoomsPerNode: 50, maxDocBytes: 52_428_800, idleTimeoutMs: 120_000 },
});

const server = await createRtServer({
  authority: createDevBoardAuthority({ secret: SECRET }),
  appEnv: "local",
  port,
  onJoin: (session) => rooms.join(session),
});

const tokens = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  // ⚠️ فقط برای توسعه: صفحه‌ی دمو روی پورتِ دیگری سرو می‌شود.
  response.setHeader("access-control-allow-origin", "*");

  if (url.pathname !== "/dev-token") {
    response.writeHead(404).end();
    return;
  }

  const boardId = url.searchParams.get("board");
  if (!boardId) {
    response.writeHead(400).end("board لازم است");
    return;
  }

  response.writeHead(200, { "content-type": "text/plain" }).end(
    signDevToken(
      {
        sub: url.searchParams.get("sub") ?? "usr_dev",
        boardId,
        role: (url.searchParams.get("role") ?? "editor") as "editor",
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
      },
      SECRET,
    ),
  );
});

await new Promise<void>((resolve) => tokens.listen(tokenPort, "127.0.0.1", resolve));

// ★ خطِ آخر ثابت است تا صداکننده (E2E) بتواند «بالا آمد» را تشخیص بدهد.
process.stdout.write(`rt-dev-server ws=${String(server.port)} token=${String(tokenPort)}\n`);

const stop = (): void => {
  void (async () => {
    await server.close();
    await rooms.close();
    tokens.close();
    process.exit(0);
  })();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
