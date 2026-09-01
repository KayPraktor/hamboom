import { describe, expect, it } from "vitest";

import { createClient } from "./client.ts";
import { SdkError } from "./errors.ts";

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const err = (code: string) => ({ error: { code, message: "پیام", requestId: "req-1" } });

describe("createClient", () => {
  it("خطای §۵ → SdkError با code/status/requestId", async () => {
    const client = createClient({
      baseUrl: "http://x",
      fetch: () => Promise.resolve(json(404, err("BOARD_NOT_FOUND"))),
    });
    await expect(client.boards.get("b1")).rejects.toBeInstanceOf(SdkError);
    await expect(client.boards.get("b1")).rejects.toMatchObject({
      status: 404,
      code: "BOARD_NOT_FOUND",
      requestId: "req-1",
    });
  });

  it("بعد از setAccessToken هدرِ Bearer می‌رود", async () => {
    let seen: RequestInit | undefined;
    const client = createClient({
      baseUrl: "",
      fetch: (_u, i) => {
        seen = i;
        return Promise.resolve(json(200, { boards: [] }));
      },
    });
    client.setAccessToken("tok-1");
    await client.boards.list();
    expect((seen?.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
  });

  it("★ روی ۴۰۱ یک‌بار refresh و retry می‌کند و توکنِ نو را ذخیره می‌کند", async () => {
    const calls: string[] = [];
    let boardHits = 0;
    const client = createClient({
      baseUrl: "",
      fetch: (url, init) => {
        calls.push(`${String(init.method)} ${url}`);
        if (url.endsWith("/auth/refresh")) return Promise.resolve(json(200, { accessToken: "new-tok" }));
        boardHits += 1;
        return Promise.resolve(boardHits === 1 ? json(401, err("UNAUTHORIZED")) : json(200, { id: "x" }));
      },
    });
    client.setAccessToken("old-tok");
    const board = await client.boards.get("x");
    expect((board as { id: string }).id).toBe("x");
    expect(calls.filter((c) => c.includes("/auth/refresh"))).toHaveLength(1);
    expect(calls.filter((c) => c.includes("/boards/x"))).toHaveLength(2); // ۴۰۱ سپس retry
    expect(client.getAccessToken()).toBe("new-tok");
  });

  it("refreshِ ناموفق → onSessionEnded صدا می‌شود و ۴۰۱ سطح می‌آید", async () => {
    let ended = false;
    const client = createClient({
      baseUrl: "",
      onSessionEnded: () => {
        ended = true;
      },
      fetch: () => Promise.resolve(json(401, err("UNAUTHORIZED"))),
    });
    client.setAccessToken("old");
    await expect(client.me.get()).rejects.toMatchObject({ status: 401 });
    expect(ended).toBe(true);
  });

  it("query string درست ساخته می‌شود (فیلترِ فهرست)", async () => {
    let seenUrl = "";
    const client = createClient({
      baseUrl: "http://x",
      fetch: (u) => {
        seenUrl = u;
        return Promise.resolve(json(200, { boards: [] }));
      },
    });
    await client.boards.list({ q: "سلام", folderId: "f1", favorite: true, trashed: true });
    const u = new URL(seenUrl);
    expect(u.searchParams.get("q")).toBe("سلام");
    expect(u.searchParams.get("folderId")).toBe("f1");
    expect(u.searchParams.get("favorite")).toBe("true");
    expect(u.searchParams.get("trashed")).toBe("true");
  });

  it("verifyOtp توکن را در حافظه ذخیره می‌کند", async () => {
    const client = createClient({
      baseUrl: "",
      fetch: () =>
        Promise.resolve(json(200, { accessToken: "at-1", isNewUser: false, personalTeamId: "t", user: null })),
    });
    await client.auth.verifyOtp({ phone: "09120000000", code: "123456" });
    expect(client.getAccessToken()).toBe("at-1");
  });

  it("۲۰۴ → undefined بدونِ خطای parse", async () => {
    const client = createClient({
      baseUrl: "",
      fetch: () => Promise.resolve(new Response(null, { status: 204 })),
    });
    client.setAccessToken("t");
    await expect(client.boards.remove("x")).resolves.toBeUndefined();
  });

  it("asset.resolve → Location را از ۳۰۲ می‌دهد (بدونِ دنبال‌کردن)", async () => {
    const client = createClient({
      baseUrl: "",
      fetch: () =>
        Promise.resolve(new Response(null, { status: 302, headers: { location: "https://s3/presigned" } })),
    });
    client.setAccessToken("t");
    await expect(client.assets.resolve("f1")).resolves.toBe("https://s3/presigned");
  });
});
