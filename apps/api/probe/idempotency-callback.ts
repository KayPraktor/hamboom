/**
 * probeِ فاز ۱ی M4 — گام ۱٫۳: **کِی** میان‌افزارِ `Idempotency-Key` واقعاً اجرا می‌شود؟
 *
 * ── چرا این probe ─────────────────────────────────────────────────────
 *
 * [`idempotency.ts`](../src/idempotency.ts) دو گاردِ زودهنگام دارد: روی هر درخواستِ
 * **غیر-POST** و روی هر درخواستِ **بدونِ هدرِ `Authorization`** بی‌صدا `return` می‌کند.
 * و callbackِ زرین‌پال (`GET /billing/zarinpal/callback?Authority=…&Status=OK`) دقیقاً
 * **هر دو** است — یک GETِ مرورگر بدونِ توکن.
 *
 * خطر این نیست که حفاظی نداریم؛ این است که حفاظ **به‌نظر می‌رسد** داریم. یک session
 * که می‌بیند «api از قبل idempotency دارد» callback را وصل می‌کند و هر رفرشِ مرورگر
 * یک اشتراک را دوباره فعال می‌کند — بدونِ هیچ خطایی در هیچ لاگی.
 *
 * این probe ادعا نمی‌کند؛ **می‌شمارد** که handler چند بار اجرا شد. چهار ترکیب را
 * می‌سنجد تا دقیقاً معلوم شود کدام گارد مقصر است:
 *
 *   | متد | `Authorization` | انتظار |
 *   |---|---|---|
 *   | GET  | ندارد | ۲ اجرا — **شکلِ callbackِ زرین‌پال** |
 *   | GET  | دارد  | ۲ اجرا — پس گاردِ «غیر-POST» به‌تنهایی کافی است |
 *   | POST | ندارد | ۲ اجرا — پس گاردِ «بدونِ auth» هم به‌تنهایی کافی است |
 *   | POST | دارد  | **۱ اجرا** + هدرِ `idempotent-replay` — یعنی میان‌افزار سالم است |
 *
 * ★ ردیفِ آخر خودآزمونِ probe است: اگر آن هم ۲ می‌شد، یعنی probe اصلاً میان‌افزار را
 *   صدا نمی‌زند و سه ردیفِ دیگر بی‌معنا بودند.
 *
 * از `app.inject()` استفاده می‌کند، پس نه پورت لازم دارد نه دیتابیس.
 *
 * اجرا: `pnpm billing:probe-idem`
 */
import Fastify from "fastify";

import { registerIdempotency } from "../src/idempotency.ts";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const KEY = "11111111-2222-3333-4444-555555555555";
const TOKEN = "Bearer probe-token-not-a-real-jwt";

interface Probe {
  /** چند بار handler واقعاً اجرا شد. */
  runs: number;
  /** آیا پاسخِ دوم از کش آمد؟ */
  replayed: boolean;
}

/** یک اپِ تازه می‌سازد، دو بار همان درخواست را می‌زند، و اجراها را می‌شمارد. */
async function runTwice(method: "GET" | "POST", withAuth: boolean): Promise<Probe> {
  const app = Fastify();
  let runs = 0;

  registerIdempotency(app, { ttlMs: 60_000 });

  const handler = async (): Promise<{ ok: true; run: number }> => {
    runs += 1;
    return { ok: true, run: runs };
  };
  app.get("/probe", handler);
  app.post("/probe", handler);

  const headers: Record<string, string> = { "idempotency-key": KEY };
  if (withAuth) headers.authorization = TOKEN;

  await app.inject({ method, url: "/probe", headers });
  const second = await app.inject({ method, url: "/probe", headers });
  await app.close();

  return { runs, replayed: second.headers["idempotent-replay"] === "true" };
}

async function main(): Promise<void> {
  const results: CheckResult[] = [];

  // ── ۱. شکلِ واقعیِ callbackِ زرین‌پال: GET، بدونِ auth ───────────────
  const callback = await runTwice("GET", false);
  results.push({
    name: "۱٫۳ (B-1) ★ — شکلِ callbackِ زرین‌پال (GET بدونِ auth): میان‌افزار **اجرا نمی‌شود**",
    ok: callback.runs === 2 && !callback.replayed,
    detail:
      callback.runs === 2
        ? `handler ${callback.runs} بار اجرا شد و هیچ پاسخی replay نشد ⇒ هر رفرشِ مرورگر یک فعال‌سازیِ دوباره.\n` +
          "    ★ پس تنها حفاظِ ممکن، قفلِ ردیفِ `payments` است (ADR-050) — نه این میان‌افزار."
        : `انتظار: ۲ اجرا. واقعی: ${callback.runs} (replay=${callback.replayed})`,
  });

  // ── ۲. کدام گارد مقصر است؟ هرکدام به‌تنهایی کافی است ────────────────
  const getWithAuth = await runTwice("GET", true);
  results.push({
    name: "۱٫۳ — گاردِ «غیر-POST» به‌تنهایی کافی است (GET **با** auth)",
    ok: getWithAuth.runs === 2,
    detail:
      getWithAuth.runs === 2
        ? "حتی با توکنِ معتبر هم GET اصلاً کش نمی‌شود ⇒ افزودنِ auth به callback مسئله را حل نمی‌کند"
        : `انتظار: ۲ اجرا. واقعی: ${getWithAuth.runs}`,
  });

  const postNoAuth = await runTwice("POST", false);
  results.push({
    name: "۱٫۳ — گاردِ «بدونِ auth» هم به‌تنهایی کافی است (POST بدونِ auth)",
    ok: postNoAuth.runs === 2,
    detail:
      postNoAuth.runs === 2
        ? "حتی POST هم بدونِ هدرِ auth کش نمی‌شود ⇒ تبدیلِ callback به POST هم مسئله را حل نمی‌کند"
        : `انتظار: ۲ اجرا. واقعی: ${postNoAuth.runs}`,
  });

  // ── ۳. ★ خودآزمون: در حالتِ طراحی‌شده میان‌افزار واقعاً کار می‌کند ────
  const designed = await runTwice("POST", true);
  results.push({
    name: "۱٫۳ خودآزمون — در حالتِ طراحی‌شده (POST + auth) میان‌افزار **کار می‌کند**",
    ok: designed.runs === 1 && designed.replayed,
    detail:
      designed.runs === 1 && designed.replayed
        ? "handler ۱ بار اجرا شد و پاسخِ دوم با `idempotent-replay: true` برگشت ⇒ probe واقعاً میان‌افزار را صدا می‌زند و سه چکِ بالا معنا دارند"
        : `انتظار: ۱ اجرا + replay. واقعی: ${designed.runs} اجرا، replay=${designed.replayed}`,
  });

  for (const r of results) console.log(`${r.ok ? "✔" : "✖"} ${r.name}\n    ${r.detail}`);

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\n✖ ${failed.length} چک قرمز شد.`);
    process.exit(1);
  }
  console.log(
    "\n✔ ۱٫۳ اثبات شد: میان‌افزارِ `Idempotency-Key` روی شکلِ callbackِ درگاه اجرا نمی‌شود.",
  );
}

await main();
