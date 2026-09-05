import { describe, expect, it } from "vitest";

import {
  apiError,
  assignableBoardRoles,
  board,
  boardAccessModes,
  boardMember,
  boardRoles,
  boardSummary,
  billingPeriods,
  checkoutBody,
  createBoardBody,
  createInviteBody,
  folder,
  invoice,
  invoiceLineItem,
  invoiceStatuses,
  plan,
  planLimit,
  planUsage,
  rial,
  subscription,
  subscriptionStatus,
  subscriptionStatuses,
  teamSubscriptionStatus,
  teamSubscriptionStatuses,
  zarinpalCallbackQuery,
  putAccessBody,
  rtTokenClaims,
  team,
  teamMember,
  user,
  userPublic,
} from "./index.ts";

const ID = "018f7c4e-9c1a-7c2b-8e3d-1a2b3c4d5e6f";
const DATE = "2026-08-15T09:30:00.000Z";
const PUBLIC = { id: ID, displayName: "رضا", avatarUrl: null, color: "#4c8bf5" };

describe("قراردادِ DTO — معتبر می‌گذرد، نامعتبر رد می‌شود", () => {
  it("user: کاربرِ فقط-موبایل معتبر است (email nullable)", () => {
    const u = {
      id: ID,
      phone: "+989121234567",
      phoneVerified: true,
      email: null,
      emailVerified: false,
      displayName: "رضا",
      avatarUrl: null,
      locale: "fa",
      createdAt: DATE,
      lastSeenAt: null,
    };
    expect(user.parse(u)).toEqual(u);
    // id باید UUID باشد
    expect(user.safeParse({ ...u, id: "not-a-uuid" }).success).toBe(false);
  });

  it("userPublic و teamMember و team", () => {
    expect(userPublic.parse(PUBLIC)).toEqual(PUBLIC);
    const m = { user: PUBLIC, role: "admin", joinedAt: DATE, invitedBy: null };
    expect(teamMember.parse(m)).toEqual(m);
    const t = {
      id: ID,
      slug: "acme",
      name: "آکمه",
      avatarUrl: null,
      myRole: "owner",
      memberCount: 3,
      // ★ فیلدهای مالی — فاز ۵ی M4. تیمِ بی‌اشتراک `free`/`none` می‌گیرد.
      planCode: "free",
      subscriptionStatus: "none",
      limits: { maxMembers: 3, maxBoards: 3, maxStorageBytes: 104857600 },
      usage: { members: 3, boards: 1, storageBytes: 0 },
      createdAt: DATE,
    };
    expect(team.parse(t)).toEqual(t);
    // نقشِ تیمیِ نامعتبر رد می‌شود
    expect(teamMember.safeParse({ ...m, role: "editor" }).success).toBe(false);
  });

  it("board کامل می‌گذرد، boardSummary زیرمجموعه است، boardMember نقشِ کامل می‌گیرد", () => {
    const b = {
      id: ID,
      teamId: ID,
      folderId: null,
      title: "بوردِ نمونه",
      thumbnailUrl: null,
      accessMode: "team",
      linkToken: null,
      myRole: "editor",
      createdBy: PUBLIC,
      elementCount: 3,
      docSizeBytes: 1024,
      lastActivityAt: DATE,
      createdAt: DATE,
      updatedAt: DATE,
      isFavorite: false,
      templateId: null,
    };
    expect(board.parse(b)).toEqual(b);
    // boardSummary فقط کلیدهای خلاصه را نگه می‌دارد
    expect(boardSummary.parse(b)).toEqual({
      id: ID,
      title: "بوردِ نمونه",
      thumbnailUrl: null,
      lastActivityAt: DATE,
      myRole: "editor",
      isFavorite: false,
      folderId: null,
    });
    // خواندنی می‌تواند commenter باشد (بازتابِ داده‌ی ذخیره‌شده)
    expect(boardMember.safeParse({ user: PUBLIC, role: "commenter", addedBy: null, addedAt: DATE }).success).toBe(true);
    // accessModeِ نامعتبر رد می‌شود
    expect(board.safeParse({ ...b, accessMode: "link_comment" }).success).toBe(false);
  });

  it("apiError: قالب و کدِ نامعتبر", () => {
    const e = { error: { code: "BOARD_NOT_FOUND", message: "بورد پیدا نشد.", requestId: "01J" } };
    expect(apiError.parse(e)).toEqual(e);
    expect(apiError.safeParse({ error: { code: "NOPE", message: "x", requestId: "y" } }).success).toBe(false);
  });
});

describe("قیدهای مرزیِ نقش — گام ۲٫۲", () => {
  it("boardRoles ترتیبِ سیمِ M2 را دقیقاً نگه می‌دارد (owner,editor,commenter,viewer)", () => {
    expect(boardRoles).toEqual(["owner", "editor", "commenter", "viewer"]);
  });

  it("assignableBoardRoles شاملِ commenter نیست و زیرمجموعه‌ی boardRoles است (واگرایی ناممکن)", () => {
    expect(assignableBoardRoles).toEqual(["owner", "editor", "viewer"]);
    expect(assignableBoardRoles as readonly string[]).not.toContain("commenter");
    // ناوردا: هر نقشِ قابلِ‌تخصیص حتماً یک boardRole است (تایپش با satisfies قفل است؛ این هم runtime)
    expect(assignableBoardRoles.every((r) => (boardRoles as readonly string[]).includes(r))).toBe(true);
  });

  it("boardAccessModes شاملِ link_comment نیست (تا فاز ۱۰)", () => {
    expect(boardAccessModes as readonly string[]).not.toContain("link_comment");
  });
});

describe("rtTokenClaims — قراردادِ توکنِ WS (ADR-042، گام ۲٫۳)", () => {
  const ok = { sub: "user-1", boardId: "board-1", role: "editor", exp: 1_760_000_060 };

  it("claimِ معتبر round-trip می‌شود (sub/boardId رشته‌اند، نه لزوماً uuid)", () => {
    expect(rtTokenClaims.parse(ok)).toEqual(ok);
  });

  it("نقشِ نامعتبر، sub خالی، و exp غیرعددی رد می‌شوند", () => {
    expect(rtTokenClaims.safeParse({ ...ok, role: "boss" }).success).toBe(false);
    expect(rtTokenClaims.safeParse({ ...ok, sub: "" }).success).toBe(false);
    expect(rtTokenClaims.safeParse({ ...ok, exp: "soon" }).success).toBe(false);
  });
});

describe("DTOها/بدنه‌های گام ۶ (sdk مصرف‌کننده)", () => {
  it("folder: معتبر می‌گذرد، parentId nullable", () => {
    const f = { id: ID, teamId: ID, name: "طرح‌ها", parentId: null, createdAt: DATE };
    expect(folder.parse(f)).toEqual(f);
    expect(folder.safeParse({ ...f, parentId: ID }).success).toBe(true);
    expect(folder.safeParse({ ...f, name: 5 }).success).toBe(false);
  });

  it("createBoardBody: هر دو فیلد اختیاری؛ teamIdِ غیر-uuid رد", () => {
    expect(createBoardBody.parse({})).toEqual({});
    expect(createBoardBody.safeParse({ title: "x", teamId: ID }).success).toBe(true);
    expect(createBoardBody.safeParse({ teamId: "not-uuid" }).success).toBe(false);
  });

  it("createInviteBody: شماره یا ایمیل لازم؛ بدونِ هیچ‌کدام رد", () => {
    expect(createInviteBody.safeParse({ phone: "09121234567", role: "member" }).success).toBe(true);
    expect(createInviteBody.safeParse({ role: "member" }).success).toBe(false); // نه شماره نه ایمیل
    expect(createInviteBody.safeParse({ phone: "09121234567", role: "owner" }).success).toBe(false); // owner قابلِ‌تخصیص نیست
  });

  it("putAccessBody: accessMode از boardAccessMode؛ link_comment رد", () => {
    expect(putAccessBody.safeParse({ accessMode: "link_edit", regenerate: true }).success).toBe(true);
    expect(putAccessBody.safeParse({ accessMode: "link_comment" }).success).toBe(false);
  });
});

describe("قراردادِ billing — فاز ۲ی M4", () => {
  const PLAN = {
    code: "pro",
    name: "حرفه‌ای",
    description: "برای تیم‌های کوچک",
    priceMonthlyRial: 1_990_000,
    priceYearlyRial: 19_900_000,
    maxMembers: 10,
    maxBoards: 100,
    maxStorageBytes: 10_737_418_240,
    features: ["بوردِ نامحدود", "تاریخچه‌ی نسخه"],
    isActive: true,
    sortOrder: 2,
  };
  const SUB = {
    id: ID,
    teamId: ID,
    planCode: "pro",
    status: "active",
    period: "monthly",
    seats: 7,
    currentPeriodStart: DATE,
    currentPeriodEnd: DATE,
    cancelAtPeriodEnd: false,
  };
  const LINE = { title: "پلنِ حرفه‌ای — ماهانه", qty: 7, unitPriceRial: 1_990_000, totalRial: 13_930_000 };
  const INVOICE = {
    id: ID,
    number: "HB-1405-000123",
    subtotalRial: 13_930_000,
    discountRial: 1_393_000,
    vatRial: 1_253_700,
    totalRial: 13_790_700,
    status: "open",
    issuedAt: DATE,
    paidAt: null,
    lineItems: [LINE],
  };

  it("plan/subscription/invoice: معتبر می‌گذرد", () => {
    expect(plan.parse(PLAN)).toEqual(PLAN);
    expect(subscription.parse(SUB)).toEqual(SUB);
    expect(invoiceLineItem.parse(LINE)).toEqual(LINE);
    expect(invoice.parse(INVOICE)).toEqual(INVOICE);
    expect(invoice.safeParse({ ...INVOICE, status: "paid", paidAt: DATE }).success).toBe(true);
  });

  it("★★ خودآزمون ۱ — `rial` مقدارِ اعشاری را رد می‌کند", () => {
    expect(rial.safeParse(1_500_000).success).toBe(true);
    expect(rial.safeParse(1234.5).success).toBe(false);
    expect(rial.safeParse(-1).success).toBe(false);
    // و همان قاعده روی هر فیلدِ پولیِ واقعی برقرار است، نه فقط روی primitive
    expect(plan.safeParse({ ...PLAN, priceMonthlyRial: 1234.5 }).success).toBe(false);
    expect(invoice.safeParse({ ...INVOICE, totalRial: 0.5 }).success).toBe(false);
  });

  it("★★ خودآزمون ۲ — `rial` مقدارِ bigint را رد می‌کند (تله‌ی JSON.stringify)", () => {
    expect(rial.safeParse(1_500_000n).success).toBe(false);
    expect(plan.safeParse({ ...PLAN, priceYearlyRial: 19_900_000n }).success).toBe(false);
  });

  it("★★ خودآزمون ۳ — هیچ فیلدِ پولیِ پاسخ `.optional()` نیست (فقط `.nullable()`)", () => {
    // `.optional()` در پاسخ نامرئی است: sdk پاسخ را اعتبارسنجی نمی‌کند، پس `undefined`
    // تا مرورگر می‌رود و `formatRial(undefined)` می‌شود «NaN ریال» — بدونِ خطا در هیچ لایه‌ای.
    const moneyBearing = { plan, subscription, invoice, invoiceLineItem };
    const offenders: string[] = [];
    for (const [name, schema] of Object.entries(moneyBearing)) {
      for (const [key, field] of Object.entries(schema.shape)) {
        if (!/rial$/i.test(key)) continue;
        const f = field as { safeParse: (v: unknown) => { success: boolean } };
        if (f.safeParse(undefined).success) offenders.push(`${name}.${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("★ `checkoutBody` هیچ فیلدِ ریالی ندارد (ADR-014: مبلغ از کلاینت پذیرفته نمی‌شود)", () => {
    expect(Object.keys(checkoutBody.shape).filter((k) => /rial|amount|price/i.test(k))).toEqual([]);
    const ok = { planCode: "pro", period: "monthly", seats: 7 };
    expect(checkoutBody.parse(ok)).toEqual(ok);
    expect(checkoutBody.safeParse({ ...ok, seats: 0 }).success).toBe(false);
    expect(checkoutBody.safeParse({ ...ok, period: "weekly" }).success).toBe(false);
  });

  it("★ enumهای وضعیت — پینِ append-only، و تفکیکِ `none` (M4-D2a)", () => {
    expect(subscriptionStatuses).toEqual(["trialing", "active", "past_due", "canceled", "expired"]);
    expect(teamSubscriptionStatuses).toEqual(["none", "trialing", "active", "past_due", "canceled", "expired"]);
    expect(billingPeriods).toEqual(["monthly", "yearly"]);
    expect(invoiceStatuses).toEqual(["draft", "open", "paid", "void", "refunded"]);
    // ★ `none` وضعیتِ تیم است، نه وضعیتِ یک اشتراکِ واقعی
    expect(subscriptionStatus.safeParse("none").success).toBe(false);
    expect(teamSubscriptionStatus.safeParse("none").success).toBe(true);
  });

  it("★ `planLimit` مقدارِ `-1` (نامحدود) را می‌پذیرد ولی `-2` را نه", () => {
    expect(planLimit.safeParse(-1).success).toBe(true);
    expect(planLimit.safeParse(0).success).toBe(true);
    expect(planLimit.safeParse(-2).success).toBe(false);
    expect(plan.safeParse({ ...PLAN, maxBoards: -1 }).success).toBe(true);
    expect(planUsage.safeParse({ members: -1, boards: 0, storageBytes: 0 }).success).toBe(false);
  });

  it("★ `zarinpalCallbackQuery`: `Status` آزاد است (ADR-014 قاعده ۱ — به آن اعتماد نمی‌شود)", () => {
    const q = { Authority: "S00000000000000000000000000000p7r8py", Status: "OK" };
    expect(zarinpalCallbackQuery.parse(q)).toEqual(q);
    // ★ یک مقدارِ سومِ آینده نباید ۴۰۰ بدهد و یک پرداختِ واقعی را گم کند
    expect(zarinpalCallbackQuery.safeParse({ ...q, Status: "SOMETHING_NEW" }).success).toBe(true);
    expect(zarinpalCallbackQuery.safeParse({ ...q, Authority: "" }).success).toBe(false);
  });
});
