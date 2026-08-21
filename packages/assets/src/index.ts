/**
 * `@hamboom/assets` — لایه‌ی دامنه‌ی دارایی (presign/commit-validate/resolve).
 *
 * ★ **مصرف‌کننده‌ی `@hamboom/storage`، نه بخشی از آن** ([ADR-029](../../../ARCHITECTURE_DECISIONS.md#adr-029)):
 * قاعده‌ی mime، کلیدِ team/board، sniff و sha256 اینجاست تا storage نازک بمانَد. `@aws-sdk` را نمی‌بیند
 * (P4، گیتِ `assetsBoundaries`) — به S3 فقط از راهِ storage می‌رسد.
 */
export { createAssetService, AssetValidationError } from "./asset-service.ts";
export type {
  AssetService,
  AssetServiceConfig,
  PresignContext,
  ValidateUploadedArgs,
  VerifiedUpload,
} from "./asset-service.ts";
export { sniffMime } from "./sniff.ts";
