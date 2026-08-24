import { createHash, randomBytes } from "node:crypto";

/**
 * refreshِ چرخشی با تشخیصِ استفاده‌ی مجدد — [ADR-011](../../../ARCHITECTURE_DECISIONS.md#adr-011).
 *
 * refresh token **مات** (تصادفی، نه JWT) است تا قابلِ ابطال باشد؛ در store فقط **هش**ش می‌ماند
 * (خودِ توکن هرگز ذخیره نمی‌شود). هر چرخش توکنِ نو می‌دهد و قدیمی را «مصرف‌شده» می‌کند.
 *
 * ★★ **تصمیمِ امنیتیِ استفاده‌ی مجدد (تاییدِ مالک ۱۴۰۵/۰۵/۲۸):** توکن **یک‌بارمصرف** است. اگر یک
 * توکنِ **قبلاً‌چرخانده‌شده** دوباره ارائه شود، نشانه‌ی نشت/دزدی است — پس **کلِ خانواده** (همه‌ی
 * چرخش‌های یک ورود) باطل می‌شود، نه فقط ردِ همان یکی. هرکه دوم استفاده کند گیر می‌افتد و ابطال
 * هر دو طرف (کاربر و مهاجم) را بیرون می‌اندازد.
 *
 * ⚠️ **قیدِ اتمی‌بودن برای فاز ۵:** «یافتن + چک + markUsed» باید در **یک تراکنشِ DB** (`SELECT …
 * FOR UPDATE`) باشد، وگرنه دو درخواستِ همزمانِ سالم هر دو `used=false` می‌بینند. نمونه‌ی حافظه‌ای
 * تک‌رشته‌ای است پس اینجا مسئله نیست؛ پیاده‌سازیِ Postgresِ فاز ۵ باید اتمی باشد.
 */

/** رکوردِ نشست در store — پیاده‌سازیِ DBش (`auth_sessions`) فاز ۵. */
export interface SessionRecord {
  /** هشِ توکن — خودِ توکن هرگز ذخیره نمی‌شود. */
  tokenHash: string;
  /** خانواده: همه‌ی چرخش‌های یک ورود. */
  familyId: string;
  sub: string;
  /** آیا این توکن قبلاً چرخانده شده؟ (یک‌بارمصرف) */
  used: boolean;
  /** unix seconds. */
  expiresAt: number;
}

export interface SessionStore {
  findByHash(tokenHash: string): Promise<SessionRecord | null>;
  insert(record: SessionRecord): Promise<void>;
  markUsed(tokenHash: string): Promise<void>;
  /** ★★ کلِ خانواده را باطل کن (نشانه‌ی دزدی). */
  burnFamily(familyId: string): Promise<void>;
}

export class RefreshError extends Error {
  readonly code: "invalid" | "expired" | "reuse";

  // ⚠️ فیلدِ صریح، نه parameter property (strip-only-سازگاری برای اجرای زیرِ Node در apps/api).
  constructor(code: "invalid" | "expired" | "reuse", message: string) {
    super(message);
    this.name = "RefreshError";
    this.code = code;
  }
}

export interface RefreshConfig {
  /** عمرِ refresh (ثانیه). */
  ttlSeconds: number;
  clock?: () => number;
  /** تزریق‌پذیر برای تستِ قطعی. */
  newToken?: () => string;
  newFamilyId?: () => string;
}

const sha256hex = (s: string): string => createHash("sha256").update(s).digest("hex");
const nowSeconds = (clock?: () => number): number => Math.floor((clock?.() ?? Date.now()) / 1000);
const defaultToken = (): string => randomBytes(32).toString("base64url");
const defaultFamily = (): string => randomBytes(16).toString("hex");

/** ورودِ نو → خانواده‌ی تازه + توکنِ ریشه. راوِ توکن را برمی‌گرداند (فقط همین‌جا دیده می‌شود). */
export async function startSession(
  store: SessionStore,
  sub: string,
  config: RefreshConfig,
): Promise<string> {
  const token = (config.newToken ?? defaultToken)();
  await store.insert({
    tokenHash: sha256hex(token),
    familyId: (config.newFamilyId ?? defaultFamily)(),
    sub,
    used: false,
    expiresAt: nowSeconds(config.clock) + config.ttlSeconds,
  });
  return token;
}

export interface RotateResult {
  sub: string;
  refreshToken: string;
}

/** چرخش — با تشخیصِ استفاده‌ی مجدد (بالا). موفق: توکنِ نو در **همان خانواده**. */
export async function rotateSession(
  store: SessionStore,
  rawToken: string,
  config: RefreshConfig,
): Promise<RotateResult> {
  const hash = sha256hex(rawToken);
  const record = await store.findByHash(hash);
  if (record === null) throw new RefreshError("invalid", "refresh نامعتبر است");

  if (record.used) {
    // ★★ استفاده‌ی مجدد از توکنِ چرخانده‌شده = نشانه‌ی نشت → کلِ خانواده می‌سوزد.
    await store.burnFamily(record.familyId);
    throw new RefreshError("reuse", "استفاده‌ی مجدد از refresh — کلِ نشست باطل شد");
  }

  if (record.expiresAt <= nowSeconds(config.clock)) {
    throw new RefreshError("expired", "refresh منقضی شده است");
  }

  await store.markUsed(hash);
  const next = (config.newToken ?? defaultToken)();
  await store.insert({
    tokenHash: sha256hex(next),
    familyId: record.familyId,
    sub: record.sub,
    used: false,
    expiresAt: nowSeconds(config.clock) + config.ttlSeconds,
  });
  return { sub: record.sub, refreshToken: next };
}

/** نمونه‌ی حافظه‌ای برای تست — پیاده‌سازیِ DB فاز ۵. */
export function createMemorySessionStore(): SessionStore {
  const byHash = new Map<string, SessionRecord>();
  return {
    findByHash: (h) => Promise.resolve(byHash.get(h) ?? null),
    insert: (r) => {
      byHash.set(r.tokenHash, { ...r });
      return Promise.resolve();
    },
    markUsed: (h) => {
      const r = byHash.get(h);
      if (r) r.used = true;
      return Promise.resolve();
    },
    burnFamily: (fam) => {
      for (const [h, r] of byHash) if (r.familyId === fam) byHash.delete(h);
      return Promise.resolve();
    },
  };
}
