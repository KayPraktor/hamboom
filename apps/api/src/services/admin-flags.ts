/**
 * نمای **فقط‌خواندنیِ** `feature_flags` — M6 فاز ۷٫۵ (M6-D7).
 *
 * ⚠️ ارزیاب و CRUD عمداً بیرون‌اند: جدول از M3 وجود دارد و **صفر مصرف‌کننده** دارد. یک ارزیابِ
 * بی‌خواننده دقیقاً همان `usage_counters`ِ B-5 می‌شود — کدی که کسی صدایش نمی‌زند و بی‌صدا کهنه
 * می‌شود. این نما فقط می‌گوید «امروز چه چیزی در این جدول هست»، و امروز جوابش **هیچ** است.
 */
import type { Executor } from "../plugins/db.ts";
import type { FeatureFlagRow } from "../dto.ts";

/**
 * همه‌ی پرچم‌ها — بدونِ صفحه‌بندی، چون این جدول ذاتاً کوچک است (یک ردیف به‌ازای هر قابلیت).
 * اگر روزی بزرگ شد، همان الگوی keysetِ `audit-log.ts` این‌جا هم می‌آید.
 */
export async function readFeatureFlags(db: Executor): Promise<FeatureFlagRow[]> {
  const { rows } = await db.query<FeatureFlagRow>(
    `SELECT key, enabled, rollout_pct, team_ids, updated_at
       FROM feature_flags ORDER BY key`,
  );
  return rows;
}
