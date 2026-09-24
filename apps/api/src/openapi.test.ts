import { describe, expect, it } from "vitest";
import { z } from "zod";

import { buildApp } from "./app.ts";
import {
  buildOpenApiDocument,
  documentedRoutes,
  internalOpenApiPaths,
  internalSchemaNames,
  publicSpecProblems,
  routeDrift,
  type RouteDoc,
} from "./openapi.ts";
import { fakeDb, TEST_CONFIG } from "./test-fixtures.ts";

/** همه‌ی رشته‌های `$ref` را از درختِ سند جمع می‌کند. */
function collectRefs(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const x of node) collectRefs(x, out);
    return;
  }
  if (node !== null && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "$ref" && typeof v === "string") out.push(v);
      else collectRefs(v, out);
    }
  }
}

type Doc = {
  openapi: string;
  info: { title: string };
  paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
  components: Record<string, Record<string, unknown>>;
};

describe("سندِ OpenAPI 3.1", () => {
  const doc = buildOpenApiDocument() as unknown as Doc;

  it("ساختارِ پایه معتبر است", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBeTruthy();
    expect(Object.keys(doc.paths).length).toBeGreaterThan(20);
  });

  it("هر operation پاسخ دارد", () => {
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        expect(Object.keys(op.responses ?? {}).length, `${method} ${path}`).toBeGreaterThan(0);
      }
    }
  });

  it("★ هر $ref به یک component موجود اشاره می‌کند (بدونِ رفرنسِ شکسته)", () => {
    const refs: string[] = [];
    collectRefs(doc, refs);
    expect(refs.length).toBeGreaterThan(10);
    for (const ref of refs) {
      const m = /^#\/components\/(schemas|responses)\/(.+)$/.exec(ref);
      expect(m, `شکلِ نامعتبرِ ref: ${ref}`).not.toBeNull();
      const kind = m![1]!;
      const name = m![2]!;
      expect(doc.components[kind]?.[name], `refِ شکسته: ${ref}`).toBeTruthy();
    }
  });
});

/**
 * ★★ مسیرهایی که **عمداً** در سندِ عمومیِ API نیستند — M5 گام ۵٫۲.
 *
 * ⚠️ `GET /openapi.json` و `GET /api/v1/docs` **عمومی**اند. مستندکردنِ یک مسیرِ
 * عملیاتی در آن سند، یعنی تبلیغِ چیزی که [ADR-061](../../../ARCHITECTURE_DECISIONS.md#adr-061)
 * گفته نباید عمومی باشد. ولی «فقط از فهرست بیرونش بگذار» هم غلط است — آن‌وقت گارد
 * ضعیف می‌شود. پس مثلِ `NEVER_PROXIED`: استثنای **صریح**، با دلیل.
 */
const NOT_IN_PUBLIC_SPEC: Record<string, string> = {
  "GET /metrics": "ADR-061: رصدپذیری عمومی نیست؛ فقط از شبکه‌ی داخلیِ compose",
};

describe("★ گاردِ دریفتِ OpenAPI — هر مسیرِ ثبت‌شده مستند است", () => {
  it("routeهای ثبت‌شده و documentedRoutes دقیقاً یکی‌اند", async () => {
    const app = await buildApp({
      config: TEST_CONFIG,
      db: fakeDb(() => Promise.resolve({ rows: [] })),
    });
    const drift = routeDrift(
      app.registeredRoutes,
      documentedRoutes(),
      new Set(Object.keys(NOT_IN_PUBLIC_SPEC)),
    );
    // ⚠️ استثنا باید **زنده** بماند: اگر مسیرش حذف شود، این‌جا قرمز می‌شود.
    expect(drift.deadExceptions, "استثنای مرده").toEqual([]);
    expect(drift.undocumented, "مسیرهای ثبت‌شده‌ی بی‌سند").toEqual([]);
    expect(drift.unregistered, "مسیرهای مستندِ ثبت‌نشده").toEqual([]);
    // ★ مسیرهای `/admin` واقعاً در گارد **هستند** (وگرنه internal یعنی «نامرئی»، نه «داخلی»).
    expect(app.registeredRoutes.some((r) => r.startsWith("GET /admin/"))).toBe(true);
    expect([...documentedRoutes()].some((r) => r.startsWith("GET /admin/"))).toBe(true);
    await app.close();
  });
});

/**
 * ★★ سه خودآزمونِ ADR-067 §۵ — هر کدام یک **شکستنِ عمدی** که باید قرمز شود، کنارِ اثباتِ سبزِ سندِ واقعی.
 *
 * ⚠️ بدونِ این‌ها، «internal» فقط یک پرچم است که کسی نمی‌داند اگر برداشته شود چه می‌شود (درسِ M2 گام ۴٫۷).
 */
describe("★★ مسیرهای داخلی (ADR-067 §۵) — سه شکستنِ عمدی", () => {
  const INTERNAL_PATHS = internalOpenApiPaths();
  const INTERNAL_SCHEMAS = internalSchemaNames();

  it("سندِ واقعی: هیچ مسیر/schema/تگِ داخلی در سندِ عمومی نیست", () => {
    expect(INTERNAL_PATHS.length).toBeGreaterThan(0);
    expect(INTERNAL_SCHEMAS.length).toBeGreaterThan(0);
    expect(publicSpecProblems(buildOpenApiDocument(), INTERNAL_PATHS, INTERNAL_SCHEMAS)).toEqual(
      [],
    );
  });

  it("۱) مسیرِ داخلیِ **بی‌سند** ⇒ گاردِ دریفت قرمز (internal یعنی مستند ولی غیرعمومی)", () => {
    const drift = routeDrift(
      [...documentedRoutes(), "POST /admin/users/x/suspend"],
      documentedRoutes(),
      new Set(),
    );
    expect(drift.undocumented).toEqual(["POST /admin/users/x/suspend"]);
  });

  it("۲) مسیرِ داخلی که پرچمش برداشته شود ⇒ در سندِ عمومی ظاهر می‌شود و گارد قرمز است", () => {
    // شکستنِ عمدی: همان ROUTES ولی بدونِ `internal` روی مسیرهای admin.
    const leaked: RouteDoc[] = [
      { method: "get", path: "/admin/me", tag: "admin", summary: "x", ok: { schema: "AdminMe" } },
    ];
    const doc = buildOpenApiDocument(leaked);
    const problems = publicSpecProblems(doc, INTERNAL_PATHS, INTERNAL_SCHEMAS);
    expect(problems.some((p) => p.includes("/admin/me"))).toBe(true);
  });

  it("۳) schemaی ادمین در componentsِ عمومی ⇒ قرمز (حتی بدونِ هیچ مسیرِ admin)", () => {
    // شکستنِ عمدی: AdminMe لای COMPONENT_SCHEMAS — شکلِ DTO از /openapi.json لو می‌رود.
    const doc = buildOpenApiDocument([], { AdminMe: z.object({ userId: z.string() }) });
    const problems = publicSpecProblems(doc, INTERNAL_PATHS, INTERNAL_SCHEMAS);
    expect(problems).toEqual(["schemaی داخلی در componentsِ عمومی: AdminMe"]);
  });

  it("۳′) تگِ admin در tagsِ سندِ عمومی ⇒ قرمز", () => {
    const doc = { ...buildOpenApiDocument(), tags: [{ name: "health" }, { name: "admin" }] };
    expect(publicSpecProblems(doc, INTERNAL_PATHS, INTERNAL_SCHEMAS)).toEqual([
      "تگِ admin در tagsِ سندِ عمومی",
    ]);
  });
});

describe("★ rate-limit — عبور از سقفِ OTP → ۴۲۹", () => {
  it("درخواستِ بیش از سقفِ ۵ به /auth/otp/request به ۴۲۹ می‌رسد", async () => {
    const app = await buildApp({
      config: TEST_CONFIG,
      db: fakeDb(() => Promise.resolve({ rows: [] })),
    });
    const codes: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const res = await app.inject({
        method: "POST",
        url: "/auth/otp/request",
        payload: { phone: "09120000001" },
      });
      codes.push(res.statusCode);
    }
    // پنج اول نباید ۴۲۹ باشند؛ بعد از عبور از سقف، ۴۲۹ ظاهر می‌شود.
    // (self-test: بدونِ سقفِ OTP همه زیرِ سقفِ سراسریِ ۱۰۰ می‌مانند و هیچ ۴۲۹ای نمی‌آید.)
    expect(codes.slice(0, 5).every((c) => c !== 429)).toBe(true);
    expect(codes.includes(429)).toBe(true);
    await app.close();
  });
});
