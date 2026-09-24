/**
 * آمار و وضعیتِ سیستمِ پنلِ ادمین — M6 فاز ۷ (M6-D8،
 * [ADR-067](../../../../ARCHITECTURE_DECISIONS.md#adr-067)).
 *
 * ★ **چرا یک registrarِ جدا:** همان استدلالِ `registerAdminPaymentRoutes`. این سه مسیر نه SMS
 * می‌خواهند نه درگاه، ولی چیزهایی می‌خواهند که فازهای ۳/۵/۶ اصلاً نمی‌شناسند (انبارهای S3،
 * Redis، شمارنده‌ی آشتی‌دهی). یک `deps`ِ چاق برای همه، یعنی هر تستِ فاز ۳ هم مجبور باشد یک
 * انبارِ S3 بسازد.
 *
 * ★★ **هر سه `GET`اند و `audited()` ندارند — این یک تصمیم است، نه فراموشی.** گیتِ ۱۶ فقط
 * `POST/PATCH/PUT/DELETE` را می‌خواهد (خودآزمونش هم همین را تثبیت می‌کند)، و یک GETِ ممیزی‌شده
 * با هر بار باز‌شدنِ داشبورد یک ردیف در `audit_logs` می‌نویسد و ممیزیِ واقعی را زیرِ نویز دفن
 * می‌کند. فاز ۵ فقط خواندنِ **دادهٔ شخصیِ** کاربر را ممیزی کرد (`user.search`،
 * `support.board.view`)؛ آمارِ تجمیعی و سلامتِ زیرساخت هیچ سوژه‌ی شخصی ندارند.
 *
 * ⚠️ هیچ‌کدام step-up نمی‌خواهند: هیچ‌چیزی را جهش نمی‌دهند.
 */
import type { AdminFeatureFlag, AdminStats, SystemStatus } from "@hamboom/shared-types";
import { adminStatsQuery } from "@hamboom/shared-types";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type pg from "pg";

import { toAdminFeatureFlag, toAdminStats } from "../dto.ts";
import { parseBody } from "../schemas.ts";
import { readFeatureFlags } from "../services/admin-flags.ts";
import { readStats } from "../services/admin-stats.ts";
import { readSystemStatus, type SystemProbeDeps } from "../services/system-status.ts";

export interface AdminStatsRouteDeps {
  pool: pg.Pool;
  requireAuth: preHandlerHookHandler;
  requireStaff: preHandlerHookHandler;
  /** کاملاً ساخته‌شده در `buildApp` — این‌جا فقط مصرف می‌شود (انبارها/Redis/شمارنده). */
  system: SystemProbeDeps;
}

export function registerAdminStatsRoutes(app: FastifyInstance, deps: AdminStatsRouteDeps): void {
  const staffOnly = [deps.requireAuth, deps.requireStaff];

  app.get("/admin/stats", { preHandler: staffOnly }, async (req): Promise<AdminStats> => {
    const q = parseBody(adminStatsQuery, req.query);
    const rows = await readStats(deps.pool, q.days);
    return toAdminStats(rows, q.days);
  });

  // ⚠️ هیچ‌وقت در بوت صدا زده نمی‌شود — فقط در درخواست. کانتینرِ api در compose به redis
  //    `depends_on` ندارد، پس یک probeِ بوت‌هنگام با استارتِ سرد مسابقه می‌داد.
  app.get("/admin/system", { preHandler: staffOnly }, (): Promise<SystemStatus> =>
    readSystemStatus(deps.system),
  );

  app.get(
    "/admin/feature-flags",
    { preHandler: staffOnly },
    async (): Promise<{ items: AdminFeatureFlag[] }> => ({
      items: (await readFeatureFlags(deps.pool)).map(toAdminFeatureFlag),
    }),
  );
}
