import { createServer, request as httpRequest } from "node:http";

/**
 * انبارِ **سخت‌گیر** — یک پروکسیِ واقعی جلوی MinIO که CORSِ آن را به شکلِ یک S3ِ واقعی درمی‌آورد
 * (M6 ردیفِ ۸٫۶، ریشه‌ی باگِ تصویر).
 *
 * ★★ **چرا وجود دارد:** باگِ «قابِ خالی» فقط روی آروان دیده می‌شد و روی MinIO هرگز — در هیچ تستی،
 * حتی روی باندلِ production. علت اندازه‌گیری شد، نه حدس: MinIO به **هر** پاسخی
 *
 *     Access-Control-Allow-Credentials: true
 *
 * می‌چسباند و مبدأ را هم بازتاب می‌دهد؛ آروان (مثلِ بیشترِ S3های واقعی) فقط
 * `Access-Control-Allow-Origin` می‌دهد. خواندنِ بایتِ تصویر یک `fetch` با `credentials: "include"`
 * بود که از `/assets/:id` به انبار **ری‌دایرکت** می‌شود؛ در آن حالت مرورگر پاسخِ بدونِ آن هدر را
 * دور می‌ریزد (`TypeError: Failed to fetch`). یعنی **سخاوتِ MinIO باگ را در همه‌ی محیط‌های ما
 * پنهان می‌کرد**، و هیچ تستی که مستقیم به MinIO بزند نمی‌تواند این کلاس را ببیند.
 *
 * این پروکسی همان تفاوت را برمی‌دارد: هدرهایی را که آروان **نمی‌دهد** حذف می‌کند، و به preflightی
 * که هدرِ `authorization` بخواهد همان ۴۰۳ی بی‌هدر را می‌دهد که روی باکتِ زنده اندازه‌گیری شد.
 *
 * ⚠️⚠️ **`host` دست‌نخورده به بالادست می‌رود** — برعکسِ `csp-proxy.ts`. امضای SigV4 روی هدرِ `host`
 * است؛ کلاینتِ S3 برای نشانیِ **همین پروکسی** امضا کرده، پس MinIO باید همان را ببیند، وگرنه هر
 * درخواستِ امضاشده `SignatureDoesNotMatch` می‌گیرد.
 *
 * ⚠️ چرا پروکسیِ واقعی و نه `page.route`: playwright درخواستِ **ری‌دایرکت‌شده** را اصلاً به
 * handlerِ route نمی‌دهد — و هاپِ انبار دقیقاً یک ری‌دایرکت است. (و درسِ ۸٫۵: پاسخِ ساختگی رفتارِ
 * مرورگر را عوض می‌کند.)
 *
 * `STORAGE_PROXY_PASSTHROUGH=1` هدرها را دست نمی‌زند — فقط برای **شکستنِ عمدیِ** خودِ این ابزار:
 * با آن، سنجه باید روی «انبار سخت‌گیر نیست» قرمز شود.
 */

const PORT = Number(process.env.STORAGE_PROXY_PORT ?? "15977");
const UPSTREAM = new URL(process.env.STORAGE_PROXY_UPSTREAM ?? "http://127.0.0.1:9000");
const PASSTHROUGH = process.env.STORAGE_PROXY_PASSTHROUGH === "1";

/** هدرهایی که MinIO می‌دهد و باکتِ آروان (اندازه‌گیری‌شده) نمی‌دهد. */
const NOT_ON_REAL_S3 = ["access-control-allow-credentials", "access-control-expose-headers"];

const server = createServer((req, res) => {
  if (req.url === "/__storage-proxy-ready") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(PASSTHROUGH ? "passthrough" : "strict");
    return;
  }

  // آروان: preflightی که `authorization` بخواهد ⇒ ۴۰۳ بدونِ هیچ هدرِ CORS (اندازه‌گیری‌شده).
  // MinIO همان را ۲۰۴ می‌دهد و هر هدری را مجاز می‌کند.
  const wanted = String(req.headers["access-control-request-headers"] ?? "").toLowerCase();
  if (!PASSTHROUGH && req.method === "OPTIONS" && wanted.includes("authorization")) {
    res.writeHead(403, { vary: "Accept-Encoding" });
    res.end();
    return;
  }

  const headers = { ...req.headers };
  // به کلاینت خودمان «ادامه بده» گفته‌ایم (رفتارِ پیش‌فرضِ node)؛ دوباره‌خواستنش از بالادست فقط تاخیر است.
  delete headers.expect;
  const up = httpRequest(
    {
      host: UPSTREAM.hostname,
      port: UPSTREAM.port === "" ? 80 : Number(UPSTREAM.port),
      method: req.method,
      path: req.url,
      headers, // ← `host` عمداً همان است که کلاینت فرستاد (SigV4).
    },
    (ur) => {
      const out = { ...ur.headers };
      if (!PASSTHROUGH) for (const name of NOT_ON_REAL_S3) delete out[name];
      res.writeHead(ur.statusCode ?? 502, out);
      ur.pipe(res);
    },
  );
  up.on("error", (e) => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(String(e));
  });
  req.pipe(up);
});

// ⊕ `0.0.0.0` و نه `127.0.0.1`: کانتینرهای api و realtime هم از راهِ `host.docker.internal` به همین می‌رسند.
server.listen(PORT, "0.0.0.0", () => {
  // ⊕ `warn` نه `log`: قاعده‌ی no-console فقط `**/*.spec.*` را معاف می‌کند و این یک ابزار است (بدونِ PII).
  console.warn(
    `storage-cors-proxy :${String(PORT)} → ${UPSTREAM.origin} · ${PASSTHROUGH ? "PASSTHROUGH (شکستنِ عمدی)" : "strict"}`,
  );
});
