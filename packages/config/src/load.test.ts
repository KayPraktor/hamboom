import { describe, expect, it } from "vitest";

import { ConfigError, loadEnv } from "./load.ts";
import {
  appEnvSchema,
  databaseEnvSchema,
  devAuthEnvSchema,
  realtimeEnvSchema,
} from "./sections.ts";

/**
 * این تست‌ها روی یک منبعِ **ساختگی** کار می‌کنند، نه `process.env` — وگرنه خودشان
 * به محیطِ اجرا وابسته می‌شدند و روی ماشینِ دیگری رفتار دیگری می‌دادند.
 */
describe("loadEnv", () => {
  it("متغیرِ گم‌شده را با نامِ خودش در پیام می‌آورد", () => {
    expect(() => loadEnv(databaseEnvSchema, {})).toThrow(ConfigError);

    try {
      loadEnv(databaseEnvSchema, {});
      expect.unreachable("باید خطا می‌داد");
    } catch (error) {
      const message = (error as ConfigError).message;
      // اگر پیام نامِ متغیر را نگوید، عملاً بی‌فایده است.
      expect(message).toContain("DATABASE_URL");
      expect(message).toContain("تعریف نشده");
      // و باید بگوید کجا را نگاه کند:
      expect(message).toContain(".env.example");
    }
  });

  it("همه‌ی متغیرهای نامعتبر را یک‌جا گزارش می‌کند، نه یکی‌یکی", () => {
    try {
      loadEnv(realtimeEnvSchema, { RT_PORT: "-1", RT_HEARTBEAT_INTERVAL_MS: "abc" });
      expect.unreachable("باید خطا می‌داد");
    } catch (error) {
      const message = (error as ConfigError).message;
      expect(message).toContain("RT_PORT");
      expect(message).toContain("RT_HEARTBEAT_INTERVAL_MS");
    }
  });

  it("پیش‌فرض‌ها را اعمال می‌کند", () => {
    const env = loadEnv(realtimeEnvSchema, {});
    expect(env.RT_PORT).toBe(3001);
    expect(env.RT_HEARTBEAT_INTERVAL_MS).toBe(25_000);
    expect(env.RT_MAX_DOC_BYTES).toBe(52_428_800);
  });

  it("عدد را از رشته می‌سازد و تایپش واقعاً number است", () => {
    const env = loadEnv(realtimeEnvSchema, { RT_PORT: "4000" });
    expect(env.RT_PORT).toBe(4000);
    expect(typeof env.RT_PORT).toBe("number");
  });
});

describe("بولینِ محیطی", () => {
  /**
   * ★ این تست یک تله‌ی واقعی را قفل می‌کند: `Boolean("false") === true`.
   * اگر روزی کسی به `z.coerce.boolean()` تغییرش بدهد، `DATABASE_SSL=false`
   * بی‌صدا `true` می‌شود و اتصالِ لوکال با یک خطای نامربوطِ TLS می‌شکند.
   */
  it('رشته‌ی "false" واقعاً false می‌شود', () => {
    const env = loadEnv(databaseEnvSchema, {
      DATABASE_URL: "postgres://x@localhost:5432/y",
      DATABASE_SSL: "false",
    });
    expect(env.DATABASE_SSL).toBe(false);
  });

  it('رشته‌ی "true" واقعاً true می‌شود', () => {
    const env = loadEnv(databaseEnvSchema, {
      DATABASE_URL: "postgres://x@localhost:5432/y",
      DATABASE_SSL: "true",
    });
    expect(env.DATABASE_SSL).toBe(true);
  });

  it("مقدارِ مبهم را رد می‌کند، نه اینکه حدس بزند", () => {
    expect(() =>
      loadEnv(databaseEnvSchema, {
        DATABASE_URL: "postgres://x@localhost:5432/y",
        DATABASE_SSL: "yes",
      }),
    ).toThrow(ConfigError);
  });
});

describe("APP_ENV — پایه‌ی گیتِ ADR-031", () => {
  it("سه مقدارِ مجاز را می‌پذیرد", () => {
    for (const value of ["local", "staging", "production"] as const) {
      expect(loadEnv(appEnvSchema, { APP_ENV: value }).APP_ENV).toBe(value);
    }
  });

  it("مقدارِ ناشناخته را رد می‌کند", () => {
    // یک غلطِ املاییِ ساده نباید بی‌صدا به «غیرِ production» تفسیر شود — چون
    // گیتِ ADR-031 دقیقاً روی همین مقدار تصمیم می‌گیرد که سرور بالا بیاید یا نه.
    expect(() => loadEnv(appEnvSchema, { APP_ENV: "prod" })).toThrow(ConfigError);
  });
});

describe("کلیدِ توسعه‌ای", () => {
  it("کلیدِ کوتاه را رد می‌کند", () => {
    expect(() => loadEnv(devAuthEnvSchema, { RT_DEV_JWT_SECRET: "short" })).toThrow(ConfigError);
  });

  it("کلیدِ ۳۲ کاراکتری را می‌پذیرد", () => {
    const secret = "x".repeat(32);
    expect(loadEnv(devAuthEnvSchema, { RT_DEV_JWT_SECRET: secret }).RT_DEV_JWT_SECRET).toBe(secret);
  });
});
