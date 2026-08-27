# Hamboom API — مرجعِ REST

> ⚠️ این فایل **تولیدشده** است (`node scripts/gen-openapi.ts`). ویرایشِ دستی نکن — منبع: zodِ
> `shared-types` + `apps/api/src/openapi.ts`. سندِ **زنده**: `GET /api/v1/docs` و `GET /openapi.json`.

نسخه: **0.1.0** · OpenAPI **3.1** · REST APIِ پلتفرمِ وایت‌بوردِ همکاریِ هم‌بوم (ماژول M3).

**احراز:** endpointهای غیرعمومی به هدرِ `Authorization: Bearer <accessToken>` نیاز دارند. خطاها قالبِ یکسانِ `ApiError` دارند.

## health

| متد | مسیر | احراز | توضیح |
|---|---|---|---|
| GET | `/healthz` | عمومی | liveness |
| GET | `/readyz` | عمومی | readiness (ping به db) |
| GET | `/openapi.json` | عمومی | سندِ OpenAPI 3.1 |
| GET | `/api/v1/docs` | عمومی | مرورگرِ سبکِ مستندات (self-hosted) |

## auth

| متد | مسیر | احراز | توضیح |
|---|---|---|---|
| POST | `/auth/otp/request` | عمومی | ارسالِ OTP (ضدِ enumeration، rate-limit) |
| POST | `/auth/otp/verify` | عمومی | تاییدِ OTP → accessToken + کوکیِ refresh |
| POST | `/auth/refresh` | عمومی | چرخشِ refresh (کوکیِ HttpOnly؛ reuse → سوزاندنِ خانواده) |

## me

| متد | مسیر | احراز | توضیح |
|---|---|---|---|
| GET | `/me` | 🔒 bearer | پروفایل + تیم‌ها |
| PATCH | `/me` | 🔒 bearer | ویرایشِ نام/locale |

## teams

| متد | مسیر | احراز | توضیح |
|---|---|---|---|
| POST | `/teams` | 🔒 bearer | ساختِ تیم (اتمیک: team+owner+usage) |
| GET | `/teams/{id}` | 🔒 bearer | تیم |
| PATCH | `/teams/{id}` | 🔒 bearer | ویرایشِ تیم (admin+) |
| GET | `/teams/{id}/members` | 🔒 bearer | اعضای تیم |
| PATCH | `/teams/{id}/members/{userId}` | 🔒 bearer | تغییرِ نقشِ عضو (admin+، مالک محافظت‌شده) |
| DELETE | `/teams/{id}/members/{userId}` | 🔒 bearer | حذفِ عضو |
| POST | `/teams/{id}/invites` | 🔒 bearer | ساختِ دعوت (توکنِ hash) |
| POST | `/invites/{token}/accept` | 🔒 bearer | پذیرشِ دعوت (اتمیک، FOR UPDATE) |

## folders

| متد | مسیر | احراز | توضیح |
|---|---|---|---|
| GET | `/teams/{teamId}/folders` | 🔒 bearer | فولدرهای تیم |
| POST | `/teams/{teamId}/folders` | 🔒 bearer | ساختِ فولدر |
| PATCH | `/folders/{id}` | 🔒 bearer | ویرایشِ فولدر |
| DELETE | `/folders/{id}` | 🔒 bearer | حذفِ فولدر |

## boards

| متد | مسیر | احراز | توضیح |
|---|---|---|---|
| GET | `/boards` | 🔒 bearer | لیست/جستجوی pg_trgm/فولدر/favorite |
| POST | `/boards` | 🔒 bearer | ساختِ بورد (تک‌ردیفی، created_by) |
| GET | `/boards/{id}` | 🔒 bearer | متادیتای بورد + myRole |
| PATCH | `/boards/{id}` | 🔒 bearer | ویرایشِ بورد (editor+) |
| DELETE | `/boards/{id}` | 🔒 bearer | حذفِ نرم (owner) |
| GET | `/boards/{id}/snapshot` | 🔒 bearer | snapshotِ بوت (octet-stream؛ ۲۰۴ اگر نباشد) |
| POST | `/boards/{id}/restore` | 🔒 bearer | بازیابیِ بوردِ حذف‌شده (owner) |
| POST | `/boards/{id}/duplicate` | 🔒 bearer | تکثیرِ متادیتا (editor+) |
| POST | `/boards/{id}/favorite` | 🔒 bearer | نشان‌کردن (viewer+) |
| DELETE | `/boards/{id}/favorite` | 🔒 bearer | برداشتنِ نشان |
| GET | `/boards/{id}/rt-token` | 🔒 bearer | ★ rt-tokenِ ۶۰ثانیه‌ایِ WS (پورتِ ۴) |

## board-access

| متد | مسیر | احراز | توضیح |
|---|---|---|---|
| GET | `/boards/{id}/access` | 🔒 bearer | حالتِ اشتراک + اعضا (viewer+) |
| PUT | `/boards/{id}/access` | 🔒 bearer | تنظیمِ حالت + تولید/ابطالِ لینک (owner) |
| POST | `/public/boards/resolve` | 🔒 bearer | resolveِ مهمانِ لینک → گرنتِ ماندگار (DP-4) |
| POST | `/boards/{id}/members` | 🔒 bearer | افزودنِ عضوِ مستقیم (owner) |
| PATCH | `/boards/{id}/members/{userId}` | 🔒 bearer | تغییرِ نقشِ عضوِ مستقیم (owner) |
| DELETE | `/boards/{id}/members/{userId}` | 🔒 bearer | حذفِ عضوِ مستقیم (owner) |

## assets

| متد | مسیر | احراز | توضیح |
|---|---|---|---|
| POST | `/boards/{boardId}/assets/presign` | 🔒 bearer | presignِ آپلود (editor+) |
| POST | `/boards/{boardId}/assets/{fileId}/commit` | 🔒 bearer | commit: تاییدِ بایتِ واقعی (sha/نوع/اندازه) + دی‌دوپ (editor+) |
| GET | `/assets/{fileId}` | 🔒 bearer | ۳۰۲ به presigned GET (viewer+) |

## Schemas (`components`)

شکلِ کاملِ هر schema در [`docs/openapi.json`](openapi.json) است (تولیدشده از zod با `z.toJSONSchema`):

`ApiError` · `User` · `UserPublic` · `Team` · `TeamMember` · `Board` · `BoardSummary` · `BoardMember` · `RtTokenClaims` · `AssetPresignRequest` · `AssetPresignResponse` · `Paginated` · `OtpRequestBody` · `OtpVerifyBody` · `CreateBoardBody` · `PatchBoardBody` · `CreateTeamBody` · `PatchTeamBody` · `PatchMemberRoleBody` · `CreateInviteBody` · `CreateFolderBody` · `PatchFolderBody` · `PatchMeBody` · `PutAccessBody` · `ResolveLinkBody` · `AddBoardMemberBody` · `PatchBoardMemberRoleBody`

