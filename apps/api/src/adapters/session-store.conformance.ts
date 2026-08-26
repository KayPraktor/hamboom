import { randomUUID } from "node:crypto";

import type { SessionStore } from "@hamboom/auth-core";

/**
 * سوییتِ **conformanceِ مشترکِ** پورتِ `SessionStore` — قیدِ صریحِ مالک (۵٫۲).
 *
 * ★ همان قراردادِ رفتاری روی **هر دو** پیاده‌سازی اجرا می‌شود: `createMemorySessionStore` (در verify،
 * بدونِ DB) و `createPgSessionStore` (در `db:store-test`، روی Postgresِ زنده). اگر PG و memory از هم
 * واگرا شوند، یکی از این‌ها قرمز می‌شود — همان چیزی که «انحرافِ پیاده‌سازی» را می‌گیرد.
 *
 * هر case idهای یکتای خودش را می‌سازد، پس روی یک storeِ مشترک هم بی‌تداخل است. `sub` از بیرون می‌آید
 * چون PG یک FK به `users` دارد (باید کاربرِ واقعی باشد)؛ memory هر رشته‌ای را می‌پذیرد.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const nowSec = (): number => Math.floor(Date.now() / 1000);

export interface StoreCase {
  name: string;
  run: (store: SessionStore, sub: string) => Promise<void>;
}

export const sessionStoreCases: StoreCase[] = [
  {
    name: "insert سپس findByHash رکورد را با فیلدهای درست می‌دهد (used=false)",
    run: async (store, sub) => {
      const tokenHash = randomUUID();
      const familyId = randomUUID();
      const expiresAt = nowSec() + 1000;
      await store.insert({ tokenHash, familyId, sub, used: false, expiresAt });
      const rec = await store.findByHash(tokenHash);
      assert(rec !== null, "رکوردِ درج‌شده باید پیدا شود");
      assert(rec!.tokenHash === tokenHash, "tokenHash");
      assert(rec!.familyId === familyId, "familyId");
      assert(rec!.sub === sub, "sub");
      assert(rec!.used === false, "used باید false باشد");
      assert(rec!.expiresAt === expiresAt, `expiresAt (${rec!.expiresAt} ≠ ${expiresAt})`);
    },
  },
  {
    name: "findByHashِ ناشناخته → null",
    run: async (store) => {
      assert((await store.findByHash(randomUUID())) === null, "توکنِ ناشناخته باید null بدهد");
    },
  },
  {
    name: "markUsed → used=true در findِ بعدی",
    run: async (store, sub) => {
      const tokenHash = randomUUID();
      await store.insert({ tokenHash, familyId: randomUUID(), sub, used: false, expiresAt: nowSec() + 1000 });
      await store.markUsed(tokenHash);
      const rec = await store.findByHash(tokenHash);
      assert(rec !== null && rec.used === true, "بعد از markUsed باید used=true باشد");
    },
  },
  {
    name: "burnFamily → توکن‌های آن خانواده دیگر پیدا نمی‌شوند",
    run: async (store, sub) => {
      const familyId = randomUUID();
      const t1 = randomUUID();
      const t2 = randomUUID();
      await store.insert({ tokenHash: t1, familyId, sub, used: false, expiresAt: nowSec() + 1000 });
      await store.insert({ tokenHash: t2, familyId, sub, used: true, expiresAt: nowSec() + 1000 });
      await store.burnFamily(familyId);
      assert((await store.findByHash(t1)) === null, "t1 بعد از burn باید null");
      assert((await store.findByHash(t2)) === null, "t2 بعد از burn باید null");
    },
  },
  {
    name: "burnFamily فقط خانواده‌ی داده‌شده را می‌سوزاند، نه بقیه",
    run: async (store, sub) => {
      const famA = randomUUID();
      const famB = randomUUID();
      const tA = randomUUID();
      const tB = randomUUID();
      await store.insert({ tokenHash: tA, familyId: famA, sub, used: false, expiresAt: nowSec() + 1000 });
      await store.insert({ tokenHash: tB, familyId: famB, sub, used: false, expiresAt: nowSec() + 1000 });
      await store.burnFamily(famA);
      assert((await store.findByHash(tA)) === null, "خانواده‌ی A باید سوخته باشد");
      assert((await store.findByHash(tB)) !== null, "خانواده‌ی B باید دست‌نخورده بماند");
    },
  },
];
