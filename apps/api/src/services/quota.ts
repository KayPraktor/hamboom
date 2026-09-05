import { PLAN_CODE_SQL, STORAGE_BYTES_SQL } from "../dto.ts";
import { HttpError } from "../errors.ts";
import type { Executor } from "../plugins/db.ts";

/**
 * گیتِ ظرفیتِ پلن — [ADR-053](../../../../ARCHITECTURE_DECISIONS.md#adr-053) (M4 فاز ۶).
 *
 * ★★ **سه قاعده‌ای که نبودنشان گیت را تزئینی می‌کند:**
 *
 * ۱. **قفلِ ردیفِ تیم، قبل از شمردن.** بدونِ `SELECT … FOR UPDATE` روی `teams`، دو درخواستِ
 *    هم‌زمان زیرِ READ COMMITTED **هر دو** `count = max-1` می‌خوانند و هر دو commit می‌کنند.
 *    شمارش داخلِ تراکنش به‌تنهایی هیچ‌چیز را اتمیک نمی‌کند.
 *
 * ۲. **`-1` یعنی نامحدود.** چکِ طبیعیِ `count >= max` روی پلنِ نامحدود **همه‌چیز را می‌بندد**
 *    (`count >= -1` همیشه درست است) — یعنی گیت دقیقاً برعکس کار می‌کند.
 *
 * ۳. ★★ **گیت فقط `teamId` می‌گیرد و هرگز نقش را حل نمی‌کند.** `effectiveBoardRole` به
 *    کاربرِ `is_staff` روی **هر** بورد نقشِ `owner` می‌دهد؛ اگر گیت به شکلِ «نقش را حل کن،
 *    owner رد شود» نوشته شود، هر حسابِ staff **ظرفیتِ نامحدودِ رایگان** می‌گیرد. ظرفیت
 *    خاصیتِ **تیم** است، نه خاصیتِ کاربر.
 *
 * ⚠️ مصرف با `count(*)`ِ **واقعی** خوانده می‌شود، نه از `usage_counters` — که از M3 درج
 * می‌شد و هرگز به‌روز نمی‌شد (B-5)، پس `members_count`ش همیشه صفر بود. کشِ اشتباه در این
 * دامنه یعنی یا مشتری بی‌جهت بلوکه می‌شود یا سرویسِ پولی رایگان بیرون می‌رود.
 */

/** ابعادی که سقف دارند — نامشان با ستون‌های `plans` یکی است. */
export type QuotaDimension = "boards" | "members" | "storage";

interface Limits {
  planCode: string;
  maxBoards: number;
  maxMembers: number;
  maxStorageBytes: number;
}

const UNLIMITED = -1;

const MESSAGES: Record<QuotaDimension, (limit: number) => string> = {
  boards: (n) => `پلنِ فعلی حداکثر ${n} بورد اجازه می‌دهد. برای بوردِ بیشتر، پلن را ارتقا بده.`,
  members: (n) => `پلنِ فعلی حداکثر ${n} عضو اجازه می‌دهد. برای عضوِ بیشتر، پلن را ارتقا بده.`,
  storage: () => "فضای پلنِ فعلی پر شده. برای فضای بیشتر، پلن را ارتقا بده.",
};

/**
 * ردیفِ تیم را **قفل** می‌کند و سقف‌های پلنش را می‌خوانَد.
 *
 * ⚠️ حتماً باید داخلِ یک تراکنش صدا زده شود — بیرونش قفل بی‌درنگ آزاد می‌شود و قاعده ۱
 * بی‌اثر است. فراخوان‌ها `tx` را پاس می‌دهند، نه `pool` را.
 */
async function lockTeamAndReadLimits(tx: Executor, teamId: string): Promise<Limits> {
  // قفل جدا از JOINهاست چون `FOR UPDATE` با LEFT JOIN روی جدولِ سمتِ راست مجاز نیست.
  const locked = await tx.query("SELECT 1 FROM teams WHERE id = $1 FOR UPDATE", [teamId]);
  if (locked.rows.length === 0) throw new HttpError(404, "TEAM_NOT_FOUND", "تیم یافت نشد.");

  const { rows } = await tx.query<{
    plan_code: string;
    max_boards: number;
    max_members: number;
    max_storage_bytes: number;
  }>(
    `SELECT ${PLAN_CODE_SQL} AS plan_code, p.max_boards, p.max_members, p.max_storage_bytes
       FROM teams t
       LEFT JOIN subscriptions s
              ON s.team_id = t.id AND s.status IN ('trialing', 'active', 'past_due')
       LEFT JOIN plans p ON p.code = ${PLAN_CODE_SQL}
      WHERE t.id = $1`,
    [teamId],
  );
  const row = rows[0];
  if (row === undefined || row.max_boards === null) {
    // ردیفِ پلن پیدا نشد ⇒ **fail closed**. یک پلنِ گم‌شده نباید به ظرفیتِ نامحدود ترجمه شود.
    throw new HttpError(500, "INTERNAL", "پلنِ این تیم قابلِ تعیین نیست.");
  }
  return {
    planCode: row.plan_code,
    maxBoards: Number(row.max_boards),
    maxMembers: Number(row.max_members),
    maxStorageBytes: Number(row.max_storage_bytes),
  };
}

/** مصرفِ فعلیِ یک بُعد — همیشه شمارشِ واقعی. */
async function currentUsage(
  tx: Executor,
  teamId: string,
  dimension: QuotaDimension,
): Promise<number> {
  if (dimension === "boards") {
    const { rows } = await tx.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM boards WHERE team_id = $1 AND deleted_at IS NULL",
      [teamId],
    );
    return rows[0]!.n;
  }
  if (dimension === "members") {
    // ⚠️ `guest` هم شمرده می‌شود — **عمداً**، تا با `memberCount`ِ همان DTO یکی باشد. اگر
    //    گیت و نمایش دو تعریفِ متفاوت داشته باشند، کاربر عددی می‌بیند که با خطایی که
    //    می‌گیرد جور درنمی‌آید.
    const { rows } = await tx.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM team_members WHERE team_id = $1",
      [teamId],
    );
    return rows[0]!.n;
  }
  const { rows } = await tx.query<{ n: number }>(
    `SELECT (${STORAGE_BYTES_SQL.replace("t.id", "$1")}) AS n`,
    [teamId],
  );
  return Number(rows[0]!.n);
}

const limitFor = (limits: Limits, d: QuotaDimension): number =>
  d === "boards" ? limits.maxBoards : d === "members" ? limits.maxMembers : limits.maxStorageBytes;

/**
 * ★ اگر افزودنِ `delta` واحد از این بُعد تیم را از سقف رد کند، `QUOTA_EXCEEDED` می‌اندازد.
 *
 * سیاستِ downgrade (M4-D8) از همین شکل **مشتق** می‌شود: تیمی که از قبل بالای سقف است
 * هیچ داده‌ای از دست نمی‌دهد — فقط این تابع جلوی **ساختِ جدید** را می‌گیرد.
 */
export async function assertQuota(
  tx: Executor,
  teamId: string,
  dimension: QuotaDimension,
  delta = 1,
): Promise<void> {
  const limits = await lockTeamAndReadLimits(tx, teamId);
  const limit = limitFor(limits, dimension);

  // ★ سنتینلِ نامحدود — **قبل از** هر مقایسه‌ای، وگرنه گیت روی پلنِ پولی وارونه می‌شود.
  if (limit === UNLIMITED) return;

  const used = await currentUsage(tx, teamId, dimension);
  if (used + delta > limit) {
    throw new HttpError(409, "QUOTA_EXCEEDED", MESSAGES[dimension](limit), {
      dimension,
      limit,
      used,
      planCode: limits.planCode,
    });
  }
}
