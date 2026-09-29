import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

/**
 * پروکسیِ «یک هدر اضافه کن» — ابزارِ اندازه‌گیریِ CSP (M6 ردیفِ ۸٫۵).
 *
 * ★★ **چرا این وجود دارد و چرا `route.fulfill` کافی نبود:** نگارشِ اولِ سنجه هدرِ CSP را با
 * `route.fulfill` روی پاسخِ سند می‌نشاند. تخلف‌ها درست اندازه‌گیری می‌شدند، ولی **وب‌سوکت در
 * هر پالیسی می‌افتاد** و خیلی راحت می‌شد آن را به `connect-src` نسبت داد. علتِ واقعی از دُمِ
 * پیامِ کنسول درآمد:
 *
 *     net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS
 *
 * یعنی **Local Network Access**ِ کروم: پاسخی که playwright می‌سازد IP واقعی ندارد، پس فضای
 * نشانیِ سند «نامعلوم/عمومی» می‌شود و درخواستِ بعدی‌اش به `ws://localhost` می‌شود
 * public→local و بلاک می‌شود. ⇒ **خودِ ابزار رفتار را عوض می‌کرد.**
 *
 * این پروکسی یک سرورِ **واقعیِ** محلی است: هدر را مثلِ `add_header`ِ nginx می‌گذارد، upgradeِ
 * وب‌سوکت را هم رد می‌کند، و هیچ‌چیزِ دیگری را دست نمی‌زند.
 *
 * سیاست در **هر درخواست** از فایل خوانده می‌شود، پس سنجه بینِ پالیسی‌ها ری‌استارت نمی‌خواهد.
 */

const PORT = Number(process.env.CSP_PROXY_PORT ?? "15974");
const UPSTREAM = new URL(process.env.CSP_UPSTREAM ?? "http://127.0.0.1:80");
/**
 * ⚠️⚠️ **نه `import.meta.url`، نه `process.cwd()` — یک مسیرِ مطلقِ ثابت.**
 *
 * سنجه و پروکسی دو **پروسه**اند و باید دقیقاً به یک فایل برسند. هر دو گزینه‌ی دیگر امتحان
 * شدند و هر دو دو مسیرِ متفاوت دادند (playwright فایل‌های TS را از یک پوشه‌ی **کش** اجرا
 * می‌کند و cwdِ پروسه‌ی `webServer` هم همانِ ورکر نیست). نتیجه در هر دو بار یکی بود: هدر
 * هرگز نمی‌نشست و همه‌ی پالیسی‌ها «صفر تخلف» می‌دادند — **سبزِ دروغینِ کامل**.
 * ★ دو چیز گرفتش: خودآزمونِ `connect-src 'none'`، و بعد ادعای صریحِ «هدر روی پاسخِ سند نشست».
 */
export const POLICY_FILE =
  process.env.CSP_POLICY_FILE ?? resolve(tmpdir(), "hamboom-csp-policy.txt");

/** سیاستِ فعال را می‌نویسد — سنجه پیش از هر ناوبری صدایش می‌زند. */
export function writePolicy(policy: string | null): void {
  mkdirSync(dirname(POLICY_FILE), { recursive: true });
  writeFileSync(POLICY_FILE, policy ?? "", "utf8");
}

const upstreamOptions = (req: { method?: string; url?: string; headers: object }) => ({
  host: UPSTREAM.hostname,
  port: UPSTREAM.port === "" ? 80 : Number(UPSTREAM.port),
  method: req.method,
  path: req.url,
  // ⚠️ `host` باید همانِ بالادست بماند، وگرنه nginx به server_blockِ دیگری می‌رود.
  headers: { ...req.headers, host: UPSTREAM.host },
});

const server = createServer((req, res) => {
  if (req.url === "/__csp-proxy-ready") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ready");
    return;
  }
  // ⚠️⚠️ **معیار «درخواست سند است» است، نه «پاسخ HTML است».**
  //    نگارشِ اول روی `content-type: text/html` شرط می‌گذاشت و **بی‌صدا شکست**: مرورگر بعد از
  //    اولین بارگذاری با `If-None-Match` می‌آمد، nginx **۳۰۴** می‌داد (بی `content-type`)، پس هیچ
  //    هدری اضافه نمی‌شد و صفحه با **بدنه‌ی کش‌شده و بدونِ CSP** بالا می‌آمد ⇒ همه‌ی پالیسی‌ها
  //    «صفر تخلف». `no-store` هم اضافه می‌شود تا اصلاً کشی در کار نباشد.
  const wantsHtml = String(req.headers.accept ?? "").includes("text/html");
  const up = httpRequest(upstreamOptions(req), (ur) => {
    const headers = { ...ur.headers };
    if (wantsHtml) {
      let policy = "";
      try {
        policy = readFileSync(POLICY_FILE, "utf8").trim();
      } catch {
        policy = "";
      }
      if (policy.length > 0) headers["content-security-policy"] = policy;
      headers["cache-control"] = "no-store";
      delete headers.etag;
      delete headers["last-modified"];
    }
    res.writeHead(ur.statusCode ?? 502, headers);
    ur.pipe(res);
  });
  up.on("error", (e) => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(String(e));
  });
  req.pipe(up);
});

server.on("upgrade", (req, socket, head) => {
  const up = httpRequest(upstreamOptions(req));
  up.on("upgrade", (ur, upSocket, upHead) => {
    const line = Object.entries(ur.headers)
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join("\r\n");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${line}\r\n\r\n`);
    if (upHead.length > 0) socket.unshift(upHead);
    upSocket.pipe(socket).pipe(upSocket);
  });
  up.on("error", () => socket.destroy());
  up.end(head);
});

// ⊕ وقتی مستقیم اجرا شود سرور را بالا می‌آورد؛ importِ سنجه فقط `writePolicy` را می‌خواهد.
if (process.argv[1] !== undefined && process.argv[1].endsWith("csp-proxy.ts")) {
  writePolicy(null);
  server.listen(PORT, "127.0.0.1", () => {
    // ⊕ `warn` نه `log`: قاعده‌ی no-console فقط `**/*.spec.*` را معاف می‌کند و این فایل یک
    //   **ابزار** است نه spec (P7 — بدونِ PII، فقط نشانی و مسیرِ فایل).
    console.warn(`csp-proxy http://127.0.0.1:${String(PORT)} → ${UPSTREAM.origin} · policy=${POLICY_FILE}`);
  });
}
