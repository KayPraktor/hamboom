/**
 * ★ probe فاز ۴ — رفتارِ واقعیِ `jose` **قبل از** ساختنِ signer/verifier (قیدِ مالک).
 *
 * چهار چیز را می‌سنجد: رفت‌وبرگشتِ HS256، ردِ `alg:none`، ردِ منقضی، و ★ اینکه jose **تنها**
 * حفره‌ی `exp`-به-میلی‌ثانیه را **نمی‌گیرد** — که چرا `verify`ِ auth-core یک سقفِ آینده لازم دارد.
 *
 * اجرا: `node packages/auth-core/probe/jose-probe.ts`
 */
import { SignJWT, errors, jwtVerify } from "jose";

const secret = new TextEncoder().encode("probe-secret-at-least-32-bytes-long-aaaa");
const now = Math.floor(Date.now() / 1000);

let pass = 0;
let fail = 0;
const ok = (cond: boolean, label: string): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (cond) pass++;
  else fail++;
};

console.log("\n=== probe فاز ۴ — رفتارِ jose ===\n");

// ۱) رفت‌وبرگشتِ HS256
const token = await new SignJWT({ sub: "u1", boardId: "b1", role: "editor" })
  .setProtectedHeader({ alg: "HS256" })
  .setExpirationTime(now + 60)
  .sign(secret);
const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
ok(payload.sub === "u1" && payload.role === "editor", "HS256 sign→verify رفت‌وبرگشت");

// ۲) ★ alg:none باید رد شود — با تعیینِ صریحِ `algorithms`
const noneHeader = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
const nonePayload = Buffer.from(JSON.stringify({ sub: "u1", exp: now + 60 })).toString("base64url");
const noneToken = `${noneHeader}.${nonePayload}.`;
try {
  await jwtVerify(noneToken, secret, { algorithms: ["HS256"] });
  ok(false, "alg:none باید رد شود — نشد");
} catch {
  ok(true, "★ alg:none رد شد (چون algorithms صریح HS256 است)");
}

// ۳) توکنِ منقضی باید رد شود
const expired = await new SignJWT({ sub: "u1" })
  .setProtectedHeader({ alg: "HS256" })
  .setExpirationTime(now - 10)
  .sign(secret);
try {
  await jwtVerify(expired, secret, { algorithms: ["HS256"] });
  ok(false, "منقضی باید رد شود — نشد");
} catch (e) {
  ok(e instanceof errors.JWTExpired, "توکنِ منقضی رد شد (JWTExpired)");
}

// ۴) ★★ exp-به-میلی‌ثانیه: jose **تنها** این را نمی‌گیرد — چون exp عددِ بزرگی است، «منقضی‌نشده» می‌بیند.
const msToken = await new SignJWT({ sub: "u1" })
  .setProtectedHeader({ alg: "HS256" })
  .setExpirationTime(now * 1000) // ← اشتباهِ ms به‌جای ثانیه
  .sign(secret);
let joseAcceptedMs = false;
let years = 0;
try {
  const { payload: p } = await jwtVerify(msToken, secret, { algorithms: ["HS256"] });
  joseAcceptedMs = true;
  years = new Date((p.exp ?? 0) * 1000).getUTCFullYear();
} catch {
  joseAcceptedMs = false;
}
ok(
  joseAcceptedMs,
  `★★ jose exp-in-ms را **پذیرفت** (سالِ انقضا ~${years}) — پس verifyِ auth-core باید سقفِ آینده بگذارد`,
);

console.log(`\nخلاصه: ${pass} سبز، ${fail} قرمز.`);
process.exit(fail === 0 ? 0 : 1);
