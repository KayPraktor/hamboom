/**
 * ★★ گیتِ ۱۶ی `pnpm verify` — **هر جهشِ ادمین ممیزی‌شده است** (M6 فاز ۳٫۷،
 * [ADR-067](../ARCHITECTURE_DECISIONS.md#adr-067) §۲).
 *
 * ── ادعا ─────────────────────────────────────────────────────────────────
 *
 * هر مسیرِ `POST/PATCH/PUT/DELETE` که `buildApp()` زیرِ `/admin` ثبت می‌کند باید با `audited(action)`
 * اعلام شده باشد (`config.audit.action`ِ ناتهی). مسیرِ بی‌اعلام قرمز است — یعنی یک عملِ مخربِ
 * ادمین که کسی یادش رفته ممیزی کند، اصلاً به verify نمی‌رسد، چه برسد به production.
 *
 * ★ منبعِ حقیقت **خودِ اپ** است: collectorِ `onRoute` در `app.ts` هر مسیرِ `/admin` را با اعلامش (یا
 * نبودش) در `app.adminRoutes` جمع می‌کند. نه فهرستِ دستی، نه grep روی سورس.
 *
 * ⚠️ فاز ۳ فقط **اعلام** را می‌سنجد؛ نوشتنِ واقعیِ ردیفِ `audit_logs` در همان تراکنش کارِ فاز ۴ است
 * (`recordAudit`) و آن‌جا با تستِ اتمیک‌بودن اثبات می‌شود. این گیت جلوی «فراموش‌شدن» را می‌گیرد،
 * نه جلوی «اعلامِ بی‌پشتوانه» — و همین را ادعا می‌کند.
 *
 * ── ★ خودآزمون (همیشه، پیش از چکِ واقعی) ─────────────────────────────────
 *
 * ۱. ورودیِ خالص با یک `POST /admin/x`ِ بی‌اعلام ⇒ قرمز؛ `GET` بی‌اعلام ⇒ سبز؛ اعلامِ **تهی** ⇒ قرمز.
 * ۲. **روی اپِ واقعی**: یک `POST /admin/_selftest`ِ عمداً بی‌اعلام بعد از `buildApp` ثبت می‌شود و
 *    باید با همین نام قرمز شود — این collector را هم می‌سنجد، نه فقط تابعِ چک.
 *
 * اجرا: `node scripts/check-admin-audit.ts` (خودآزمون + چک، یک گیت) · فقط خودآزمون: `--self-test`
 */
import { buildApp } from "../apps/api/src/app.ts";
import type { AdminRouteRecord } from "../apps/api/src/app.ts";
import { fakeDb, TEST_CONFIG } from "../apps/api/src/test-fixtures.ts";

const MUTATING = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/** مسیرهای جهشیِ `/admin` که اعلامِ ممیزی ندارند — خالص، برای خودآزمون. */
export function unauditedAdminRoutes(routes: readonly AdminRouteRecord[]): string[] {
  return routes
    .filter((r) => MUTATING.has(r.method) && (r.audit === null || r.audit.trim().length === 0))
    .map((r) => `${r.method} ${r.url}`)
    .sort();
}

async function selfTest(): Promise<boolean> {
  const cases: { name: string; ok: boolean }[] = [];

  cases.push({
    name: "POSTِ بی‌اعلام زیرِ /admin قرمز می‌شود",
    ok:
      unauditedAdminRoutes([{ method: "POST", url: "/admin/x", audit: null }]).join() ===
      "POST /admin/x",
  });
  cases.push({
    name: "GETِ بی‌اعلام تخلف نیست (خواندن ممیزی نمی‌خواهد)",
    ok: unauditedAdminRoutes([{ method: "GET", url: "/admin/me", audit: null }]).length === 0,
  });
  cases.push({
    name: "اعلامِ **تهی** هم قرمز است (audited('') نمی‌تواند از گیت رد شود)",
    ok:
      unauditedAdminRoutes([{ method: "DELETE", url: "/admin/y", audit: " " }]).join() ===
      "DELETE /admin/y",
  });
  cases.push({
    name: "مسیرِ اعلام‌شده سبز است (منفیِ کاذب ندارد)",
    ok:
      unauditedAdminRoutes([{ method: "PATCH", url: "/admin/z", audit: "user.suspend" }])
        .length === 0,
  });

  // ★ روی اپِ واقعی: collector باید مسیرِ عمدیِ بی‌اعلام را ببیند.
  const app = await buildApp({
    config: TEST_CONFIG,
    db: fakeDb(() => Promise.resolve({ rows: [] })),
  });
  app.post("/admin/_selftest", () => ({ ok: true }));
  await app.ready();
  const found = unauditedAdminRoutes(app.adminRoutes);
  await app.close();
  cases.push({
    name: "★ collectorِ onRoute مسیرِ عمداً بی‌اعلامِ اپِ واقعی را می‌بیند",
    // ⚠️ `includes` نه «دقیقاً یکی»: اگر مسیرِ واقعی‌ای هم بی‌اعلام باشد، باید چکِ **اصلی** با نامِ
    //    همان مسیر قرمز شود، نه اینکه خودآزمون جلوتر با پیامِ گمراه‌کننده بیفتد (آزموده شد).
    ok: found.includes("POST /admin/_selftest"),
  });

  for (const c of cases) console.log(`${c.ok ? "✔" : "✖"} خودآزمون: ${c.name}`);
  return cases.every((c) => c.ok);
}

async function main(): Promise<void> {
  if (!(await selfTest())) {
    console.error("\n✖ خودآزمون شکست — این گیت به خودش هم اعتماد ندارد.");
    process.exit(1);
  }
  if (process.argv.includes("--self-test")) {
    console.log("\n✔ خودآزمون: مسیرِ بی‌اعلام قرمز شد، هم خالص هم روی اپِ واقعی.");
    return;
  }

  const app = await buildApp({
    config: TEST_CONFIG,
    db: fakeDb(() => Promise.resolve({ rows: [] })),
  });
  await app.ready();
  const routes = [...app.adminRoutes];
  await app.close();

  const mutating = routes.filter((r) => MUTATING.has(r.method));
  const problems = unauditedAdminRoutes(routes);
  console.log(
    `\nمسیرهای /admin: ${routes.length} · جهشی: ${mutating.length} · ` +
      `اعلام‌شده: ${mutating.map((r) => `${r.method} ${r.url} → ${r.audit ?? "—"}`).join("، ") || "—"}`,
  );
  if (problems.length > 0) {
    for (const p of problems) console.error(`✖ جهشِ ادمینِ بدونِ audited(): ${p}`);
    console.error("\n✖ هر POST/PATCH/PUT/DELETE زیرِ /admin باید با audited(action) ثبت شود (ADR-067 §۲).");
    process.exit(1);
  }
  console.log("✔ هر جهشِ /admin اعلامِ ممیزی دارد.");
}

await main();
