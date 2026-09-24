import { Writable } from "node:stream";

import pino from "pino";
import { describe, expect, it } from "vitest";

import { loggerOptions } from "./logger.ts";

/**
 * P7 (ADR-020): آخرین سدِ دفاعی — pino هر مسیرِ حساس را به `[Redacted]` تبدیل می‌کند.
 *
 * ★ خودآزمون با نشتِ عمدی: چهار مقدارِ حساس لاگ می‌شود و ثابت می‌شود **هیچ‌کدام** در
 *   خروجی نیست. اگر redact کار نکند، این تست قرمز می‌شود — مثلِ نگهبانِ log.tsِ realtime.
 */
describe("loggerOptions — redactِ P7", () => {
  it("★ توکن/کوکی/کدِ حساس را حذف می‌کند، نه لو می‌دهد", () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(String(chunk));
        cb();
      },
    });

    const log = pino(loggerOptions("info"), stream);
    log.info(
      {
        req: { headers: { authorization: "Bearer SUPERSECRET", cookie: "refresh=COOKIELEAK" } },
        data: { token: "TOKENLEAK", code: "654321" },
      },
      "درخواست",
    );

    const out = chunks.join("");
    expect(out).not.toContain("SUPERSECRET");
    expect(out).not.toContain("COOKIELEAK");
    expect(out).not.toContain("TOKENLEAK");
    expect(out).not.toContain("654321");
    expect(out).toContain("[Redacted]");
  });

  it("★ M6 فاز ۴: ردیفِ audit (ip/phone/user_agent/email) اگر سهواً لاگ شود، لو نمی‌رود", () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(String(chunk));
        cb();
      },
    });
    const log = pino(loggerOptions("info"), stream);
    // نشتِ عمدی: یک AuditEntry و یک ردیفِ خامِ audit_logs، هر دو یک سطح تو، و یکی در ریشه.
    log.info(
      {
        entry: { actor: { ip: "203.0.113.77", userAgent: "UA-LEAK/1.0" } },
        row: {
          ip: "198.51.100.9",
          user_agent: "RAW-UA-LEAK",
          phone: "09120001234",
          email: "x@leak.ir",
        },
        ip: "192.0.2.5",
      },
      "audit",
    );
    const out = chunks.join("");
    for (const leak of [
      "203.0.113.77",
      "198.51.100.9",
      "192.0.2.5",
      "UA-LEAK",
      "RAW-UA-LEAK",
      "09120001234",
      "x@leak.ir",
    ]) {
      expect(out, leak).not.toContain(leak);
    }
    expect(out).toContain("[Redacted]");
  });
});

describe("★ سریالایزرِ req — query string در لاگِ دسترسی نیست (M6 ۵٫۵)", () => {
  it("url فقط مسیر است؛ ?q=<شماره> لو نمی‌رود", () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(String(chunk));
        cb();
      },
    });
    const log = pino(loggerOptions("info"), stream);
    // همان شکلی که fastify برای «incoming request» می‌دهد: شیءِ req از سریالایزرِ خودمان رد می‌شود.
    log.info(
      {
        req: {
          method: "GET",
          url: "/admin/search?q=09121112233&limit=5",
          hostname: "localhost",
          ip: "127.0.0.1",
          socket: { remotePort: 1234 },
        },
      },
      "incoming request",
    );
    const out = chunks.join("");
    expect(out).toContain('"url":"/admin/search"');
    expect(out).not.toContain("09121112233");
    expect(out).not.toContain("limit=5");
  });
});
