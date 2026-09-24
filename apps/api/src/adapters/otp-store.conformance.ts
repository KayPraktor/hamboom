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
      await store.set(phone, {
        codeHash: "h",
        attempts: 0,
        expiresAt: nowSec() + 120,
        createdAt: nowSec(),
      });
      await store.incrementAttempts(phone);
      const got = await store.get(phone);
      assert(got !== null && got.attempts === 1, "attempts باید ۱ شود");
    },
  },
  {
    name: "delete → get دیگر null می‌دهد",
    run: async (store) => {
      const phone = uniquePhone();
      await store.set(phone, {
        codeHash: "h",
        attempts: 0,
        expiresAt: nowSec() + 120,
        createdAt: nowSec(),
      });
      await store.delete(phone);
      assert((await store.get(phone)) === null, "بعد از delete باید null");
    },
  },
  {
    name: "set جایگزین می‌کند — get آخرین را می‌دهد",
    run: async (store) => {
      const phone = uniquePhone();
      await store.set(phone, {
        codeHash: "old",
        attempts: 3,
        expiresAt: nowSec() + 120,
        createdAt: nowSec(),
      });
      await store.set(phone, {
        codeHash: "new",
        attempts: 0,
        expiresAt: nowSec() + 120,
        createdAt: nowSec() + 1,
      });
      const got = await store.get(phone);
      assert(got !== null && got.codeHash === "new", "get باید آخرین چالش را بدهد");
      assert(got!.attempts === 0, "attemptsِ چالشِ نو");
    },
  },
];

/**
 * ★★ M6 فاز ۳ — **دو هدف روی یک شماره مستقل‌اند** (ADR-066 §پیامدها).
 *
 * دو store با `purpose`ِ متفاوت برای **همان** مقصد: چالشِ step-up نباید چالشِ ورودِ در جریان را
 * consume/جایگزین/حذف کند و برعکس؛ شمارشِ تلاش هم جداست. روی memory دو نمونه‌ی جدا ذاتاً
 * مستقل‌اند (این case آن‌جا فقط harness را می‌سنجد)؛ **اثباتِ واقعی روی PG است** (`db:store-test`)،
 * که هر دو store یک جدول را می‌بینند و فقط ستونِ `purpose` جدایشان می‌کند.
 */
export interface OtpPairCase {
  name: string;
  run: (login: OtpStore, stepUp: OtpStore) => Promise<void>;
}

export const otpPurposeCases: OtpPairCase[] = [
  {
    name: "★ چالشِ step-up چالشِ ورودِ همان شماره را نمی‌کُشد (و برعکس)",
    run: async (login, stepUp) => {
      const phone = uniquePhone();
      const t = nowSec();
      await login.set(phone, {
        codeHash: "login-hash",
        attempts: 0,
        expiresAt: t + 120,
        createdAt: t,
      });
      await stepUp.set(phone, {
        codeHash: "stepup-hash",
        attempts: 0,
        expiresAt: t + 120,
        createdAt: t + 1,
      });

      const l1 = await login.get(phone);
      assert(
        l1 !== null && l1.codeHash === "login-hash",
        "setِ step-up نباید چالشِ ورود را جایگزین/consume کند",
      );
      const s1 = await stepUp.get(phone);
      assert(
        s1 !== null && s1.codeHash === "stepup-hash",
        "چالشِ step-up باید از storeِ خودش خوانده شود",
      );

      await login.incrementAttempts(phone);
      const s2 = await stepUp.get(phone);
      assert(
        s2 !== null && s2.attempts === 0,
        "incrementAttemptsِ ورود نباید تلاشِ step-up را بشمارد",
      );

      await stepUp.delete(phone);
      assert((await stepUp.get(phone)) === null, "deleteِ step-up باید فقط چالشِ خودش را ببرد");
      const l2 = await login.get(phone);
      assert(
        l2 !== null && l2.attempts === 1,
        "چالشِ ورود بعد از deleteِ step-up باید سرِ جایش باشد (با یک تلاش)",
      );
    },
  },
];
