import { randomUUID } from "node:crypto";

import type { OtpStore } from "@hamboom/auth-core";

/**
 * سوییتِ **conformanceِ مشترکِ** پورتِ `OtpStore` — روی memory (verify) و PG (`db:store-test`).
 *
 * هر case یک مقصدِ یکتا با پیشوندِ `conftest-` می‌سازد تا هم بی‌تداخل باشد و هم پاک‌سازیِ اسکریپتِ
 * PG ساده بماند (`DELETE … WHERE destination LIKE 'conftest-%'`).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const nowSec = (): number => Math.floor(Date.now() / 1000);
const uniquePhone = (): string => `conftest-${randomUUID().slice(0, 12)}`;

export interface OtpCase {
  name: string;
  run: (store: OtpStore) => Promise<void>;
}

export const otpStoreCases: OtpCase[] = [
  {
    name: "set سپس get رکورد را با فیلدهای درست می‌دهد",
    run: async (store) => {
      const phone = uniquePhone();
      const createdAt = nowSec();
      const expiresAt = createdAt + 120;
      await store.set(phone, { codeHash: "hashA", attempts: 0, expiresAt, createdAt });
      const got = await store.get(phone);
      assert(got !== null, "رکورد باید پیدا شود");
      assert(got!.codeHash === "hashA", "codeHash");
      assert(got!.attempts === 0, "attempts");
      assert(got!.expiresAt === expiresAt, `expiresAt (${got!.expiresAt} ≠ ${expiresAt})`);
      assert(got!.createdAt === createdAt, `createdAt (${got!.createdAt} ≠ ${createdAt})`);
    },
  },
  {
    name: "getِ ناشناخته → null",
    run: async (store) => {
      assert((await store.get(uniquePhone())) === null, "مقصدِ ناشناخته باید null بدهد");
    },
  },
  {
    name: "incrementAttempts → attempts یکی بیشتر می‌شود",
    run: async (store) => {
      const phone = uniquePhone();
      await store.set(phone, { codeHash: "h", attempts: 0, expiresAt: nowSec() + 120, createdAt: nowSec() });
      await store.incrementAttempts(phone);
      const got = await store.get(phone);
      assert(got !== null && got.attempts === 1, "attempts باید ۱ شود");
    },
  },
  {
    name: "delete → get دیگر null می‌دهد",
    run: async (store) => {
      const phone = uniquePhone();
      await store.set(phone, { codeHash: "h", attempts: 0, expiresAt: nowSec() + 120, createdAt: nowSec() });
      await store.delete(phone);
      assert((await store.get(phone)) === null, "بعد از delete باید null");
    },
  },
  {
    name: "set جایگزین می‌کند — get آخرین را می‌دهد",
    run: async (store) => {
      const phone = uniquePhone();
      await store.set(phone, { codeHash: "old", attempts: 3, expiresAt: nowSec() + 120, createdAt: nowSec() });
      await store.set(phone, { codeHash: "new", attempts: 0, expiresAt: nowSec() + 120, createdAt: nowSec() + 1 });
      const got = await store.get(phone);
      assert(got !== null && got.codeHash === "new", "get باید آخرین چالش را بدهد");
      assert(got!.attempts === 0, "attemptsِ چالشِ نو");
    },
  },
];
