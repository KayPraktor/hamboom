import { createHash } from "node:crypto";

import type { FastifyInstance, FastifyReply } from "fastify";

/**
 * Idempotency-Key برای POSTهای دگرگون‌ساز — گام ۵٫۵ (PLAN §۵٫۲).
 *
 * جریان: کلاینت یک `Idempotency-Key` (معمولاً UUID) روی یک POSTِ احرازشده می‌گذارد. اگر همان کلید
 * دوباره بیاید (double-click، retryِ بعد از timeout)، **همان پاسخِ قبلی** برمی‌گردد و منبعِ دوم ساخته
 * نمی‌شود. برای درخواست‌های واقعاً هم‌زمان، دومی منتظرِ اولی می‌مانَد (in-flight) تا هر دو یک نتیجه ببینند.
 *
 * ⚠️ **تک‌نود، در حافظه** — همان وضعِ rate-limit فعلی؛ چندنودی → Redis (فاز بعد). فقط پاسخِ **۲xx** کش
 * می‌شود (خطا نه، تا retry دوباره تلاش کند). دامنه با هشِ توکن است تا کلیدِ یک کاربر با دیگری قاطی نشود.
 */

interface Entry {
  status: number;
  body: string;
  contentType: string;
}

declare module "fastify" {
  interface FastifyRequest {
    /** وقتی این POST باید کش شود، در preHandler ست می‌شود؛ onSend با آن پاسخ را ذخیره می‌کند. */
    idempotencyKey?: string;
  }
}

const scopeOf = (auth: string): string =>
  createHash("sha256").update(auth).digest("hex").slice(0, 32);

export function registerIdempotency(app: FastifyInstance, opts: { ttlMs: number }): void {
  const done = new Map<string, { entry: Entry; expiresAt: number }>();
  const inflight = new Map<string, { promise: Promise<Entry>; resolve: (e: Entry) => void }>();

  const replay = (reply: FastifyReply, entry: Entry): FastifyReply =>
    reply
      .code(entry.status)
      .header("content-type", entry.contentType)
      .header("idempotent-replay", "true")
      .send(entry.body);

  app.addHook("preHandler", async (req, reply) => {
    if (req.method !== "POST") return;
    const header = req.headers["idempotency-key"];
    const auth = req.headers.authorization;
    // فقط POSTِ احرازشده‌ی دارای کلید — POSTهای عمومی (otp) کش نمی‌شوند.
    if (typeof header !== "string" || header.length === 0 || typeof auth !== "string") return;

    const url = req.routeOptions?.url ?? req.url;
    const key = `${scopeOf(auth)}:${url}:${header}`;
    const now = Date.now();
    for (const [k, v] of done) if (v.expiresAt <= now) done.delete(k); // sweepِ تنبل

    const cached = done.get(key);
    if (cached) return replay(reply, cached.entry);

    const pending = inflight.get(key);
    if (pending) return replay(reply, await pending.promise); // هم‌زمان: منتظرِ اولی

    let resolve!: (e: Entry) => void;
    const promise = new Promise<Entry>((r) => {
      resolve = r;
    });
    inflight.set(key, { promise, resolve });
    req.idempotencyKey = key; // onSend این را می‌بیند و ذخیره می‌کند
  });

  app.addHook("onSend", async (req, reply, payload) => {
    const key = req.idempotencyKey;
    if (key === undefined) return payload;
    const pending = inflight.get(key);
    inflight.delete(key);
    const entry: Entry = {
      status: reply.statusCode,
      body: typeof payload === "string" ? payload : "",
      contentType: String(reply.getHeader("content-type") ?? "application/json"),
    };
    // فقط پاسخِ موفقِ رشته‌ای (JSON) کش می‌شود.
    if (entry.status >= 200 && entry.status < 300 && typeof payload === "string") {
      done.set(key, { entry, expiresAt: Date.now() + opts.ttlMs });
    }
    pending?.resolve(entry);
    return payload;
  });
}
