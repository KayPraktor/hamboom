/**
 * ★★ گیتِ M5 گام ۲٫۳ — **پروکسی از مسیرهای واقعیِ api عقب نمانَد.**
 *
 * ── چرا این گیت وجود دارد ────────────────────────────────────────────────
 *
 * در فاز ۹ی M4 دو نقصِ مسیر فقط با **اجرای واقعی در مرورگر** پیدا شدند: یک پیشوندِ
 * `/api/v1` که هیچ‌جای api ثبت نمی‌شد. هیچ تستی نگرفتشان، چون هیچ‌کس فهرستِ دستیِ
 * پروکسی را با مسیرهای واقعی مقایسه نمی‌کرد. در dev نتیجه‌اش یک ۴۰۴ی توسعه‌دهنده
 * بود؛ در production نتیجه‌اش این است که **کاربر به‌جای JSON، `index.html` می‌گیرد**
 * و کلاینت با یک خطای پارسِ گنگ می‌شکند — دقیقاً همان کلاسِ نقص، این‌بار روی
 * کاربرِ واقعی. TODOی M5 همین را «تله‌ی ثبت‌شده» نامیده.
 *
 * ── دو ادعا ──────────────────────────────────────────────────────────────
 *
 * **الف)** هر مسیری که `buildApp()` واقعاً ثبت می‌کند، در `API_PREFIXES` پوشیده است
 *     — و هر پیشوند دستِ‌کم یک مسیرِ واقعی دارد (پس فهرست نه ناقص است نه مرده).
 *     ★ منبعِ حقیقت **خودِ اپ** است (`app.registeredRoutes`)، نه یک فهرستِ دستیِ
 *     دوم که خودش هم می‌تواند کهنه شود.
 *
 * **ب)** [`infra/nginx/api-locations.conf`](../infra/nginx/api-locations.conf) دقیقاً
 *     همان چیزی است که از `API_PREFIXES` تولید می‌شود. یعنی پروکسیِ production و
 *     پروکسیِ dev **با ساخت** یکی‌اند، نه با مراقبت.
 *
 * ── ★ خودآزمون ───────────────────────────────────────────────────────────
 *
 * `--self-test` هر دو مقایسه را با ورودیِ عمداً خرابِ ساختگی می‌راند و انتظار دارد
 * **قرمز** شوند. بدونِ این، یک گیت فقط ادعا می‌کند که گیت است (درسِ M2 گام ۴٫۷).
 *
 * اجرا: `pnpm infra:check-proxy` · بازتولید: `pnpm infra:check-proxy -- --write`
 * ★ داخلِ `pnpm verify` هم هست — چون گیتی که فقط دستی اجرا شود، اجرا نمی‌شود.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildApp } from "../apps/api/src/app.ts";
import { fakeDb, TEST_CONFIG } from "../apps/api/src/test-fixtures.ts";
import { API_PREFIXES, NEVER_PROXIED } from "../apps/web/src/api-prefixes.ts";

const NGINX_CONF = fileURLToPath(new URL("../infra/nginx/api-locations.conf", import.meta.url));

/** مسیرِ `route` را پیشوندِ `prefix` می‌پوشاند اگر برابرش باشد یا زیرشاخه‌اش. */
const covers = (prefix: string, route: string): boolean =>
  route === prefix || route.startsWith(`${prefix}/`);

/**
 * تولیدِ بلوک‌های `location`ِ nginx از فهرستِ پیشوندها.
 *
 * ⚠️ عمداً **تولید** می‌شود و دستی نوشته نمی‌شود: یک فایلِ دستی همان فهرستِ دومی است
 * که این گیت برای وجودنداشتنش ساخته شده. مرتب‌سازی برای پایداریِ خروجی است؛ nginx
 * خودش طولانی‌ترین پیشوند را انتخاب می‌کند، پس ترتیب اثری بر رفتار ندارد.
 */
export function renderNginxLocations(prefixes: readonly string[]): string {
  const header = [
    "# ⚠️ فایلِ **تولیدشده** — دستی ویرایشش نکن.",
    "#",
    "# منبع: apps/web/src/api-prefixes.ts · تولید: pnpm infra:check-proxy -- --write",
    "# گیت: pnpm infra:check-proxy (داخلِ pnpm verify)",
    "#",
    "# هر پیشوند به upstreamِ api می‌رود؛ هر چیزِ دیگری به SPA (بلوکِ `location /`).",
    "",
  ];
  const blocks = [...prefixes]
    .sort()
    .map((p) =>
      [
        `location ${p} {`,
        "    proxy_pass http://hamboom_api;",
        "    include /etc/nginx/proxy-common.conf;",
        "}",
        "",
      ].join("\n"),
    );
  return `${header.join("\n")}${blocks.join("\n")}`;
}

interface Problem {
  claim: string;
  detail: string;
}

/** ادعای الف — فهرست در برابرِ مسیرهای واقعیِ ثبت‌شده. */
export function checkPrefixesAgainstRoutes(
  prefixes: readonly string[],
  routes: readonly string[],
  excluded: readonly string[] = [],
): Problem[] {
  const problems: Problem[] = [];
  // مسیرها به شکلِ «METHOD /url» می‌آیند؛ فقط بخشِ url مهم است.
  const urls = [...new Set(routes.map((r) => r.slice(r.indexOf(" ") + 1)))].sort();

  // ★ مسیرهای **عمداً** مستثنا (مثلِ `/metrics`) نه پوشیده لازم‌اند و نه تخلف.
  //   ⚠️ ولی اگر روزی مسیرشان حذف شود، پایین به‌عنوانِ «استثنای مرده» گرفته می‌شوند.
  const deadExclusions = excluded.filter((e) => !urls.some((u) => covers(e, u)));
  if (deadExclusions.length > 0) {
    problems.push({
      claim: "استثنای بدونِ مسیر",
      detail: `${deadExclusions.join("، ")} در NEVER_PROXIED است ولی هیچ مسیری ندارد`,
    });
  }

  const uncovered = urls.filter(
    (u) => !prefixes.some((p) => covers(p, u)) && !excluded.some((e) => covers(e, u)),
  );
  if (uncovered.length > 0) {
    problems.push({
      claim: "مسیرِ ثبت‌شده‌ای که پروکسی نمی‌بیندش",
      detail: `${uncovered.join("، ")} ⇒ کلاینت به‌جای JSON صفحه‌ی SPA می‌گیرد`,
    });
  }

  const dead = prefixes.filter((p) => !urls.some((u) => covers(p, u)));
  if (dead.length > 0) {
    problems.push({
      claim: "پیشوندی که هیچ مسیرِ واقعی ندارد",
      detail: `${dead.join("، ")} ⇒ یا مسیرش حذف شده یا اصلاً پیشوندِ URL نبوده`,
    });
  }
  return problems;
}

/** ادعای ب — فایلِ nginx در برابرِ بازتولید از همان فهرست. */
export function checkNginxFile(expected: string, actual: string): Problem[] {
  if (expected === actual) return [];
  return [
    {
      claim: "فایلِ nginx با فهرست نمی‌خوانَد",
      detail: "با `pnpm infra:check-proxy -- --write` بازتولیدش کن و diff را ببین",
    },
  ];
}

/**
 * ★ خودآزمون — هر دو مقایسه با ورودیِ **عمداً خراب**، و هر دو باید قرمز شوند.
 *
 * ⚠️ ورودی‌ها ساختگی‌اند و به فهرستِ واقعی دست نمی‌زنند: یک خودآزمون که برای اثباتِ
 * خودش فایلِ واقعی را خراب کند، اولین باری که وسطِ کار بیفتد ریپو را خراب می‌گذارد.
 */
function selfTest(): boolean {
  const cases: { name: string; ok: boolean }[] = [];

  cases.push({
    name: "مسیرِ پوشیده‌نشده گرفته می‌شود",
    ok: checkPrefixesAgainstRoutes(["/auth"], ["GET /auth/x", "POST /public/boards/resolve"]).some(
      (p) => p.detail.includes("/public/boards/resolve"),
    ),
  });
  cases.push({
    name: "پیشوندِ مرده گرفته می‌شود",
    ok: checkPrefixesAgainstRoutes(["/auth", "/links"], ["GET /auth/x"]).some((p) =>
      p.detail.includes("/links"),
    ),
  });
  cases.push({
    name: "پیشوندِ درست قرمز نمی‌شود (منفیِ کاذب ندارد)",
    ok: checkPrefixesAgainstRoutes(["/api/v1"], ["GET /api/v1/docs"]).length === 0,
  });
  cases.push({
    name: "★ مسیرِ عمداً مستثنا تخلف شمرده نمی‌شود",
    ok:
      checkPrefixesAgainstRoutes(["/auth"], ["GET /auth/x", "GET /metrics"], ["/metrics"])
        .length === 0,
  });
  cases.push({
    name: "★★ ولی استثنای **مرده** گرفته می‌شود (مسیرش حذف شده)",
    ok: checkPrefixesAgainstRoutes(["/auth"], ["GET /auth/x"], ["/metrics"]).some((p) =>
      p.claim.includes("استثنا"),
    ),
  });
  cases.push({
    name: "دریفتِ فایلِ nginx گرفته می‌شود",
    ok:
      checkNginxFile(renderNginxLocations(["/auth"]), renderNginxLocations(["/auth", "/me"]))
        .length === 1,
  });

  for (const c of cases) console.log(`${c.ok ? "✔" : "✖"} خودآزمون: ${c.name}`);
  return cases.every((c) => c.ok);
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");

  if (process.argv.includes("--self-test")) {
    if (!selfTest()) {
      console.error("\n✖ خودآزمون شکست — این گیت به خودش هم اعتماد ندارد.");
      process.exit(1);
    }
    console.log("\n✔ خودآزمون: هر دو مقایسه با ورودیِ خراب قرمز شدند.");
    return;
  }

  // ★ اپِ واقعی، با db/درگاهِ دروغین — بدونِ شبکه و بدونِ Postgres.
  const app = await buildApp({
    config: TEST_CONFIG,
    db: fakeDb(() => Promise.resolve({ rows: [] })),
  });
  const routes = [...app.registeredRoutes];
  await app.close();

  const expected = renderNginxLocations(API_PREFIXES);
  if (write) {
    writeFileSync(NGINX_CONF, expected, "utf8");
    console.log(`✔ بازتولید شد: ${NGINX_CONF}`);
  }

  const actual = readFileSync(NGINX_CONF, "utf8").replace(/\r\n/g, "\n");
  const excluded = NEVER_PROXIED.map((e) => e.prefix);
  const problems = [
    ...checkPrefixesAgainstRoutes(API_PREFIXES, routes, excluded),
    ...checkNginxFile(expected, actual),
  ];

  console.log(
    `مسیرهای ثبت‌شده: ${routes.length} · پیشوندها: ${API_PREFIXES.length} · ` +
      `مستثنای عمدی: ${excluded.length} (${excluded.join("، ")})`,
  );
  if (problems.length > 0) {
    for (const p of problems) console.error(`✖ ${p.claim}\n    ${p.detail}`);
    console.error("\n✖ پروکسی با api نمی‌خوانَد.");
    process.exit(1);
  }
  console.log("✔ هر مسیرِ api پوشیده است، هیچ پیشوندِ مرده‌ای نیست، و nginx با فهرست یکی است.");
}

await main();
