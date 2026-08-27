import {
  apiError,
  assetPresignRequest,
  assetPresignResponse,
  board,
  boardMember,
  boardSummary,
  paginated,
  rtTokenClaims,
  team,
  teamMember,
  user,
  userPublic,
} from "@hamboom/shared-types";
import { z } from "zod";

import {
  addBoardMemberBody,
  createBoardBody,
  createFolderBody,
  createInviteBody,
  createTeamBody,
  otpRequestBody,
  otpVerifyBody,
  patchBoardBody,
  patchBoardMemberRoleBody,
  patchFolderBody,
  patchMeBody,
  patchMemberRoleBody,
  patchTeamBody,
  putAccessBody,
  resolveLinkBody,
} from "./schemas.ts";

/**
 * سندِ OpenAPI 3.1 از **همان zodِ منبعِ حقیقت** ساخته می‌شود — گام ۵٫۵.
 *
 * ★ خط‌قرمزِ ۳ی `shared-types`: «یک تعریف، سه خروجی: تایپ، اعتبارسنجیِ زمانِ اجرا، و schema برای
 * OpenAPI». اینجا خروجیِ سوم است — با `z.toJSONSchema` (بومیِ zod v4، بدونِ وابستگیِ نو، P1). OpenAPI 3.1
 * روی JSON-Schema 2020-12 سوار است، همان چیزی که zod تولید می‌کند.
 *
 * ⚠️ `ROUTES` دستی نگه داشته می‌شود (قرارداد، مثلِ PLAN §۵٫۲)، ولی یک **گاردِ رانش** در تست ثابت می‌کند
 * هر مسیرِ ثبت‌شده در Fastify اینجا هم مستند است — پس دریفت بی‌صدا نمی‌مانَد.
 */

/** یک schemaِ zod را به JSON-Schemaِ سازگار با OpenAPI 3.1 تبدیل می‌کند (بدونِ کلیدِ `$schema`). */
function toJson(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { unrepresentable: "any" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

/** schemaهای نام‌دارِ `components` — از DTOهای `shared-types` و بدنه‌های درخواستِ محلی. */
const COMPONENT_SCHEMAS: Record<string, z.ZodType> = {
  ApiError: apiError,
  User: user,
  UserPublic: userPublic,
  Team: team,
  TeamMember: teamMember,
  Board: board,
  BoardSummary: boardSummary,
  BoardMember: boardMember,
  RtTokenClaims: rtTokenClaims,
  AssetPresignRequest: assetPresignRequest,
  AssetPresignResponse: assetPresignResponse,
  Paginated: paginated(z.unknown()),
  OtpRequestBody: otpRequestBody,
  OtpVerifyBody: otpVerifyBody,
  CreateBoardBody: createBoardBody,
  PatchBoardBody: patchBoardBody,
  CreateTeamBody: createTeamBody,
  PatchTeamBody: patchTeamBody,
  PatchMemberRoleBody: patchMemberRoleBody,
  CreateInviteBody: createInviteBody,
  CreateFolderBody: createFolderBody,
  PatchFolderBody: patchFolderBody,
  PatchMeBody: patchMeBody,
  PutAccessBody: putAccessBody,
  ResolveLinkBody: resolveLinkBody,
  AddBoardMemberBody: addBoardMemberBody,
  PatchBoardMemberRoleBody: patchBoardMemberRoleBody,
};

interface RouteDoc {
  method: "get" | "post" | "patch" | "delete" | "put";
  /** مسیرِ Fastify (`:param`) — گاردِ دریفت مستقیم با آن می‌سنجد؛ هنگامِ خروجی به `{param}` می‌شود. */
  path: string;
  tag: string;
  summary: string;
  /** پیش‌فرض bearer؛ `public: true` یعنی بدونِ احراز. */
  public?: boolean;
  /** نامِ schemaِ بدنه در `components`. */
  body?: keyof typeof COMPONENT_SCHEMAS;
  /** پاسخِ موفق: کد + (اختیاری) schema. پیش‌فرضِ کد ۲۰۰. */
  ok?: { code?: number; schema?: keyof typeof COMPONENT_SCHEMAS; description?: string };
}

/** ★ منبعِ واحدِ مسیرها — گاردِ دریفتِ تست تضمین می‌کند کامل بماند. */
const ROUTES: RouteDoc[] = [
  // ── سلامت ──
  { method: "get", path: "/healthz", tag: "health", summary: "liveness", public: true },
  { method: "get", path: "/readyz", tag: "health", summary: "readiness (ping به db)", public: true },
  { method: "get", path: "/openapi.json", tag: "health", summary: "سندِ OpenAPI 3.1", public: true },
  { method: "get", path: "/api/v1/docs", tag: "health", summary: "مرورگرِ سبکِ مستندات (self-hosted)", public: true },

  // ── احراز ──
  { method: "post", path: "/auth/otp/request", tag: "auth", summary: "ارسالِ OTP (ضدِ enumeration، rate-limit)", public: true, body: "OtpRequestBody" },
  { method: "post", path: "/auth/otp/verify", tag: "auth", summary: "تاییدِ OTP → accessToken + کوکیِ refresh", public: true, body: "OtpVerifyBody" },
  { method: "post", path: "/auth/refresh", tag: "auth", summary: "چرخشِ refresh (کوکیِ HttpOnly؛ reuse → سوزاندنِ خانواده)", public: true },

  // ── کاربر ──
  { method: "get", path: "/me", tag: "me", summary: "پروفایل + تیم‌ها", ok: { schema: "User" } },
  { method: "patch", path: "/me", tag: "me", summary: "ویرایشِ نام/locale", body: "PatchMeBody", ok: { schema: "User" } },

  // ── تیم ──
  { method: "post", path: "/teams", tag: "teams", summary: "ساختِ تیم (اتمیک: team+owner+usage)", body: "CreateTeamBody", ok: { code: 201, schema: "Team" } },
  { method: "get", path: "/teams/:id", tag: "teams", summary: "تیم", ok: { schema: "Team" } },
  { method: "patch", path: "/teams/:id", tag: "teams", summary: "ویرایشِ تیم (admin+)", body: "PatchTeamBody", ok: { schema: "Team" } },
  { method: "get", path: "/teams/:id/members", tag: "teams", summary: "اعضای تیم" },
  { method: "patch", path: "/teams/:id/members/:userId", tag: "teams", summary: "تغییرِ نقشِ عضو (admin+، مالک محافظت‌شده)", body: "PatchMemberRoleBody" },
  { method: "delete", path: "/teams/:id/members/:userId", tag: "teams", summary: "حذفِ عضو", ok: { code: 204 } },
  { method: "post", path: "/teams/:id/invites", tag: "teams", summary: "ساختِ دعوت (توکنِ hash)", body: "CreateInviteBody", ok: { code: 201 } },
  { method: "post", path: "/invites/:token/accept", tag: "teams", summary: "پذیرشِ دعوت (اتمیک، FOR UPDATE)" },

  // ── فولدر ──
  { method: "get", path: "/teams/:teamId/folders", tag: "folders", summary: "فولدرهای تیم" },
  { method: "post", path: "/teams/:teamId/folders", tag: "folders", summary: "ساختِ فولدر", body: "CreateFolderBody", ok: { code: 201 } },
  { method: "patch", path: "/folders/:id", tag: "folders", summary: "ویرایشِ فولدر", body: "PatchFolderBody" },
  { method: "delete", path: "/folders/:id", tag: "folders", summary: "حذفِ فولدر", ok: { code: 204 } },

  // ── بورد ──
  { method: "get", path: "/boards", tag: "boards", summary: "لیست/جستجوی pg_trgm/فولدر/favorite" },
  { method: "post", path: "/boards", tag: "boards", summary: "ساختِ بورد (تک‌ردیفی، created_by)", body: "CreateBoardBody", ok: { code: 201, schema: "Board" } },
  { method: "get", path: "/boards/:id", tag: "boards", summary: "متادیتای بورد + myRole", ok: { schema: "Board" } },
  { method: "get", path: "/boards/:id/snapshot", tag: "boards", summary: "snapshotِ بوت (octet-stream؛ ۲۰۴ اگر نباشد)", ok: { description: "application/octet-stream" } },
  { method: "patch", path: "/boards/:id", tag: "boards", summary: "ویرایشِ بورد (editor+)", body: "PatchBoardBody", ok: { schema: "Board" } },
  { method: "delete", path: "/boards/:id", tag: "boards", summary: "حذفِ نرم (owner)", ok: { code: 204 } },
  { method: "post", path: "/boards/:id/restore", tag: "boards", summary: "بازیابیِ بوردِ حذف‌شده (owner)" },
  { method: "post", path: "/boards/:id/duplicate", tag: "boards", summary: "تکثیرِ متادیتا (editor+)", ok: { code: 201, schema: "Board" } },
  { method: "post", path: "/boards/:id/favorite", tag: "boards", summary: "نشان‌کردن (viewer+)" },
  { method: "delete", path: "/boards/:id/favorite", tag: "boards", summary: "برداشتنِ نشان", ok: { code: 204 } },
  { method: "get", path: "/boards/:id/rt-token", tag: "boards", summary: "★ rt-tokenِ ۶۰ثانیه‌ایِ WS (پورتِ ۴)", ok: { schema: "RtTokenClaims", description: "توکنِ امضاشده + claims" } },

  // ── دسترسی/اشتراک ──
  { method: "get", path: "/boards/:id/access", tag: "board-access", summary: "حالتِ اشتراک + اعضا (viewer+)" },
  { method: "put", path: "/boards/:id/access", tag: "board-access", summary: "تنظیمِ حالت + تولید/ابطالِ لینک (owner)", body: "PutAccessBody" },
  { method: "post", path: "/public/boards/resolve", tag: "board-access", summary: "resolveِ مهمانِ لینک → گرنتِ ماندگار (DP-4)", body: "ResolveLinkBody" },
  { method: "post", path: "/boards/:id/members", tag: "board-access", summary: "افزودنِ عضوِ مستقیم (owner)", body: "AddBoardMemberBody" },
  { method: "patch", path: "/boards/:id/members/:userId", tag: "board-access", summary: "تغییرِ نقشِ عضوِ مستقیم (owner)", body: "PatchBoardMemberRoleBody" },
  { method: "delete", path: "/boards/:id/members/:userId", tag: "board-access", summary: "حذفِ عضوِ مستقیم (owner)", ok: { code: 204 } },

  // ── دارایی ──
  { method: "post", path: "/boards/:boardId/assets/presign", tag: "assets", summary: "presignِ آپلود (editor+)", body: "AssetPresignRequest", ok: { schema: "AssetPresignResponse" } },
  { method: "post", path: "/boards/:boardId/assets/:fileId/commit", tag: "assets", summary: "commit: تاییدِ بایتِ واقعی (sha/نوع/اندازه) + دی‌دوپ (editor+)" },
  { method: "get", path: "/assets/:fileId", tag: "assets", summary: "۳۰۲ به presigned GET (viewer+)", ok: { code: 302, description: "ریدایرکت به URLِ امضاشده" } },
];

/** فهرستِ مسیرهای مستندشده به‌صورتِ `METHOD path` (مسیرِ Fastify) — گاردِ دریفتِ تست از این استفاده می‌کند. */
export function documentedRoutes(): Set<string> {
  return new Set(ROUTES.map((r) => `${r.method.toUpperCase()} ${r.path}`));
}

const STD_ERRORS = {
  "400": { $ref: "#/components/responses/Error" },
  "401": { $ref: "#/components/responses/Error" },
  "403": { $ref: "#/components/responses/Error" },
  "404": { $ref: "#/components/responses/Error" },
};

function buildResponses(r: RouteDoc): Record<string, unknown> {
  const code = String(r.ok?.code ?? 200);
  const success: Record<string, unknown> =
    code === "204"
      ? { description: r.ok?.description ?? "بدونِ محتوا" }
      : {
          description: r.ok?.description ?? "موفق",
          ...(r.ok?.schema
            ? {
                content: {
                  "application/json": {
                    schema: { $ref: `#/components/schemas/${r.ok.schema}` },
                  },
                },
              }
            : {}),
        };
  return r.public
    ? { [code]: success }
    : { [code]: success, "429": { $ref: "#/components/responses/Error" }, ...STD_ERRORS };
}

/** سندِ کاملِ OpenAPI 3.1. */
export function buildOpenApiDocument(): Record<string, unknown> {
  const schemas: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(COMPONENT_SCHEMAS)) {
    schemas[name] = toJson(schema);
  }

  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of ROUTES) {
    const oaPath = r.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
    const params = [...r.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    const op: Record<string, unknown> = {
      tags: [r.tag],
      summary: r.summary,
      ...(params.length > 0 ? { parameters: params } : {}),
      ...(r.public ? {} : { security: [{ bearerAuth: [] }] }),
      responses: buildResponses(r),
    };
    if (r.body) {
      op.requestBody = {
        required: true,
        content: {
          "application/json": { schema: { $ref: `#/components/schemas/${r.body}` } },
        },
      };
    }
    paths[oaPath] ??= {};
    paths[oaPath][r.method] = op;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Hamboom API",
      version: "0.1.0",
      description: "REST APIِ پلتفرمِ وایت‌بوردِ همکاریِ هم‌بوم (ماژول M3).",
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "health" },
      { name: "auth" },
      { name: "me" },
      { name: "teams" },
      { name: "folders" },
      { name: "boards" },
      { name: "board-access" },
      { name: "assets" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      responses: {
        Error: {
          description: "خطا (قالبِ یکسانِ apiError)",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
        },
      },
      schemas,
    },
    paths,
  };
}
