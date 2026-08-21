import { describe, expect, it } from "vitest";

import {
  createMemorySessionStore,
  rotateSession,
  startSession,
  type RefreshConfig,
} from "./refresh.ts";

const TTL = 3600;
const NOW_MS = 1_700_000_000_000;

/** مولدِ قطعیِ توکن/خانواده برای تست. */
function seq(prefix: string): () => string {
  let i = 0;
  return () => `${prefix}${String(i++)}`;
}

function cfg(over: Partial<RefreshConfig> = {}): RefreshConfig {
  return {
    ttlSeconds: TTL,
    clock: () => NOW_MS,
    newToken: seq("t"),
    newFamilyId: seq("fam"),
    ...over,
  };
}

describe("refresh — چرخش و تشخیصِ استفاده‌ی مجدد", () => {
  it("startSession توکن می‌دهد و rotate همان sub را برمی‌گرداند", async () => {
    const store = createMemorySessionStore();
    const config = cfg();
    const t0 = await startSession(store, "u1", config);
    const r = await rotateSession(store, t0, config);
    expect(r.sub).toBe("u1");
    expect(r.refreshToken).not.toBe(t0);
  });

  it("زنجیره‌ی چرخش کار می‌کند", async () => {
    const store = createMemorySessionStore();
    const config = cfg();
    const t0 = await startSession(store, "u1", config);
    const r1 = await rotateSession(store, t0, config);
    const r2 = await rotateSession(store, r1.refreshToken, config);
    expect(r2.sub).toBe("u1");
  });

  it("★★ استفاده‌ی مجدد از توکنِ چرخانده‌شده → reuse، و کلِ خانواده می‌سوزد", async () => {
    const store = createMemorySessionStore();
    const config = cfg();
    const t0 = await startSession(store, "u1", config);
    const r1 = await rotateSession(store, t0, config); // t0 حالا used است

    // مهاجم توکنِ قدیمیِ t0 را دوباره ارائه می‌کند:
    await expect(rotateSession(store, t0, config)).rejects.toMatchObject({ code: "reuse" });

    // ★ و توکنِ سالمِ r1 هم دیگر کار نمی‌کند — کلِ خانواده باطل شد.
    await expect(rotateSession(store, r1.refreshToken, config)).rejects.toMatchObject({
      code: "invalid",
    });
  });

  it("توکنِ ناموجود → invalid", async () => {
    const store = createMemorySessionStore();
    await expect(rotateSession(store, "nope", cfg())).rejects.toMatchObject({ code: "invalid" });
  });

  it("توکنِ منقضی → expired", async () => {
    const store = createMemorySessionStore();
    const t0 = await startSession(store, "u1", cfg({ ttlSeconds: 10 }));
    await expect(rotateSession(store, t0, cfg({ clock: () => NOW_MS + 20_000 }))).rejects.toMatchObject({
      code: "expired",
    });
  });
});
