import type { BoardRole, RtTokenClaims } from "@hamboom/shared-types";

import { effectiveBoardRole, type BoardAccessInput } from "./roles.ts";
import { verifyRtToken } from "./tokens.ts";

/**
 * پورتِ خواندنِ داده‌ی دسترسی — **پیاده‌سازیِ DBش در `apps/api` (فاز ۵)** است، نه اینجا؛ برای تست
 * یک نمونه‌ی حافظه‌ای. `read` داده‌ی خامِ دسترسیِ کاربر روی بورد را می‌دهد که `effectiveBoardRole`
 * رویش حساب می‌کند. `null` یعنی بورد اصلاً وجود ندارد.
 */
export interface BoardAccessReader {
  read(sub: string, boardId: string): Promise<BoardAccessInput | null>;
}

export interface AuthCoreBoardAuthorityConfig {
  /** رازِ HS256؛ config می‌خواندش، auth-core param می‌گیرد. */
  secret: Uint8Array;
  /** TTLِ rt-token (ثانیه) — سقفِ آینده ۲× همین است. */
  rtTokenTtlSeconds: number;
  accessReader: BoardAccessReader;
  clock?: () => number;
}

/**
 * پیاده‌سازیِ **واقعیِ** پورتِ `BoardAuthority`ِ realtime (M3 — جایگزینِ `DevBoardAuthority`).
 *
 * ⚠️ **این در `packages/auth-core` است و interfaceِ `BoardAuthority` در `apps/realtime`** — و پکیج
 * نمی‌تواند اپ را import کند. پس این تابع یک شیءِ **هم‌شکلِ** `BoardAuthority` می‌سازد
 * (`verify`/`currentRole`/`developmentOnly`)؛ **فاز ۷** آن را با `satisfies BoardAuthority` تزریق
 * می‌کند و `TokenError` را به کدِ پروتکلی (`TOKEN_*`) نگاشت می‌دهد. این همان الگوی
 * `StorageSnapshotStore` است ([ADR-031](../../../ARCHITECTURE_DECISIONS.md#adr-031)): پورت مالِ
 * مصرف‌کننده، آداپتور مصرف‌کننده‌ی منطقِ auth-core.
 */
export function createAuthCoreBoardAuthority(config: AuthCoreBoardAuthorityConfig): {
  readonly developmentOnly: false;
  verify(token: string, boardId: string): Promise<RtTokenClaims>;
  currentRole(sub: string, boardId: string): Promise<BoardRole | null>;
} {
  return {
    // ★ برخلافِ `DevBoardAuthority`، این نسخه در production باید **بالا بیاید** (گیتِ ADR-031).
    developmentOnly: false,

    verify(token, boardId) {
      return verifyRtToken(config.secret, token, boardId, config.rtTokenTtlSeconds, config.clock);
    },

    async currentRole(sub, boardId) {
      const input = await config.accessReader.read(sub, boardId);
      // ⚠️ بورد نیست → `null` (نه `undefined`): auth-core منبعِ حقیقت است و **همیشه نظر دارد**.
      //    این تمایز حیاتی است — `undefined` یعنی «نظری ندارم» که فقط برای dev-impl معنا داشت.
      if (input === null) return null;
      return effectiveBoardRole(input);
    },
  };
}

/**
 * ★ `BoardAccessReader`ِ **حافظه‌ای** — برای تست/دمو (rt-dev-server، تست‌های واحدِ realtime). نقش با
 * `set`/`clear` گذاشته می‌شود؛ همان مکانیزمِ `DevRoleOverrides`ِ M2، ولی این‌بار داده به `effectiveBoardRole`ِ
 * **واقعی** می‌رسد. `main.ts`ِ production نسخه‌ی pgِ مشترک (`@hamboom/board-access-db`) را می‌سازد، نه این را.
 */
export interface MemoryBoardAccessReader extends BoardAccessReader {
  /** نقشِ کاربر روی بورد را بگذار؛ `null` یعنی دسترسی برداشته شد (بورد وجود ندارد → کاربر رد می‌شود). */
  set(sub: string, boardId: string, role: BoardRole | null): void;
  clear(sub: string, boardId: string): void;
}

/** نقش → ورودیِ خامِ `effectiveBoardRole` (بوردِ خصوصی؛ owner از `isBoardOwner`، بقیه از `directRole`). */
function roleToInput(role: BoardRole | null): BoardAccessInput | null {
  if (role === null) return null;
  const base = { isStaff: false, accessMode: "private" as const, teamRole: null, hasValidLink: false };
  return role === "owner"
    ? { ...base, isBoardOwner: true, directRole: null }
    : { ...base, isBoardOwner: false, directRole: role };
}

export function createMemoryBoardAccessReader(): MemoryBoardAccessReader {
  const map = new Map<string, BoardAccessInput | null>();
  const key = (sub: string, boardId: string): string => `${boardId} ${sub}`;
  return {
    // نبودِ کلید و مقدارِ `null` هر دو → `null` (بورد نیست / دسترسی برداشته شد).
    read: (sub, boardId) => Promise.resolve(map.get(key(sub, boardId)) ?? null),
    set: (sub, boardId, role) => map.set(key(sub, boardId), roleToInput(role)),
    clear: (sub, boardId) => map.delete(key(sub, boardId)),
  };
}
