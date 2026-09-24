/**
 * وضعیتِ زنده‌ی زیرساخت برای پنلِ ادمین — M6 فاز ۷٫۴
 * ([ADR-067](../../../../ARCHITECTURE_DECISIONS.md#adr-067)).
 *
 * ★★ **چرا یک مسیرِ جدا و نه عمیق‌کردنِ `/readyz`:** `/readyz` تصمیمِ **استقرار** است. یک وابستگیِ
 * کُند آن را به «ناسالم»ِ دروغین تبدیل می‌کند و کلِ سرویس را از چرخه بیرون می‌اندازد (اندازه‌گیریِ
 * M5: میزبانِ غیرقابلِ دسترس ⇒ ۲۱ ثانیه). این‌جا تصمیمِ **اپراتور** است: می‌تواند کند باشد، می‌تواند
 * «نمی‌دانم» بگوید، و هیچ‌چیزی را از چرخه بیرون نمی‌اندازد. `/readyz` دست نمی‌خورد.
 *
 * ★★ **چرا `iteratePrefix` و نه `headObject` برای باکت‌ها — اندازه‌گیری‌شده:** `headObject` روی
 * باکتِ **ناموجود** هم `null` برمی‌گرداند (S3 برای هر دو ۴۰۴ می‌دهد و `isNotFound` آن را می‌بلعد)،
 * پس یک چکِ سلامتِ ساده‌لوح روی باکتِ گم‌شده یا نامِ غلط **سبز** می‌مانْد. `iteratePrefix` صادقانه
 * `NoSuchBucket` پرتاب می‌کند (۲٫۵ms). این دقیقاً همان سبزِ دروغینی است که این ریپو شکار می‌کند.
 *
 * ★★ **هر probe مهلتِ خودش را دارد.** اندازه‌گیریِ ۷٫۰ روی RESP PING: زنده ۱۵٫۸ms · پورتِ بسته
 * `ECONNREFUSED` در ۲٫۶ms · IPِ سیاه‌چاله **۱۵۰۷ms یعنی خودِ مهلت** · و میزبانِ ناموجود هم **مهلت**،
 * نه `ENOTFOUND`. یعنی نجات‌دهنده کدِ خطا نیست، مهلتِ خودمان است.
 *
 * ⚠️ **P7 در کلِ این فایل:** هیچ رشته‌ی اتصال، رمز یا متنِ خامِ خطا از این‌جا بیرون نمی‌رود و لاگ هم
 * نمی‌شود. پیام‌ها فارسیِ ثابت‌اند و حداکثر یک **کدِ** خطا همراه دارند.
 */
import net from "node:net";
import tls from "node:tls";

import type { ObjectStore } from "@hamboom/storage";
import type { SystemCheck, SystemCheckState, SystemStatus } from "@hamboom/shared-types";
import type pg from "pg";

import type { ReconcileSnapshot } from "../metrics.ts";

/** ترتیبِ بدی — برای جمع‌بندیِ «بدترینِ چک‌ها». */
const SEVERITY: Record<SystemCheckState, number> = { ok: 0, unknown: 1, warn: 2, fail: 3 };

/**
 * ⚠️ همان عددِ `CLOCK_SKEW_TOLERANCE_MS`ِ [`admin-guard.ts`](../admin-guard.ts). بیرونِ این بازه،
 * step-up دوباره به حلقه‌ی ۴۲۸ می‌افتد — پس همین‌جا هشدار داده می‌شود تا نامرئی نماند.
 */
const CLOCK_WARN_MS = 2_000;

export interface SystemProbeDeps {
  pool: pg.Pool;
  /** `null` یعنی آن باکت برای api پیکربندی نشده — «نمی‌دانم»، نه «خراب». */
  stores: { assets: ObjectStore; snapshots: ObjectStore; backups: ObjectStore | null };
  /** `null` یعنی `REDIS_URL` برای api ست نشده (اختیاری است — انحرافِ تاییدشده‌ی «د»). */
  redis: { url: string; tls: boolean } | null;
  reconcile: {
    enabled: boolean;
    intervalSeconds: number;
    snapshot: () => ReconcileSnapshot;
  };
  /** زمانِ بالا‌آمدنِ پروسه (ms) — برای تفکیکِ «هنوز نوبتش نرسیده» از «هرگز اجرا نشده». */
  startedAtMs: number;
  staleBackupHours: number;
  probeTimeoutMs: number;
  now?: () => number;
}

/** بدترینِ حالت‌ها. */
export function worstState(states: readonly SystemCheckState[]): SystemCheckState {
  let worst: SystemCheckState = "ok";
  for (const s of states) if (SEVERITY[s] > SEVERITY[worst]) worst = s;
  return worst;
}

/** خطا → یک **کد**، نه متن. `code`ِ libuv/pg، یا نامِ کلاس. هرگز `message` (می‌تواند رشته‌ی اتصال داشته باشد). */
function errorCode(e: unknown): string {
  const err = e as { code?: unknown; name?: unknown };
  if (typeof err.code === "string" && err.code.length > 0 && err.code.length <= 40) return err.code;
  if (typeof err.name === "string" && err.name.length > 0 && err.name.length <= 40) return err.name;
  return "UNKNOWN";
}

/** مهلتِ سخت روی یک promise. ⚠️ خطای promiseِ بازنده بلعیده می‌شود تا unhandled rejection نشود. */
function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });
  p.catch(() => undefined);
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * PINGِ RESP روی سوکتِ خام — **بدونِ هیچ وابستگیِ نو** (قانونِ ۷ی M6؛ `ioredis` وابستگیِ
 * `apps/realtime` است، نه api).
 *
 * ⚠️ فقط ادعا می‌کند «Redis پاسخ می‌دهد». نمی‌گوید اتاق‌ها صاحب دارند یا گذرگاه سالم است —
 * آن گیج کارِ M2 است (واقعیتِ فاز ۰، مورد ۷).
 */
export async function pingRedis(
  target: { url: string; tls: boolean },
  timeoutMs: number,
): Promise<{ ms: number; detail: string }> {
  let parsed: URL;
  try {
    parsed = new URL(target.url);
  } catch {
    throw new Error("URL_INVALID");
  }
  const useTls = target.tls || parsed.protocol === "rediss:";
  const host = parsed.hostname;
  const port = Number(parsed.port || 6379);
  const password = parsed.password === "" ? undefined : decodeURIComponent(parsed.password);
  const username = parsed.username === "" ? undefined : decodeURIComponent(parsed.username);

  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    const socket = useTls
      ? tls.connect({ host, port, servername: host })
      : net.createConnection({ host, port });
    let settled = false;
    const done = (err: Error | null, detail?: string): void => {
      if (settled) return;
      settled = true;
      const ms = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
      socket.destroy();
      if (err) reject(err);
      else resolve({ ms, detail: detail ?? "+PONG" });
    };
    socket.setTimeout(timeoutMs);
    socket.on(useTls ? "secureConnect" : "connect", () => {
      // ★ فرمانِ inlineِ RESP کافی است؛ AUTH فقط وقتی رمز هست.
      const auth =
        password === undefined
          ? ""
          : `AUTH ${username === undefined ? "" : `${username} `}${password}\r\n`;
      socket.write(`${auth}PING\r\n`);
    });
    let buf = "";
    socket.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      if (buf.includes("+PONG")) done(null);
      else if (buf.startsWith("-") && buf.includes("\r\n")) {
        // ⚠️ فقط **کدِ** خطا (اولین توکن) — نه کلِ متن، نه چیزی که رمز را بازتاب دهد.
        done(new Error(buf.slice(1).split(/[\s\r]/)[0] ?? "ERR"));
      }
    });
    socket.on("timeout", () => done(new Error("TIMEOUT")));
    socket.on("error", (e) =>
      done(e instanceof Error ? new Error(errorCode(e)) : new Error("UNKNOWN")),
    );
  });
}

/** اولین کلیدِ یک prefix — یعنی «باکت واقعاً هست و خوانده می‌شود». باکتِ **خالی** هم سالم است. */
async function firstKeyOf(store: ObjectStore, prefix: string): Promise<string | null> {
  for await (const key of store.iteratePrefix(prefix)) return key;
  return null;
}

async function probeBucket(
  key: string,
  store: ObjectStore | null,
  timeoutMs: number,
): Promise<SystemCheck> {
  if (store === null) {
    return { key, state: "unknown", detail: "برای این سرویس پیکربندی نشده است.", latencyMs: null };
  }
  const t0 = process.hrtime.bigint();
  const ms = (): number => Math.round(Number(process.hrtime.bigint() - t0) / 1e6);
  try {
    const first = await withDeadline(firstKeyOf(store, ""), timeoutMs, "TIMEOUT");
    return {
      key,
      state: "ok",
      detail: first === null ? "در دسترس است (باکتِ خالی)." : "در دسترس است.",
      latencyMs: ms(),
    };
  } catch (e) {
    return { key, state: "fail", detail: `در دسترس نیست (${errorCode(e)}).`, latencyMs: ms() };
  }
}

/** تازه‌ترین کلیدِ یک prefix بر اساسِ **مهرِ زمانیِ داخلِ نام** — نه مرتب‌سازیِ کلِ کلید. */
export function latestStamped(keys: readonly string[], pattern: RegExp): string | null {
  let bestKey: string | null = null;
  let bestStamp = "";
  for (const k of keys) {
    const m = pattern.exec(k);
    if (m === null || m[1] === undefined) continue;
    if (m[1] > bestStamp) {
      bestStamp = m[1];
      bestKey = k;
    }
  }
  return bestKey;
}

/**
 * ⚠️ چرا بر اساسِ مهرِ **داخلِ نام** و نه `sort().at(-1)`: کلیدِ dump به شکلِ
 * `pg/<database>-<stamp>.dump` است، پس مرتب‌سازیِ کلِ کلید «آخرین دیتابیس به ترتیبِ الفبا» را
 * می‌دهد، نه «تازه‌ترین پشتیبان». (`restore-drill` هم همین نقصِ نهفته را دارد — ثبت شد.)
 */
const DUMP_STAMP = /-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)\.dump$/;
const MIRROR_STAMP = /^storage\/manifest-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)\.json$/;

/** `2026-09-09T13-13-12Z` → `Date`. `null` اگر شکل نخورد (و آن‌وقت «نمی‌دانم»، نه «تازه»). */
export function parseStamp(stamp: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z$/.exec(stamp);
  if (m === null) return null;
  const d = new Date(`${m[1]!}T${m[2]!}:${m[3]!}:${m[4]!}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function latestUnder(
  store: ObjectStore,
  prefix: string,
  pattern: RegExp,
  timeoutMs: number,
): Promise<Date | null> {
  const collect = async (): Promise<string[]> => {
    const keys: string[] = [];
    for await (const k of store.iteratePrefix(prefix)) keys.push(k);
    return keys;
  };
  const keys = await withDeadline(collect(), timeoutMs, "TIMEOUT");
  const key = latestStamped(keys, pattern);
  if (key === null) return null;
  const head = await withDeadline(store.headObject(key), timeoutMs, "TIMEOUT");
  if (head?.lastModified !== undefined) return head.lastModified;
  const m = pattern.exec(key);
  return m?.[1] === undefined ? null : parseStamp(m[1]);
}

/**
 * ساعتِ Postgres منهای ساعتِ این پروسه، به میلی‌ثانیه.
 *
 * ⚠️ **تخمین است، نه اندازه‌گیریِ دقیق:** لحظه‌ی سمتِ ما نقطه‌ی وسطِ رفت‌وبرگشت فرض می‌شود، پس
 * خطایش تا حدودِ **نصفِ زمانِ پاسخ** است (روی همین ماشین: probeِ مستقیم ۰–۲ms داد، همین مسیر
 * با رفت‌وبرگشتِ ۱۶ms عددِ ۱۲ms). برای آستانه‌ی ۲ ثانیه‌ای کاملاً کافی است، ولی نما نباید
 * وانمود کند دقیق است — و نمی‌کند.
 */
interface DbProbe {
  check: SystemCheck;
  skewMs: number | null;
}

async function probeDb(pool: pg.Pool, timeoutMs: number, now: () => number): Promise<DbProbe> {
  const t0 = process.hrtime.bigint();
  const ms = (): number => Math.round(Number(process.hrtime.bigint() - t0) / 1e6);
  try {
    const before = now();
    const res = await withDeadline(
      pool.query<{ ms: string | number }>(
        "SELECT (extract(epoch from clock_timestamp()) * 1000)::bigint AS ms",
      ),
      timeoutMs,
      "TIMEOUT",
    );
    const after = now();
    const dbMs = Number(res.rows[0]?.ms ?? Number.NaN);
    const skew = Number.isNaN(dbMs) ? null : Math.round(dbMs - (before + after) / 2);
    return {
      check: { key: "db", state: "ok", detail: "پاسخ می‌دهد.", latencyMs: ms() },
      skewMs: skew,
    };
  } catch (e) {
    return {
      check: {
        key: "db",
        state: "fail",
        detail: `پاسخ نمی‌دهد (${errorCode(e)}).`,
        latencyMs: ms(),
      },
      skewMs: null,
    };
  }
}

async function probeRedis(
  target: SystemProbeDeps["redis"],
  timeoutMs: number,
): Promise<SystemCheck> {
  if (target === null) {
    return {
      key: "redis",
      state: "unknown",
      detail: "برای api پیکربندی نشده است (اختیاری).",
      latencyMs: null,
    };
  }
  try {
    const r = await pingRedis(target, timeoutMs);
    return { key: "redis", state: "ok", detail: "پاسخ می‌دهد (PONG).", latencyMs: r.ms };
  } catch (e) {
    return {
      key: "redis",
      state: "fail",
      detail: `پاسخ نمی‌دهد (${errorCode(e)}). ⚠️ تا بازگشتش هیچ نودی روی بورد نمی‌نویسد.`,
      latencyMs: null,
    };
  }
}

function clockCheck(skewMs: number | null): SystemCheck {
  if (skewMs === null) {
    return { key: "clock", state: "unknown", detail: "دیتابیس پاسخ نداد.", latencyMs: null };
  }
  const abs = Math.abs(skewMs);
  if (abs <= CLOCK_WARN_MS) {
    return {
      key: "clock",
      state: "ok",
      detail: `اختلافِ ساعتِ دیتابیس و api: ${skewMs}ms.`,
      latencyMs: null,
    };
  }
  return {
    key: "clock",
    state: "warn",
    detail: `اختلافِ ساعتِ دیتابیس و api ${skewMs}ms است (بیش از ${CLOCK_WARN_MS}ms) — step-up می‌تواند به حلقه‌ی ۴۲۸ بیفتد.`,
    latencyMs: null,
  };
}

/**
 * ⚠️ سه معنیِ متفاوتِ «هرگز اجرا نشده» را جدا می‌کند — یک «هشدار»ِ یکسان برای هر سه،
 * روی هر ماشینِ dev گرگ‌گویی می‌کرد و اپراتور یاد می‌گرفت نادیده‌اش بگیرد.
 */
export function reconcileCheck(
  snap: ReconcileSnapshot,
  opts: { enabled: boolean; intervalSeconds: number; startedAtMs: number; nowMs: number },
): SystemCheck {
  const base = { key: "reconcile", latencyMs: null } as const;
  if (!opts.enabled) {
    return { ...base, state: "unknown", detail: "خاموش است (BILLING_RECONCILE_ENABLED=false)." };
  }
  const intervalMs = opts.intervalSeconds * 1000;
  if (snap.lastRunAt === 0) {
    const up = opts.nowMs - opts.startedAtMs;
    return up < intervalMs * 2
      ? { ...base, state: "ok", detail: "فعال است؛ هنوز نوبتِ اولین اجرا نرسیده." }
      : {
          ...base,
          state: "warn",
          detail:
            "فعال است ولی از زمانِ بالا‌آمدن هرگز اجرا نشده — یا تایمر گیر کرده، یا قفلِ رهبری هر بار به نودِ دیگری رسیده.",
        };
  }
  const age = opts.nowMs - snap.lastRunAt;
  if (age > intervalMs * 3) {
    return {
      ...base,
      state: "warn",
      detail: `آخرین اجرای تایمر ${Math.round(age / 60_000)} دقیقه پیش بوده (بازه ${opts.intervalSeconds}s).`,
    };
  }
  if (snap.errors > 0) {
    return { ...base, state: "warn", detail: `${snap.errors} خطا در اجراهای تایمر ثبت شده.` };
  }
  return { ...base, state: "ok", detail: `${snap.runs} اجرای تایمر، بدونِ خطا.` };
}

/** چکِ سنِ پشتیبان — `unknown` یعنی «نمی‌دانم»، که با «کهنه» یکی نیست. */
export function backupCheck(
  ageHours: number | null,
  staleAfterHours: number,
  configured: boolean,
): SystemCheck {
  const base = { key: "backup", latencyMs: null } as const;
  if (!configured) {
    return { ...base, state: "unknown", detail: "باکتِ پشتیبان برای api پیکربندی نشده است." };
  }
  if (ageHours === null) {
    return { ...base, state: "warn", detail: "هیچ پشتیبانی در باکت پیدا نشد." };
  }
  const h = Math.round(ageHours * 10) / 10;
  return ageHours > staleAfterHours
    ? {
        ...base,
        state: "warn",
        detail: `تازه‌ترین پشتیبان ${h} ساعت پیش است (آستانه ${staleAfterHours}).`,
      }
    : { ...base, state: "ok", detail: `تازه‌ترین پشتیبان ${h} ساعت پیش.` };
}

/**
 * همه‌ی probeها **موازی** و هر کدام با مهلتِ خودش، پس سقفِ زمانِ کلِ درخواست ≈ یک مهلت است، نه جمعشان.
 */
export async function readSystemStatus(deps: SystemProbeDeps): Promise<SystemStatus> {
  const now = deps.now ?? Date.now;
  const t = deps.probeTimeoutMs;

  const backupsStore = deps.stores.backups;
  const [db, assets, snapshots, backups, redis, dumpAt, mirrorAt] = await Promise.all([
    probeDb(deps.pool, t, now),
    probeBucket("s3:assets", deps.stores.assets, t),
    probeBucket("s3:snapshots", deps.stores.snapshots, t),
    probeBucket("s3:backups", backupsStore, t),
    probeRedis(deps.redis, t),
    backupsStore === null
      ? Promise.resolve(null)
      : latestUnder(backupsStore, "pg/", DUMP_STAMP, t).catch(() => null),
    backupsStore === null
      ? Promise.resolve(null)
      : latestUnder(backupsStore, "storage/manifest-", MIRROR_STAMP, t).catch(() => null),
  ]);

  const newest = [dumpAt, mirrorAt]
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const ageHours = newest === undefined ? null : (now() - newest.getTime()) / 3_600_000;

  const snap = deps.reconcile.snapshot();
  const checks: SystemCheck[] = [
    db.check,
    assets,
    snapshots,
    backups,
    redis,
    clockCheck(db.skewMs),
    backupCheck(ageHours, deps.staleBackupHours, backupsStore !== null),
    reconcileCheck(snap, {
      enabled: deps.reconcile.enabled,
      intervalSeconds: deps.reconcile.intervalSeconds,
      startedAtMs: deps.startedAtMs,
      nowMs: now(),
    }),
  ];

  return {
    generatedAt: new Date(now()).toISOString(),
    state: worstState(checks.map((c) => c.state)),
    checks,
    backup: {
      lastDumpAt: dumpAt?.toISOString() ?? null,
      lastMirrorAt: mirrorAt?.toISOString() ?? null,
      ageHours: ageHours === null ? null : Math.round(ageHours * 100) / 100,
      staleAfterHours: deps.staleBackupHours,
    },
    reconcile: {
      enabled: deps.reconcile.enabled,
      intervalSeconds: deps.reconcile.intervalSeconds,
      lastRunAt: snap.lastRunAt === 0 ? null : new Date(snap.lastRunAt).toISOString(),
      runs: snap.runs,
      activated: snap.activated,
      expired: snap.expired,
      orphans: snap.orphans,
      adopted: snap.adopted,
      errors: snap.errors,
    },
    clockSkewMs: db.skewMs,
  };
}
