import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { FIXTURES_PATH, OTP_CODE, type PanelFixtures } from "./fixtures.ts";

/**
 * فیکسچرهای E2Eِ پنل — M6 ردیفِ ۸٫۱.
 *
 * ★★ **همه‌چیز از راهِ خودِ api ساخته می‌شود، نه با `INSERT`ِ دستی** — جز یک استثنا:
 * پرچمِ `is_staff` که **فقط** [`admin:grant-staff`](../../../scripts/admin-grant-staff.ts)
 * می‌نویسد (ADR-066؛ یک `UPDATE`ِ دستی همان قاعده را دور می‌زد و تستِ ما را از مسیرِ
 * واقعیِ محصول جدا می‌کرد).
 *
 * ⚠️ این فایل **به مرورگر ربطی ندارد** و در Node اجرا می‌شود؛ ورودِ خودِ تست‌ها از
 * **رابطِ واقعی** انجام می‌شود (توکنِ دسترسی فقط در حافظه‌ی sdk زندگی می‌کند، پس تزریقِ
 * کوکی چیزی را که کاربر تجربه می‌کند اثبات نمی‌کرد).
 */

const API = process.env.E2E_API_URL ?? "http://localhost:15402";
const ROOT = join(import.meta.dirname, "..", "..", "..");

/** شماره‌ی تازه در هر اجرا ⇒ تصادمِ بینِ اجراها ساختاراً ناممکن. */
const freshPhone = (): string => `0912${String(randomInt(1_000_000, 9_999_999))}`;

interface Session {
  accessToken: string;
  userId: string;
  personalTeamId: string;
  cookie: string;
}

async function login(phone: string): Promise<Session> {
  const otp = await fetch(`${API}/auth/otp/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone }),
  });
  if (!otp.ok) throw new Error(`/auth/otp/request ⇒ ${String(otp.status)}`);

  const verify = await fetch(`${API}/auth/otp/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone, code: OTP_CODE }),
  });
  if (!verify.ok) throw new Error(`/auth/otp/verify ⇒ ${String(verify.status)}`);
  const body = (await verify.json()) as {
    accessToken: string;
    user: { id: string };
    personalTeamId: string;
  };
  // کوکیِ نشست لازم نیست ولی نگه داشتنش اشکالی ندارد؛ فیکسچرها با accessToken کار می‌کنند.
  return {
    accessToken: body.accessToken,
    userId: body.user.id,
    personalTeamId: body.personalTeamId,
    cookie: verify.headers.get("set-cookie") ?? "",
  };
}

async function post<T>(path: string, session: Session, body: unknown, extra: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.accessToken}`,
      ...extra,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} ⇒ ${String(res.status)} ${await res.text()}`);
  return (await res.json()) as T;
}

export default async function globalSetup(): Promise<void> {
  const staffPhone = freshPhone();
  const targetPhone = freshPhone();
  const plainPhone = freshPhone();

  const staff = await login(staffPhone);
  const target = await login(targetPhone);
  const plain = await login(plainPhone);

  // ★ نمای پشتیبانی چیزی لازم دارد که ببیند.
  const board = await post<{ id: string }>(
    "/boards",
    target,
    { title: "بوردِ آزمونِ پنل", teamId: target.personalTeamId },
  );

  // ★ پرداختِ `pending` از **مسیرِ واقعیِ checkout** با درگاهِ mock — تا verifyِ دستیِ پنل
  //   چیزی برای تسویه داشته باشد. پلنِ `pro` فعال است (migration 0006).
  const checkout = await post<{ paymentId: string }>(
    `/teams/${target.personalTeamId}/billing/checkout`,
    target,
    { planCode: "pro", period: "monthly", seats: 1 },
    { "idempotency-key": `e2e-${staffPhone}` },
  );

  // ⚠️ **تنها نویسنده‌ی `is_staff`** — از همان مسیری که اپراتورِ واقعی استفاده می‌کند.
  execFileSync("node", ["--env-file-if-exists=.env", "scripts/admin-grant-staff.ts", `--phone=${staffPhone}`], {
    cwd: ROOT,
    stdio: "pipe",
  });

  const fixtures: PanelFixtures = {
    staffPhone,
    staffUserId: staff.userId,
    targetPhone,
    targetUserId: target.userId,
    targetTeamId: target.personalTeamId,
    targetBoardId: board.id,
    paymentId: checkout.paymentId,
    plainPhone,
    plainUserId: plain.userId,
  };
  writeFileSync(FIXTURES_PATH, JSON.stringify(fixtures, null, 2));
}
