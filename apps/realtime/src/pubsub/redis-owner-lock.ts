import type Redis from "ioredis";

import { OWNER_LEASE_SECONDS, type OwnerLock } from "./owner-lock.ts";

/**
 * قفلِ صاحب روی Redis — `SET hb:owner:<boardId> <nodeId> NX EX 30` با تمدید،
 * عیناً [ADR-006](../../../../ARCHITECTURE_DECISIONS.md#adr-006).
 *
 * ── ★★ چرا تمدید و رهاکردن **اسکریپت** اند، نه دو دستور ────────────────
 *
 * «اگر مالِ من است، تمدیدش کن» با دو دستور (`GET` بعد `EXPIRE`) یک پنجره‌ی
 * مسابقه بینشان دارد: اجاره می‌تواند **بینِ** آن دو منقضی شود و نودِ دیگری صاحب
 * شود — و آن‌وقت `EXPIRE`ِ ما اجاره‌ی **او** را تمدید می‌کند در حالی که خودمان هم
 * فکر می‌کنیم صاحبیم. دو نودِ صاحب یعنی دقیقاً همان نوشتنِ همزمانی که این قفل
 * برای جلوگیری‌اش وجود دارد.
 *
 * ⚠️ همان اشتباهِ `SELECT max(seq)` بعد `INSERT` در گام ۴٫۳، این‌بار در Redis.
 * اسکریپتِ Lua اتمیک اجرا می‌شود و پنجره را می‌بندد.
 */

const KEY_PREFIX = "hb:owner:";

/** «اگر مقدار مالِ من است، اجاره را تازه کن» — اتمیک. */
const RENEW = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("expire", KEYS[1], ARGV[2])
else
  return 0
end`;

/** «اگر مقدار مالِ من است، پاکش کن» — اتمیک. */
const RELEASE = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

export interface RedisOwnerLockOptions {
  redis: Redis;
  /** شناسه‌ی این نود — مقداری که در کلید می‌نشیند. */
  nodeId: string;
  leaseSeconds?: number;
}

export function createRedisOwnerLock({
  redis,
  nodeId,
  leaseSeconds = OWNER_LEASE_SECONDS,
}: RedisOwnerLockOptions): OwnerLock {
  const key = (boardId: string): string => `${KEY_PREFIX}${boardId}`;

  return {
    async acquire(boardId) {
      // ★ `NX` تنها چیزی است که «فقط اگر کسی صاحب نیست» را اتمیک می‌کند.
      const result = await redis.set(key(boardId), nodeId, "EX", leaseSeconds, "NX");
      if (result === "OK") return true;
      // ⚠️ و اگر از قبل **خودمان** صاحب بودیم هم صاحبیم — مثلاً بعد از باز شدنِ
      //    دوباره‌ی همان اتاق. بدونِ این، نودِ صاحب خودش را غیرِ صاحب می‌دید و
      //    هیچ‌کس نمی‌نوشت تا انقضای اجاره.
      return (await redis.get(key(boardId))) === nodeId;
    },

    async renew(boardId) {
      const result = await redis.eval(RENEW, 1, key(boardId), nodeId, String(leaseSeconds));
      return result === 1;
    },

    async release(boardId) {
      await redis.eval(RELEASE, 1, key(boardId), nodeId);
    },

    close: () => Promise.resolve(),
  };
}
