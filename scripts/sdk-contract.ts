/**
 * تستِ قراردادیِ `@hamboom/sdk` در برابرِ `buildApp()`ِ **واقعی** (نه mock) — گام ۶ (معیارِ پذیرش).
 *
 * ★ sdk را روی `app.inject` سوار می‌کند: مسیریابی + handler + **DBِ واقعی** بی‌شبکه اجرا می‌شوند. سپس هر
 * پاسخ را با **zodِ shared-types** parse می‌کند — این ثابت می‌کند api دقیقاً شکلِ DTO را می‌دهد (نه ردیفِ خام).
 *
 * نیاز: Postgresِ dev (پورتِ ۵۴۳۳، migrate‌شده). اجرا: `pnpm sdk:contract`. بیرونِ verify (DB لازم دارد).
 */
import { buildApp } from "../apps/api/src/app.ts";
import { loadApiConfig } from "../apps/api/src/config.ts";
import { board, boardSummary, folder, team, user } from "../packages/shared-types/src/api/index.ts";
import { createClient, SdkError, type FetchLike } from "../packages/sdk/src/index.ts";

const NULL_BODY = new Set([101, 204, 205, 304]);

/** آداپتورِ fetch → app.inject: کلاینتِ واقعی روی سرورِ واقعی، بدونِ پورت. */
function injectFetch(app: Awaited<ReturnType<typeof buildApp>>): FetchLike {
  return async (url, init) => {
    const u = new URL(url, "http://local");
    const res = await app.inject({
      method: (init.method ?? "GET") as "GET",
      url: u.pathname + u.search,
      headers: init.headers as Record<string, string>,
      payload: init.body as string | undefined,
    });
    const headers = new Headers();
    for (const [k, v] of Object.entries(res.headers)) {
      if (k.toLowerCase() === "set-cookie") continue;
      if (typeof v === "string") headers.set(k, v);
      else if (Array.isArray(v)) headers.set(k, v.join(", "));
      else if (v !== undefined) headers.set(k, String(v));
    }
    return new Response(NULL_BODY.has(res.statusCode) ? null : res.rawPayload, {
      status: res.statusCode,
      headers,
    });
  };
}

let pass = 0;
let fail = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass += 1;
  } catch (e) {
    console.log(`  ✗ ${name} — ${e instanceof Error ? e.message : String(e)}`);
    fail += 1;
  }
}

async function main(): Promise<void> {
  const config = { ...loadApiConfig(), OTP_DEV_FIXED_CODE: "424242" };
  const app = await buildApp({ config });
  await app.ready();
  const sdk = createClient({ baseUrl: "", fetch: injectFetch(app) });

  console.log("\n=== contract: @hamboom/sdk ↔ buildApp() واقعی ===\n");

  const phone = "09120009001";
  await sdk.auth.requestOtp({ phone });
  const verified = await sdk.auth.verifyOtp({ phone, code: "424242" });
  check("1) verifyOtp → توکن ذخیره شد", () => {
    if (sdk.getAccessToken() !== verified.accessToken) throw new Error("token not stored");
    if (verified.user) user.parse(verified.user); // ★ user باید DTOِ camelCase باشد
  });

  const me = await sdk.me.get();
  check("2) GET /me → user.parse سبز (شکلِ DTO)", () => {
    user.parse(me.user);
    if (me.user.displayName === undefined) throw new Error("displayName نیست (snake_case؟)");
  });
  check("3) /me.teams[0] → team.parse سبز", () => {
    if (me.teams.length === 0) throw new Error("no teams");
    team.parse(me.teams[0]);
    if (typeof me.teams[0]!.memberCount !== "number") throw new Error("memberCount نیست");
  });

  const created = await sdk.boards.create({ title: "بوردِ قراردادِ sdk" });
  check("4) POST /boards → board.parse سبز (createdBy/teamId/…)", () => {
    board.parse(created);
    if (created.teamId === undefined) throw new Error("teamId نیست — هنوز snake_case!");
    if (created.createdBy.displayName === undefined) throw new Error("createdBy DTO نیست");
    if (created.myRole !== "owner") throw new Error(`myRole=${created.myRole}`);
  });

  const got = await sdk.boards.get(created.id);
  check("5) GET /boards/:id → board.parse + teamId camelCase کار می‌کند", () => {
    board.parse(got);
    if (got.id !== created.id || got.teamId !== created.teamId) throw new Error("mismatch");
  });

  const list = await sdk.boards.list();
  check("6) GET /boards → boardSummary.parse روی هر ردیف", () => {
    if (list.boards.length === 0) throw new Error("empty list");
    for (const b of list.boards) boardSummary.parse(b);
  });

  const fld = await sdk.folders.create(me.teams[0]!.id, { name: "فولدرِ قرارداد" });
  check("7) POST folder → folder.parse سبز", () => {
    folder.parse(fld);
    if (fld.teamId !== me.teams[0]!.id) throw new Error("teamId mismatch");
  });

  // ★ خطای §۵ → SdkError با code
  let sdkErr: unknown;
  try {
    await sdk.boards.get("11111111-1111-1111-1111-111111111111");
  } catch (e) {
    sdkErr = e;
  }
  check("8) بوردِ ناموجود → SdkError با code=BOARD_NOT_FOUND و requestId", () => {
    if (!(sdkErr instanceof SdkError)) throw new Error("SdkError نبود");
    if (sdkErr.status !== 404 || sdkErr.code !== "BOARD_NOT_FOUND") {
      throw new Error(`status=${sdkErr.status} code=${sdkErr.code}`);
    }
    if (typeof sdkErr.requestId !== "string") throw new Error("requestId نیست");
  });

  console.log(`\nsummary: ${pass} pass, ${fail} fail.\n`);
  await app.close();
  process.exit(fail === 0 ? 0 : 1);
}

void main();
