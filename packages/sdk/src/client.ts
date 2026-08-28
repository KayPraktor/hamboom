import type {
  AddBoardMemberBody,
  AssetPresignRequest,
  AssetPresignResponse,
  Board,
  BoardAccessMode,
  BoardMember,
  BoardRole,
  BoardSummary,
  CreateBoardBody,
  CreateFolderBody,
  CreateInviteBody,
  CreateTeamBody,
  Folder,
  OtpRequestBody,
  OtpVerifyBody,
  PatchBoardBody,
  PatchBoardMemberRoleBody,
  PatchFolderBody,
  PatchMemberRoleBody,
  PatchMeBody,
  PatchTeamBody,
  PutAccessBody,
  ResolveLinkBody,
  Team,
  TeamMember,
  TeamRole,
  User,
} from "@hamboom/shared-types";

import { SdkError } from "./errors.ts";

/**
 * کلاینتِ typedِ REST — گام ۶. typeها همه از `@hamboom/shared-types` (بدونِ تعریفِ موازی)؛ فقط
 * envelopeهای api-محور (پاسخِ verify/me/access) این‌جا **ترکیبِ** DTOها هستند، نه بازتعریفِ آن‌ها.
 *
 * ★ سه قید ([m3-handoff](../../../docs/m3-handoff.md)/فاز ۸): access token در **حافظه** (نه localStorage)؛
 * روی **۴۰۱** یک‌بار refresh + retryِ خودکار (کوکیِ HttpOnly با `credentials:include`)؛ fail-closed.
 */

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ClientOptions {
  /** ریشه‌ی api، مثلِ `https://api.hamboom.ir` یا `""` برای هم‌مبدأ. */
  baseUrl: string;
  /** تزریق‌پذیر برای تست/محیط (پیش‌فرض: `fetch`ِ سراسری). */
  fetch?: FetchLike;
  /** وقتی refresh هم شکست خورد (نشست واقعاً تمام شد) — کلاینت باید به صفحه‌ی ورود برود. */
  onSessionEnded?: () => void;
}

// ── envelopeهای پاسخ (ترکیبِ DTOها) ──────────────────────────────────────
export interface VerifyResult {
  accessToken: string;
  refreshToken?: string;
  isNewUser: boolean;
  personalTeamId: string;
  user: User | null;
}
export interface MeResult {
  user: User;
  teams: Team[];
}
export interface AccessInfo {
  accessMode: BoardAccessMode;
  linkActive: boolean;
  members: BoardMember[];
}
export interface AccessUpdateResult {
  accessMode: BoardAccessMode;
  linkActive: boolean;
  /** فقط همین‌بار برمی‌گردد (توکنِ خام)؛ برای اشتراک باید کپی شود. */
  linkToken?: string;
}
export interface RtTokenResult {
  token: string;
  expiresIn: number;
}
export interface RoleAck {
  userId: string;
  role: BoardRole | TeamRole;
}
export interface CommitResult {
  fileId: string;
  boardId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  status: string;
}

interface Opts {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** درخواستِ عمومی — نه Bearer، نه retryِ ۴۰۱. */
  noAuth?: boolean;
  redirect?: RequestInit["redirect"];
}

export function createClient(options: ClientOptions) {
  const fetchImpl: FetchLike = options.fetch ?? ((u, i) => fetch(u, i));
  const base = options.baseUrl.replace(/\/+$/, "");
  let accessToken: string | null = null;
  // یک refreshِ درحال‌اجرا مشترک است تا چند ۴۰۱ همزمان یک‌بار refresh کنند.
  let refreshing: Promise<boolean> | null = null;

  function buildUrl(path: string, query?: Opts["query"]): string {
    if (!query) return base + path;
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined) p.set(k, String(v));
    const s = p.toString();
    return base + path + (s.length > 0 ? `?${s}` : "");
  }

  function raw(method: string, path: string, opts: Opts): Promise<Response> {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (accessToken !== null && opts.noAuth !== true) headers.authorization = `Bearer ${accessToken}`;
    return fetchImpl(buildUrl(path, opts.query), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "include", // کوکیِ refreshِ HttpOnly در مرورگر
      redirect: opts.redirect,
    });
  }

  async function doRefresh(): Promise<boolean> {
    try {
      const res = await raw("POST", "/auth/refresh", { noAuth: true });
      if (!res.ok) return false;
      const data = (await res.json()) as { accessToken?: unknown };
      if (typeof data.accessToken === "string") {
        accessToken = data.accessToken;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** یک درخواست + (در صورتِ ۴۰۱) یک refresh و retry. `Response`ِ خام را می‌دهد (برای باینری/redirect). */
  async function rawAuthed(method: string, path: string, opts: Opts): Promise<Response> {
    let res = await raw(method, path, opts);
    if (res.status === 401 && opts.noAuth !== true) {
      refreshing ??= doRefresh().finally(() => {
        refreshing = null;
      });
      const ok = await refreshing;
      if (ok) res = await raw(method, path, opts);
      else options.onSessionEnded?.();
    }
    return res;
  }

  async function parse<T>(res: Response): Promise<T> {
    const ct = res.headers.get("content-type") ?? "";
    if (!res.ok) {
      let code = "INTERNAL";
      let message = res.statusText.length > 0 ? res.statusText : "خطای ناشناخته";
      let requestId: string | undefined;
      let details: unknown;
      if (ct.includes("application/json")) {
        const body = (await res.json().catch(() => null)) as {
          error?: { code?: string; message?: string; requestId?: string; details?: unknown };
        } | null;
        if (body?.error) {
          code = body.error.code ?? code;
          message = body.error.message ?? message;
          requestId = body.error.requestId;
          details = body.error.details;
        }
      }
      throw new SdkError(res.status, code, message, requestId, details);
    }
    if (res.status === 204) return undefined as T;
    if (ct.includes("application/json")) return (await res.json()) as T;
    return undefined as T;
  }

  function request<T>(method: string, path: string, opts: Opts = {}): Promise<T> {
    return rawAuthed(method, path, opts).then((res) => parse<T>(res));
  }

  return {
    /** برای بازگرداندنِ نشست از بیرون (مثلاً بعد از verify روی سرور). */
    setAccessToken(token: string | null): void {
      accessToken = token;
    },
    getAccessToken(): string | null {
      return accessToken;
    },

    auth: {
      requestOtp: (body: OtpRequestBody): Promise<{ ok: boolean }> =>
        request("POST", "/auth/otp/request", { body, noAuth: true }),
      /** موفق → access token در حافظه ذخیره می‌شود. */
      async verifyOtp(body: OtpVerifyBody): Promise<VerifyResult> {
        const r = await request<VerifyResult>("POST", "/auth/otp/verify", { body, noAuth: true });
        accessToken = r.accessToken;
        return r;
      },
      /** refreshِ دستی؛ `false` یعنی نشست تمام شده. */
      async refresh(): Promise<boolean> {
        const ok = await doRefresh();
        if (!ok) options.onSessionEnded?.();
        return ok;
      },
    },

    me: {
      get: (): Promise<MeResult> => request("GET", "/me"),
      update: (body: PatchMeBody): Promise<{ user: User }> => request("PATCH", "/me", { body }),
    },

    teams: {
      create: (body: CreateTeamBody): Promise<Team> => request("POST", "/teams", { body }),
      get: (id: string): Promise<Team> => request("GET", `/teams/${id}`),
      update: (id: string, body: PatchTeamBody): Promise<Team> =>
        request("PATCH", `/teams/${id}`, { body }),
      members: (id: string): Promise<{ members: TeamMember[] }> =>
        request("GET", `/teams/${id}/members`),
      setMemberRole: (id: string, userId: string, body: PatchMemberRoleBody): Promise<RoleAck> =>
        request("PATCH", `/teams/${id}/members/${userId}`, { body }),
      removeMember: (id: string, userId: string): Promise<void> =>
        request("DELETE", `/teams/${id}/members/${userId}`),
      createInvite: (
        id: string,
        body: CreateInviteBody,
      ): Promise<{ inviteId: string; channel: string; destination: string; role: string; token?: string }> =>
        request("POST", `/teams/${id}/invites`, { body }),
      acceptInvite: (token: string): Promise<{ teamId: string; role: TeamRole }> =>
        request("POST", `/invites/${encodeURIComponent(token)}/accept`),
    },

    folders: {
      list: (teamId: string): Promise<{ folders: Folder[] }> =>
        request("GET", `/teams/${teamId}/folders`),
      create: (teamId: string, body: CreateFolderBody): Promise<Folder> =>
        request("POST", `/teams/${teamId}/folders`, { body }),
      update: (id: string, body: PatchFolderBody): Promise<Folder> =>
        request("PATCH", `/folders/${id}`, { body }),
      remove: (id: string): Promise<void> => request("DELETE", `/folders/${id}`),
    },

    boards: {
      list: (query?: { q?: string; folderId?: string; favorite?: boolean }): Promise<{
        boards: BoardSummary[];
      }> => request("GET", "/boards", { query }),
      create: (body: CreateBoardBody): Promise<Board> => request("POST", "/boards", { body }),
      get: (id: string): Promise<Board> => request("GET", `/boards/${id}`),
      update: (id: string, body: PatchBoardBody): Promise<Board> =>
        request("PATCH", `/boards/${id}`, { body }),
      remove: (id: string): Promise<void> => request("DELETE", `/boards/${id}`),
      restore: (id: string): Promise<Board> => request("POST", `/boards/${id}/restore`),
      duplicate: (id: string): Promise<Board> => request("POST", `/boards/${id}/duplicate`),
      favorite: (id: string): Promise<{ favorite: boolean }> =>
        request("POST", `/boards/${id}/favorite`),
      unfavorite: (id: string): Promise<{ favorite: boolean }> =>
        request("DELETE", `/boards/${id}/favorite`),
      rtToken: (id: string): Promise<RtTokenResult> => request("GET", `/boards/${id}/rt-token`),
      /** بایت‌های snapshotِ بوت، یا `null` اگر بوردی هنوز فشرده نشده. */
      async snapshot(id: string): Promise<Uint8Array | null> {
        const res = await rawAuthed("GET", `/boards/${id}/snapshot`, {});
        if (res.status === 204) return null;
        if (!res.ok) return parse<never>(res); // خطا را می‌اندازد
        return new Uint8Array(await res.arrayBuffer());
      },
      access: (id: string): Promise<AccessInfo> => request("GET", `/boards/${id}/access`),
      setAccess: (id: string, body: PutAccessBody): Promise<AccessUpdateResult> =>
        request("PUT", `/boards/${id}/access`, { body }),
      addMember: (id: string, body: AddBoardMemberBody): Promise<RoleAck> =>
        request("POST", `/boards/${id}/members`, { body }),
      setMemberRole: (id: string, userId: string, body: PatchBoardMemberRoleBody): Promise<RoleAck> =>
        request("PATCH", `/boards/${id}/members/${userId}`, { body }),
      removeMember: (id: string, userId: string): Promise<void> =>
        request("DELETE", `/boards/${id}/members/${userId}`),
    },

    links: {
      /** مهمانِ لینک را resolve می‌کند (کاربرِ احرازشده) → گرنتِ ماندگار. */
      resolve: (body: ResolveLinkBody): Promise<{ boardId: string; role: BoardRole }> =>
        request("POST", "/public/boards/resolve", { body }),
    },

    assets: {
      presign: (boardId: string, body: AssetPresignRequest): Promise<AssetPresignResponse> =>
        request("POST", `/boards/${boardId}/assets/presign`, { body }),
      commit: (boardId: string, fileId: string): Promise<CommitResult> =>
        request("POST", `/boards/${boardId}/assets/${fileId}/commit`),
      /** URLِ امضاشده‌ی نمایش (۳۰۲ را دنبال می‌کند و Location را می‌دهد؛ برای `<img src>`). */
      async resolve(fileId: string): Promise<string> {
        const res = await rawAuthed("GET", `/assets/${fileId}`, { redirect: "manual" });
        if (res.status === 302 || res.status === 303) {
          const loc = res.headers.get("location");
          if (loc !== null) return loc;
        }
        return parse<never>(res); // خطا (۴۰۴/۴۰۳) را می‌اندازد
      },
    },
  };
}

export type HamboomClient = ReturnType<typeof createClient>;
