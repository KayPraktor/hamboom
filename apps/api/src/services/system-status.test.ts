import { createMemoryObjectStore } from "@hamboom/storage";
import type { ObjectStore } from "@hamboom/storage";
import { describe, expect, it } from "vitest";

import type { ReconcileSnapshot } from "../metrics.ts";
import {
  backupCheck,
  latestStamped,
  parseStamp,
  readSystemStatus,
  reconcileCheck,
  worstState,
} from "./system-status.ts";

/**
 * ★ M6 ۷٫۴ — بخش‌های **خالص** و مرزهای probe.
 * تاخیرِ واقعیِ شبکه و رفتارِ MinIO در ۷٫۰ اندازه‌گیری شد و در `sdk:contract` روی استکِ واقعی
 * می‌دود؛ این‌جا فقط منطقِ تصمیم است.
 */
const SNAP = (over: Partial<ReconcileSnapshot> = {}): ReconcileSnapshot => ({
  runs: 0,
  activated: 0,
  expired: 0,
  orphans: 0,
  adopted: 0,
  subscriptionsEnded: 0,
  errors: 0,
  lastRunAt: 0,
  ...over,
});

const NOW = 1_800_000_000_000;

/** استخرِ دروغین: فقط `clock_timestamp` را جواب می‌دهد. */
const fakePool = (skewMs: number): never =>
  ({
    query() {
      return Promise.resolve({ rows: [{ ms: String(NOW + skewMs) }] });
    },
  }) as never;

const deadPool = (): never =>
  ({
    query() {
      return Promise.reject(Object.assign(new Error("boom"), { code: "ECONNREFUSED" }));
    },
  }) as never;

/**
 * ⚠️ **انبارِ باکتِ ناموجود، دقیقاً با رفتارِ واقعیِ S3** (اندازه‌گیری‌شده در ۷٫۰):
 * `headObject` مثلِ «کلید نیست» **`null`** می‌دهد، ولی `iteratePrefix` صادقانه `NoSuchBucket` پرتاب می‌کند.
 */
const missingBucket = (): ObjectStore =>
  ({
    headObject: () => Promise.resolve(null),
    // eslint-disable-next-line require-yield
    async *iteratePrefix(): AsyncGenerator<string> {
      throw Object.assign(new Error("no such bucket"), { name: "NoSuchBucket" });
    },
  }) as unknown as ObjectStore;

const baseDeps = (over: Record<string, unknown> = {}): never =>
  ({
    pool: fakePool(0),
    stores: {
      assets: createMemoryObjectStore(),
      snapshots: createMemoryObjectStore(),
      backups: null,
    },
    redis: null,
    reconcile: { enabled: false, intervalSeconds: 300, snapshot: () => SNAP() },
    startedAtMs: NOW - 1000,
    staleBackupHours: 30,
    probeTimeoutMs: 500,
    now: () => NOW,
    ...over,
  }) as never;

describe("worstState — جمع‌بندیِ چک‌ها", () => {
  it("fail > warn > unknown > ok", () => {
    expect(worstState(["ok", "ok"])).toBe("ok");
    expect(worstState(["ok", "unknown"])).toBe("unknown");
    expect(worstState(["unknown", "warn"])).toBe("warn");
    expect(worstState(["warn", "fail"])).toBe("fail");
  });
  it("★ «نمی‌دانم» حالتِ کلی را به خرابی نمی‌بَرد — Redisِ پیکربندی‌نشده هشدار نیست", () => {
    expect(worstState(["ok", "unknown", "ok"])).toBe("unknown");
  });
});

describe("latestStamped — تازه‌ترین پشتیبان", () => {
  it("★★ بر اساسِ مهرِ **داخلِ نام** انتخاب می‌کند، نه مرتب‌سازیِ کلِ کلید", () => {
    // ⚠️ همان تله‌ی نهفته‌ی `restore-drill`: `sort().at(-1)` این‌جا `zeta` را برمی‌گرداند،
    //    یعنی «آخرین دیتابیس به ترتیبِ الفبا»، نه «تازه‌ترین پشتیبان».
    const keys = [
      "pg/alpha-2026-09-20T10-00-00Z.dump",
      "pg/zeta-2026-09-01T10-00-00Z.dump",
      "pg/alpha-2026-09-20T10-00-00Z.json",
    ];
    const pattern = /-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)\.dump$/;
    expect(latestStamped(keys, pattern)).toBe("pg/alpha-2026-09-20T10-00-00Z.dump");
    expect([...keys].sort().at(-1)).toBe("pg/zeta-2026-09-01T10-00-00Z.dump");
  });
  it("کلیدِ بی‌مهر نادیده می‌شود؛ هیچ تطبیقی ⇒ null", () => {
    expect(latestStamped(["pg/README.txt"], /-(\d+)\.dump$/)).toBeNull();
  });
});

describe("parseStamp", () => {
  it("مهرِ خط‌تیره‌ایِ backup-common را به تاریخ برمی‌گرداند", () => {
    expect(parseStamp("2026-09-09T13-13-12Z")?.toISOString()).toBe("2026-09-09T13:13:12.000Z");
  });
  it("شکلِ ناشناس ⇒ null (و آن‌وقت «نمی‌دانم»، نه «تازه»)", () => {
    expect(parseStamp("خرداد")).toBeNull();
  });
});

describe("backupCheck", () => {
  it("تازه ⇒ ok · کهنه‌تر از آستانه ⇒ warn", () => {
    expect(backupCheck(5, 30, true).state).toBe("ok");
    expect(backupCheck(30.1, 30, true).state).toBe("warn");
  });
  it("★ «هیچ پشتیبانی نیست» warn است، ولی «باکت پیکربندی نشده» unknown", () => {
    expect(backupCheck(null, 30, true).state).toBe("warn");
    expect(backupCheck(null, 30, false).state).toBe("unknown");
  });
});

describe("reconcileCheck — ★★ سه معنیِ متفاوتِ «هرگز اجرا نشده»", () => {
  const base = { intervalSeconds: 300, startedAtMs: NOW - 60_000, nowMs: NOW };
  it("خاموش ⇒ unknown، نه هشدار (روی هر ماشینِ dev درست است)", () => {
    const c = reconcileCheck(SNAP(), { ...base, enabled: false });
    expect(c.state).toBe("unknown");
  });
  it("فعال ولی هنوز نوبتِ اولین اجرا نرسیده ⇒ ok", () => {
    const c = reconcileCheck(SNAP(), { ...base, enabled: true });
    expect(c.state).toBe("ok");
  });
  it("فعال و از دو بازه گذشته و هرگز اجرا نشده ⇒ warn", () => {
    const c = reconcileCheck(SNAP(), { ...base, enabled: true, startedAtMs: NOW - 3_600_000 });
    expect(c.state).toBe("warn");
  });
  it("اجرا شده ولی کهنه ⇒ warn؛ تازه و بی‌خطا ⇒ ok؛ تازه با خطا ⇒ warn", () => {
    expect(
      reconcileCheck(SNAP({ runs: 3, lastRunAt: NOW - 2_000_000 }), { ...base, enabled: true })
        .state,
    ).toBe("warn");
    expect(
      reconcileCheck(SNAP({ runs: 3, lastRunAt: NOW - 10_000 }), { ...base, enabled: true }).state,
    ).toBe("ok");
    expect(
      reconcileCheck(SNAP({ runs: 3, errors: 2, lastRunAt: NOW - 10_000 }), {
        ...base,
        enabled: true,
      }).state,
    ).toBe("warn");
  });
});

describe("readSystemStatus — سیمِ کامل", () => {
  it("همه‌چیز سالم: db ok، باکت‌های حافظه‌ای ok، Redis/پشتیبانِ پیکربندی‌نشده unknown", async () => {
    const s = await readSystemStatus(baseDeps());
    const by = new Map(s.checks.map((c) => [c.key, c]));
    expect(by.get("db")?.state).toBe("ok");
    expect(by.get("s3:assets")?.state).toBe("ok");
    expect(by.get("s3:assets")?.detail).toContain("خالی");
    expect(by.get("redis")?.state).toBe("unknown");
    expect(by.get("s3:backups")?.state).toBe("unknown");
    expect(s.state).toBe("unknown");
    expect(s.clockSkewMs).toBe(0);
    expect(s.backup.ageHours).toBeNull();
  });

  it("★★ باکتِ **ناموجود** ⇒ fail — نه سبزِ دروغین. `headObject` این را `null` می‌دید و از دست می‌داد", async () => {
    const s = await readSystemStatus(
      baseDeps({
        stores: {
          assets: createMemoryObjectStore(),
          snapshots: createMemoryObjectStore(),
          backups: missingBucket(),
        },
      }),
    );
    const by = new Map(s.checks.map((c) => [c.key, c]));
    expect(by.get("s3:backups")?.state).toBe("fail");
    expect(by.get("s3:backups")?.detail).toContain("NoSuchBucket");
    expect(s.state).toBe("fail");
    // و سنِ پشتیبان «نمی‌دانم» می‌شود، نه یک عددِ ساختگی.
    expect(s.backup.lastDumpAt).toBeNull();
  });

  it("دیتابیسِ قطع ⇒ db fail و اختلافِ ساعت null (نه صفرِ دروغین)", async () => {
    const s = await readSystemStatus(baseDeps({ pool: deadPool() }));
    const by = new Map(s.checks.map((c) => [c.key, c]));
    expect(by.get("db")?.state).toBe("fail");
    expect(by.get("db")?.detail).toContain("ECONNREFUSED");
    expect(by.get("clock")?.state).toBe("unknown");
    expect(s.clockSkewMs).toBeNull();
    expect(s.state).toBe("fail");
  });

  it("★★ اختلافِ ساعتِ بیش از رواداریِ step-up ⇒ warn (همان باگِ حلقه‌ی ۴۲۸ی ۷٫۱b)", async () => {
    const ok = await readSystemStatus(baseDeps({ pool: fakePool(1_500) }));
    expect(ok.checks.find((c) => c.key === "clock")?.state).toBe("ok");
    const warn = await readSystemStatus(baseDeps({ pool: fakePool(9_000) }));
    const clock = warn.checks.find((c) => c.key === "clock");
    expect(clock?.state).toBe("warn");
    expect(clock?.detail).toContain("۴۲۸");
  });

  it("سنِ پشتیبان از تازه‌ترینِ dump و آینه می‌آید و به ساعت گزارش می‌شود", async () => {
    const backups = createMemoryObjectStore();
    await backups.putObject("pg/hamboom-2026-09-09T13-13-12Z.dump", new Uint8Array([1]));
    await backups.putObject("storage/manifest-2026-09-10T00-00-00Z.json", new Uint8Array([2]));
    const s = await readSystemStatus(
      baseDeps({
        stores: {
          assets: createMemoryObjectStore(),
          snapshots: createMemoryObjectStore(),
          backups,
        },
      }),
    );
    expect(s.backup.lastDumpAt).not.toBeNull();
    expect(s.backup.lastMirrorAt).not.toBeNull();
    expect(s.backup.ageHours).not.toBeNull();
    expect(s.checks.find((c) => c.key === "s3:backups")?.state).toBe("ok");
  });
});
