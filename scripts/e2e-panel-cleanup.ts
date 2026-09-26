/**
 * پاک‌کردنِ فیکسچرهای E2Eِ پنل — M6 ردیفِ ۸٫۱.
 *
 * ★★ **ترتیب اجباری است، و هر سطرش یک FKِ واقعی است.** دو تای اولش را همین امروز با شکست
 * یاد گرفتیم: ردیفِ ممیزیِ `staff.grant` **عاملش** خودِ کاربرِ staff است (نه فقط هدفش)، و
 * حذفِ کاربر بدونِ آن روی `audit_logs_actor_user_id_fkey` می‌شکند؛ و پرداختِ تاییدشده‌ی
 * کارت‌به‌کارت `transfer_approved_by` دارد که به کاربرِ **دیگری** اشاره می‌کند.
 *
 * ⚠️ فقط شناسه‌هایی را پاک می‌کند که به آن **داده شده‌اند**. هیچ `LIKE` و هیچ حدسی — یک
 * اسکریپتِ پاک‌سازی که الگو حدس بزند، روزی داده‌ی واقعی را می‌برد.
 *
 * اجرا (خودِ playwright صدایش می‌زند):
 *   node --env-file-if-exists=.env scripts/e2e-panel-cleanup.ts --users=a,b --phones=09…,09…
 */
import { databaseEnvSchema, loadEnv } from "@hamboom/config";

import { createDbPool } from "../apps/api/src/plugins/db.ts";

const arg = (name: string): string[] => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  if (hit === undefined) return [];
  return hit
    .slice(name.length + 3)
    .split(",")
    .filter((s) => s.length > 0);
};

const users = arg("users");
const phones = arg("phones");
if (users.length === 0) {
  console.error("هیچ کاربری داده نشد — چیزی پاک نمی‌شود. (--users=…)");
  process.exit(1);
}

const env = loadEnv(databaseEnvSchema);
const pool = createDbPool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_SSL,
  poolMax: 2,
});

// ★ تیم‌های این کاربران از دیتابیس خوانده می‌شود، نه از آرگومان: تیمِ شخصی خودکار ساخته شده
//   و اگر جا بمانَد، کاربرش هم قابلِ حذف نیست.
const { rows } = await pool.query<{ id: string }>(
  "SELECT id FROM teams WHERE owner_user_id = ANY($1)",
  [users],
);
const teams = rows.map((r) => r.id);

const q = async (sql: string, params: unknown[]): Promise<number> =>
  (await pool.query(sql, params)).rowCount ?? 0;

let removed = 0;
try {
  await pool.query("BEGIN");
  // ۱) ممیزی — هم عامل، هم هدف (هدف رشته است، نه uuid).
  removed += await q("DELETE FROM audit_logs WHERE actor_user_id = ANY($1)", [users]);
  removed += await q("DELETE FROM audit_logs WHERE target_id = ANY($1)", [
    [...users, ...teams],
  ]);
  if (teams.length > 0) {
    removed += await q(
      "DELETE FROM audit_logs WHERE target_id IN (SELECT id::text FROM payments WHERE team_id = ANY($1))",
      [teams],
    );
    removed += await q("DELETE FROM subscriptions WHERE team_id = ANY($1)", [teams]);
    removed += await q("DELETE FROM payments WHERE team_id = ANY($1)", [teams]);
    removed += await q("DELETE FROM invoices WHERE team_id = ANY($1)", [teams]);
    const boards = "SELECT id FROM boards WHERE team_id = ANY($1)";
    removed += await q(`DELETE FROM board_snapshots WHERE board_id IN (${boards})`, [teams]);
    removed += await q(`DELETE FROM board_updates WHERE board_id IN (${boards})`, [teams]);
    removed += await q(`DELETE FROM files WHERE board_id IN (${boards})`, [teams]);
    removed += await q(`DELETE FROM board_favorites WHERE board_id IN (${boards})`, [teams]);
    removed += await q(`DELETE FROM board_versions WHERE board_id IN (${boards})`, [teams]);
    removed += await q(`DELETE FROM comments WHERE thread_id IN (SELECT id FROM comment_threads WHERE board_id IN (${boards}))`, [teams]);
    removed += await q(`DELETE FROM comment_threads WHERE board_id IN (${boards})`, [teams]);
    removed += await q(`DELETE FROM export_jobs WHERE board_id IN (${boards})`, [teams]);
    removed += await q(`DELETE FROM board_members WHERE board_id IN (${boards})`, [teams]);
    removed += await q(`DELETE FROM board_link_grants WHERE board_id IN (${boards})`, [teams]);
    removed += await q("DELETE FROM boards WHERE team_id = ANY($1)", [teams]);
    removed += await q("DELETE FROM folders WHERE team_id = ANY($1)", [teams]);
    removed += await q("DELETE FROM team_invites WHERE team_id = ANY($1)", [teams]);
    removed += await q("DELETE FROM team_members WHERE team_id = ANY($1)", [teams]);
  }
  removed += await q("DELETE FROM auth_sessions WHERE user_id = ANY($1)", [users]);
  if (phones.length > 0) {
    removed += await q("DELETE FROM otp_challenges WHERE destination = ANY($1)", [phones]);
  }
  if (teams.length > 0) removed += await q("DELETE FROM teams WHERE id = ANY($1)", [teams]);
  removed += await q("DELETE FROM users WHERE id = ANY($1)", [users]);
  await pool.query("COMMIT");
  console.log(`پاک‌سازیِ E2E: ${String(removed)} ردیف (${String(users.length)} کاربر، ${String(teams.length)} تیم).`);
} catch (error) {
  await pool.query("ROLLBACK");
  // ★ بلند می‌شکند: پاک‌سازیِ نیمه‌کاره بدتر از پاک‌سازیِ نشده است، چون بی‌صدا می‌مانَد.
  console.error(`پاک‌سازیِ E2E شکست: ${String((error as Error).message)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
