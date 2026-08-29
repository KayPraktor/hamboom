import { describe, expect, it } from "vitest";

import {
  createAuthCoreBoardAuthority,
  createMemoryBoardAccessReader,
  signRtToken,
  type BoardAccessInput,
  type BoardAccessReader,
} from "./index.ts";

const secret = new TextEncoder().encode("test-secret-at-least-32-bytes-long-aaaa");
const NOW_MS = 1_700_000_000_000;
const clock = (): number => NOW_MS;
const TTL = 60;

function reader(map: Record<string, BoardAccessInput | null>): BoardAccessReader {
  return { read: (sub, boardId) => Promise.resolve(map[`${sub}:${boardId}`] ?? null) };
}

function access(over: Partial<BoardAccessInput> = {}): BoardAccessInput {
  return {
    isStaff: false,
    isBoardOwner: false,
    accessMode: "team",
    directRole: null,
    teamRole: null,
    hasValidLink: false,
    ...over,
  };
}

describe("AuthCoreBoardAuthority", () => {
  it("★ developmentOnly=false — در production باید بالا بیاید (برعکسِ DevBoardAuthority)", () => {
    const a = createAuthCoreBoardAuthority({
      secret,
      rtTokenTtlSeconds: TTL,
      accessReader: reader({}),
      clock,
    });
    expect(a.developmentOnly).toBe(false);
  });

  it("verify یک rt-tokenِ معتبر را می‌پذیرد", async () => {
    const a = createAuthCoreBoardAuthority({
      secret,
      rtTokenTtlSeconds: TTL,
      accessReader: reader({}),
      clock,
    });
    const t = await signRtToken(secret, { sub: "u1", boardId: "b1", role: "editor" }, TTL, clock);
    expect(await a.verify(t, "b1")).toMatchObject({ sub: "u1", boardId: "b1", role: "editor" });
  });

  it("★★ currentRole نقشِ **همین‌حالا** را می‌دهد، نه claimِ توکن", async () => {
    // توکن ممکن است `editor` گفته باشد، ولی الان کاربر در board_members فقط `viewer` است.
    const a = createAuthCoreBoardAuthority({
      secret,
      rtTokenTtlSeconds: TTL,
      accessReader: reader({ "u1:b1": access({ accessMode: "private", directRole: "viewer" }) }),
      clock,
    });
    expect(await a.currentRole("u1", "b1")).toBe("viewer");
  });

  it("★★ کاربرِ بی‌دسترسی → null (نه undefined) — fail-closed", async () => {
    // بوردِ private، کاربر فقط عضوِ تیم است → مسیرِ تیم خاموش → هیچ دسترسی.
    const a = createAuthCoreBoardAuthority({
      secret,
      rtTokenTtlSeconds: TTL,
      accessReader: reader({ "u1:b1": access({ accessMode: "private", teamRole: "member" }) }),
      clock,
    });
    expect(await a.currentRole("u1", "b1")).toBeNull();
  });

  it("بوردِ ناموجود → null", async () => {
    const a = createAuthCoreBoardAuthority({
      secret,
      rtTokenTtlSeconds: TTL,
      accessReader: reader({}),
      clock,
    });
    expect(await a.currentRole("u1", "gone")).toBeNull();
  });
});

/**
 * ★ خواننده‌ی حافظه‌ای — همان چیزی که سنجه‌های Group-Bی realtime و `rt-dev-server`
 * به‌جای readerِ pg تزریق می‌کنند. اینجا **از راهِ خودِ authority** آزموده می‌شود،
 * چون مصرفش همان است: `createRealtimeAuthority` → `createAuthCoreBoardAuthority`.
 */
describe("MemoryBoardAccessReader", () => {
  const authorityWith = (r: ReturnType<typeof createMemoryBoardAccessReader>) =>
    createAuthCoreBoardAuthority({ secret, rtTokenTtlSeconds: TTL, accessReader: r, clock });

  it("set(editor) → currentRole برابرِ editor", async () => {
    const r = createMemoryBoardAccessReader();
    r.set("u1", "b1", "editor");
    expect(await authorityWith(r).currentRole("u1", "b1")).toBe("editor");
  });

  it("set(owner) → currentRole برابرِ owner (از isBoardOwner)", async () => {
    const r = createMemoryBoardAccessReader();
    r.set("u1", "b1", "owner");
    expect(await authorityWith(r).currentRole("u1", "b1")).toBe("owner");
  });

  it("★ کلیدِ ناموجود → null (fail-closed، نه undefined)", async () => {
    const r = createMemoryBoardAccessReader();
    expect(await authorityWith(r).currentRole("u1", "b1")).toBeNull();
  });

  it("★ set(null) یعنی دسترسی برداشته شد → null", async () => {
    const r = createMemoryBoardAccessReader();
    r.set("u1", "b1", null);
    expect(await authorityWith(r).currentRole("u1", "b1")).toBeNull();
  });

  it("clear پس از set → دوباره null", async () => {
    const r = createMemoryBoardAccessReader();
    r.set("u1", "b1", "editor");
    r.clear("u1", "b1");
    expect(await authorityWith(r).currentRole("u1", "b1")).toBeNull();
  });

  it("کلیدها جدا می‌مانند — نقشِ یک (sub,board) روی دیگری اثر ندارد", async () => {
    const r = createMemoryBoardAccessReader();
    r.set("u1", "b1", "editor");
    const a = authorityWith(r);
    expect(await a.currentRole("u2", "b1")).toBeNull();
    expect(await a.currentRole("u1", "b2")).toBeNull();
  });
});
