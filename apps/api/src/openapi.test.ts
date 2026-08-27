import { describe, expect, it } from "vitest";

import { buildApp } from "./app.ts";
import { buildOpenApiDocument, documentedRoutes } from "./openapi.ts";
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

describe("★ گاردِ دریفتِ OpenAPI — هر مسیرِ ثبت‌شده مستند است", () => {
  it("routeهای ثبت‌شده و documentedRoutes دقیقاً یکی‌اند", async () => {
    const app = await buildApp({
      config: TEST_CONFIG,
      db: fakeDb(() => Promise.resolve({ rows: [] })),
    });
    const registered = new Set(app.registeredRoutes);
    const documented = documentedRoutes();
    const undocumented = [...registered].filter((r) => !documented.has(r)).sort();
    const unregistered = [...documented].filter((r) => !registered.has(r)).sort();
    expect(undocumented, "مسیرهای ثبت‌شده‌ی بی‌سند").toEqual([]);
    expect(unregistered, "مسیرهای مستندِ ثبت‌نشده").toEqual([]);
    await app.close();
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
