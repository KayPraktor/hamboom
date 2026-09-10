import { describe, expect, it } from "vitest";

import {
  assertProductionConfig,
  isRemoteDatabaseHost,
  ProductionConfigError,
  weakSecretReason,
} from "./production-guards.ts";

/** رازِ واقعیِ نمونه — تصادفی، بدونِ نشانه‌ی توسعه‌ای، با تنوعِ کافی. */
const GOOD_SECRET = "9f3a7c1e4b8d2065af13ce97b402d85f";
/** همان پیش‌فرضِ واقعیِ `.env.example` — دقیقاً چیزی که این گارد باید بگیرد. */
const DEV_SECRET = "change_me_dev_only_jwt_secret_at_least_32_chars_long";

const base = {
  APP_ENV: "production",
  JWT_SECRET: GOOD_SECRET,
  DATABASE_URL: "postgres://u:p@postgres:5432/hamboom",
  DATABASE_SSL: false,
};

describe("weakSecretReason", () => {
  it("پیش‌فرضِ `.env.example` را می‌گیرد", () => {
    expect(weakSecretReason(DEV_SECRET)).toContain("change_me");
  });

  it("رازِ کم‌تنوع را می‌گیرد", () => {
    expect(weakSecretReason("abababababababababababababababab")).toContain("متمایز");
  });

  it("★ رازِ واقعی را قرمز نمی‌کند (مثبتِ کاذب ندارد)", () => {
    expect(weakSecretReason(GOOD_SECRET)).toBeNull();
    expect(weakSecretReason("Kf7$pQ2!zR9mNx4Lw8Tb1Ve6Yh3Ug5Sa")).toBeNull();
  });
});

describe("isRemoteDatabaseHost", () => {
  it("loopback و نامِ سرویسِ compose محلی‌اند", () => {
    expect(isRemoteDatabaseHost("postgres://u:p@localhost:5432/db")).toBe(false);
    expect(isRemoteDatabaseHost("postgres://u:p@127.0.0.1:5432/db")).toBe(false);
    expect(isRemoteDatabaseHost("postgres://u:p@postgres:5432/db")).toBe(false);
  });

  it("نامِ نقطه‌دار و IP دور شمرده می‌شوند", () => {
    expect(isRemoteDatabaseHost("postgres://u:p@db.arvanstorage.ir:5432/x")).toBe(true);
    expect(isRemoteDatabaseHost("postgres://u:p@10.20.30.40:5432/x")).toBe(true);
  });

  it("★ آدرسِ نامفهوم fail-closed است (دور شمرده می‌شود)", () => {
    expect(isRemoteDatabaseHost("نه-یک-آدرس")).toBe(true);
  });
});

describe("assertProductionConfig", () => {
  it("بیرون از production هیچ کاری نمی‌کند", () => {
    for (const APP_ENV of ["local", "staging"]) {
      expect(() =>
        assertProductionConfig(
          { ...base, APP_ENV, JWT_SECRET: DEV_SECRET },
          { RT_DEV_JWT_SECRET: "x" },
        ),
      ).not.toThrow();
    }
  });

  it("پیکربندیِ سالمِ production رد نمی‌شود", () => {
    expect(() => assertProductionConfig(base, {})).not.toThrow();
  });

  it("رازِ ضعیف ⇒ بوت نمی‌شود", () => {
    expect(() => assertProductionConfig({ ...base, JWT_SECRET: DEV_SECRET }, {})).toThrow(
      ProductionConfigError,
    );
  });

  it("★ دیتابیسِ دور بدونِ SSL ⇒ بوت نمی‌شود", () => {
    expect(() =>
      assertProductionConfig({ ...base, DATABASE_URL: "postgres://u:p@db.example.ir:5432/x" }, {}),
    ).toThrow(ProductionConfigError);
  });

  it("★★ همان دیتابیسِ دور **با** SSL مجاز است", () => {
    expect(() =>
      assertProductionConfig(
        { ...base, DATABASE_URL: "postgres://u:p@db.example.ir:5432/x", DATABASE_SSL: true },
        {},
      ),
    ).not.toThrow();
  });

  it("⚠️ چیدمانِ ADR-059 (postgres در همان compose، بدونِ SSL) **مجاز** است", () => {
    expect(() => assertProductionConfig(base, {})).not.toThrow();
  });

  it("متغیرِ dev-only ⇒ بوت نمی‌شود", () => {
    for (const name of ["RT_DEV_JWT_SECRET", "OTP_DEV_FIXED_CODE"]) {
      expect(() => assertProductionConfig(base, { [name]: "x" })).toThrow(ProductionConfigError);
    }
  });

  it("متغیرِ dev-onlyِ **خالی** تخلف نیست", () => {
    expect(() => assertProductionConfig(base, { RT_DEV_JWT_SECRET: "" })).not.toThrow();
  });

  it("★ همه‌ی تخلف‌ها با هم گزارش می‌شوند، نه یکی‌یکی", () => {
    let message = "";
    try {
      assertProductionConfig(
        {
          ...base,
          JWT_SECRET: DEV_SECRET,
          DATABASE_URL: "postgres://u:p@db.example.ir:5432/x",
        },
        { RT_DEV_JWT_SECRET: "x" },
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("JWT_SECRET");
    expect(message).toContain("DATABASE_SSL");
    expect(message).toContain("RT_DEV_JWT_SECRET");
  });

  it("راز/آدرسِ غایب بررسی نمی‌شود (اپی که آن بخش را ندارد نباید بشکند)", () => {
    expect(() => assertProductionConfig({ APP_ENV: "production" }, {})).not.toThrow();
  });

  describe("★ کلیدِ sms.ir (M5 فازِ ۴٫۵)", () => {
    it("کلیدِ جای‌نگه‌دار با smsir رد می‌شود", () => {
      let message = "";
      try {
        assertProductionConfig(
          { ...base, SMS_PROVIDER: "smsir", SMS_IR_API_KEY: "your_api_key_here" },
          {},
        );
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain("SMS_IR_API_KEY");
    });

    it("کلیدِ واقعیِ تصادفی رد نمی‌شود", () => {
      expect(() =>
        assertProductionConfig(
          {
            ...base,
            SMS_PROVIDER: "smsir",
            SMS_IR_API_KEY: "kCNu-vZAX3T2u4xFBsm_6VF8XKbAPalfgFOjJRNG",
          },
          {},
        ),
      ).not.toThrow();
    });

    it("⊕ با mock اصلاً بررسی نمی‌شود (کلید خوانده نمی‌شود)", () => {
      expect(() =>
        assertProductionConfig({ ...base, SMS_PROVIDER: "mock", SMS_IR_API_KEY: "change_me" }, {}),
      ).not.toThrow();
    });
  });

  describe("★★ TRUST_PROXY (M5 گام ۹٫۲)", () => {
    it("در production با false رد می‌شود — وگرنه همه‌ی کاربران یک سطلِ نرخ دارند", () => {
      let message = "";
      try {
        assertProductionConfig({ ...base, TRUST_PROXY: false }, {});
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain("TRUST_PROXY");
    });

    it("با true قبول می‌شود", () => {
      expect(() => assertProductionConfig({ ...base, TRUST_PROXY: true }, {})).not.toThrow();
    });

    it("⊕ مصرف‌کننده‌ای که پرچم را ندارد (آشتی‌دهی، اسکریپت‌ها) سنجیده نمی‌شود", () => {
      expect(() => assertProductionConfig({ ...base }, {})).not.toThrow();
    });

    it("⊕ بیرونِ production کاری نمی‌کند", () => {
      expect(() =>
        assertProductionConfig({ ...base, APP_ENV: "staging", TRUST_PROXY: false }, {}),
      ).not.toThrow();
    });
  });
});
