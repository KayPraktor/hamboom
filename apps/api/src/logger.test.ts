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
});
