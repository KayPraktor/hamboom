/**
 * `@hamboom/sdk` — کلاینتِ typedِ REST برای `apps/api`.
 *
 * ★ همه‌ی typeها از `@hamboom/shared-types` می‌آیند (منبعِ واحد، بدونِ تعریفِ موازی). فقط `fetch`ِ سراسری
 * را لازم دارد؛ framework-agnostic (apps/web این را wrap می‌کند). دورِ باطلِ `canvas-core → sdk` با گیتِ
 * `sdkBoundaries` بسته است.
 */
export { createClient } from "./client.ts";
export type {
  AccessInfo,
  AccessUpdateResult,
  ClientOptions,
  CommitResult,
  FetchLike,
  HamboomClient,
  MeResult,
  RoleAck,
  RtTokenResult,
  VerifyResult,
} from "./client.ts";
export { SdkError } from "./errors.ts";
