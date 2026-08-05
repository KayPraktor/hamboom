import * as encoding from "lib0/encoding";
import { describe, expect, it } from "vitest";

import { HB_ERROR_CODES } from "./error-codes.ts";
import {
  BOARD_ROLES,
  decodeMessage,
  encodeMessage,
  isKnownErrorCode,
  MSG_TYPES,
  ProtocolError,
  SAVE_STATUSES,
  type HbMessage,
} from "./protocol.ts";

/** یک نمونه از **هر هفت** نوعِ پیامِ PLAN بخش ۵٫۳. */
const SAMPLES: ReadonlyArray<{ label: string; message: HbMessage }> = [
  {
    label: "0x00 SYNC",
    message: { type: MSG_TYPES.SYNC, payload: new Uint8Array([0, 1, 255, 128, 0]) },
  },
  {
    label: "0x01 AWARENESS",
    message: { type: MSG_TYPES.AWARENESS, payload: new Uint8Array([7, 7, 7]) },
  },
  {
    label: "0x10 HB_AUTH_REFRESH",
    message: { type: MSG_TYPES.HB_AUTH_REFRESH, token: "eyJhbGciOi.سلام.sig" },
  },
  { label: "0x11 HB_PERMISSION", message: { type: MSG_TYPES.HB_PERMISSION, role: "commenter" } },
  {
    label: "0x12 HB_ROOM_INFO",
    message: { type: MSG_TYPES.HB_ROOM_INFO, users: 3, seq: 9_007_199_254_740_991, save: "saving" },
  },
  {
    label: "0x13 HB_EPHEMERAL",
    message: {
      type: MSG_TYPES.HB_EPHEMERAL,
      clientId: 42,
      payload: '{"kind":"laser","points":[[0,0]]}',
    },
  },
  {
    label: "0x14 HB_ERROR",
    message: {
      type: MSG_TYPES.HB_ERROR,
      code: HB_ERROR_CODES.CLIENT_TOO_OLD,
      message: "نسخه‌ی کلاینت قدیمی است؛ صفحه را تازه کنید.",
    },
  },
];

describe("round-trip هر ۷ نوعِ پیام", () => {
  it("کدها دقیقاً همان‌های PLAN بخش ۵٫۳ اند", () => {
    expect(Object.values(MSG_TYPES)).toEqual([0x00, 0x01, 0x10, 0x11, 0x12, 0x13, 0x14]);
    expect(SAMPLES).toHaveLength(Object.keys(MSG_TYPES).length);
  });

  for (const { label, message } of SAMPLES) {
    it(`«${label}» بیت‌به‌بیت برمی‌گردد`, () => {
      expect(decodeMessage(encodeMessage(message))).toEqual(message);
    });
  }

  it("payloadِ باینری با بایت‌های ۰x00 و ۰xFF سالم می‌مانَد", () => {
    // اگر جایی به رشته تبدیل شود، همین بایت‌ها خرابش می‌کنند — همان تله‌ای که
    // در `db:smoke` (گام ۰٫۳) برای `bytea` گذاشته شد.
    const payload = new Uint8Array([0x00, 0xff, 0x80, 0x00, 0x7f]);
    const back = decodeMessage(encodeMessage({ type: MSG_TYPES.SYNC, payload }));
    expect(back).toEqual({ type: MSG_TYPES.SYNC, payload });
  });

  it("هر نقش و هر وضعیتِ ذخیره round-trip می‌شود", () => {
    for (const role of BOARD_ROLES) {
      expect(decodeMessage(encodeMessage({ type: MSG_TYPES.HB_PERMISSION, role }))).toEqual({
        type: MSG_TYPES.HB_PERMISSION,
        role,
      });
    }
    for (const save of SAVE_STATUSES) {
      const message: HbMessage = { type: MSG_TYPES.HB_ROOM_INFO, users: 1, seq: 0, save };
      expect(decodeMessage(encodeMessage(message))).toEqual(message);
    }
  });

  it("متنِ فارسی و emoji در رشته‌ها سالم می‌مانند", () => {
    const message: HbMessage = {
      type: MSG_TYPES.HB_ERROR,
      code: HB_ERROR_CODES.ROOM_CLOSED,
      message: "اتاق بسته شد ✅ — نیم‌فاصله هم: هم‌بوم",
    };
    expect(decodeMessage(encodeMessage(message))).toEqual(message);
  });
});

/**
 * ★★ سازگاریِ رو به جلو — معیارِ سختِ گام ۲٫۴.
 *
 * در یک اپِ وب که کاربر تبش را هفته‌ها باز نگه می‌دارد، «کلاینتِ قدیمی» یعنی
 * بخشِ بزرگی از کاربران. اگر پروتکل رو به جلو سازگار نباشد، هر دیپلوی که یک کدِ
 * پیامِ تازه بیاورد آن‌ها را می‌شکند.
 */
describe("★★ سازگاریِ رو به جلو", () => {
  it("نوعِ ناشناخته `null` می‌دهد، نه خطا", () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0x7f); // کدی که هنوز وجود ندارد
    encoding.writeVarString(encoder, "چیزی از آینده");

    expect(decodeMessage(encoding.toUint8Array(encoder))).toBeNull();
  });

  it("★ بایتِ اضافه در انتهای پیامِ شناخته‌شده خطا نیست", () => {
    // یعنی نسخه‌ی بعدی می‌تواند به یک پیامِ **موجود** فیلد اضافه کند و کلاینتِ
    // قدیمی همچنان بخشِ آشنایش را بخواند. اگر decoder «تا ته خوانده شد» را
    // بررسی می‌کرد، این مسیر برای همیشه بسته می‌شد.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_TYPES.HB_ROOM_INFO);
    encoding.writeVarUint(encoder, 5);
    encoding.writeVarUint(encoder, 12);
    encoding.writeVarUint(encoder, SAVE_STATUSES.indexOf("saved"));
    encoding.writeVarString(encoder, "فیلدی که نسخه‌ی ۲ اضافه کرده");

    expect(decodeMessage(encoding.toUint8Array(encoder))).toEqual({
      type: MSG_TYPES.HB_ROOM_INFO,
      users: 5,
      seq: 12,
      save: "saved",
    });
  });

  it("کدِ خطای ناشناخته decode را نمی‌شکند", () => {
    const message: HbMessage = {
      type: MSG_TYPES.HB_ERROR,
      code: "SOMETHING_FROM_THE_FUTURE",
      message: "…",
    };
    const back = decodeMessage(encodeMessage(message));

    expect(back).toEqual(message);
    // گیرنده باید **قبل از** switch بسنجد، نه اینکه فرض کند همیشه شناخته‌شده است.
    expect(isKnownErrorCode("SOMETHING_FROM_THE_FUTURE")).toBe(false);
    expect(isKnownErrorCode(HB_ERROR_CODES.FORBIDDEN)).toBe(true);
  });

  it("فهرستِ کدهای شناخته‌شده از خودِ `HB_ERROR_CODES` می‌آید", () => {
    for (const code of Object.values(HB_ERROR_CODES)) expect(isKnownErrorCode(code)).toBe(true);
  });
});

/**
 * ★★ **fail closed** — نقش و وضعیتِ ذخیره‌ی ناشناخته به محدودترین/بدبینانه‌ترین
 * حالت می‌افتند، نه اینکه پیام انداخته شود.
 */
describe("★★ مقدارِ ناشناخته در پیامِ شناخته‌شده", () => {
  it("نقشِ ناشناخته → `viewer`، نه انداختنِ پیام", () => {
    // انداختنِ پیام یعنی کاربری که همین الان تنزل داده شده با دسترسیِ قبلی‌اش
    // ادامه می‌دهد — یک حفره‌ی مجوز. تنزل به viewer **دیده می‌شود** و با یک
    // رفرش درست می‌شود.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_TYPES.HB_PERMISSION);
    encoding.writeVarUint(encoder, BOARD_ROLES.length + 3);

    expect(decodeMessage(encoding.toUint8Array(encoder))).toEqual({
      type: MSG_TYPES.HB_PERMISSION,
      role: "viewer",
    });
  });

  it("وضعیتِ ذخیره‌ی ناشناخته → `unsaved`، نه `saved`", () => {
    // قراردادِ M1: این وضعیت باید **حقیقت** را بگوید نه خوش‌بینی. `saved`ِ
    // دروغین یعنی کاربر تب را می‌بندد و کارش را از دست می‌دهد.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_TYPES.HB_ROOM_INFO);
    encoding.writeVarUint(encoder, 1);
    encoding.writeVarUint(encoder, 0);
    encoding.writeVarUint(encoder, 99);

    expect(decodeMessage(encoding.toUint8Array(encoder))).toEqual({
      type: MSG_TYPES.HB_ROOM_INFO,
      users: 1,
      seq: 0,
      save: "unsaved",
    });
  });
});

describe("پیامِ خراب — سکوت نه", () => {
  it("پیامِ ناقصِ نوعِ شناخته‌شده `ProtocolError` می‌دهد", () => {
    // ناشناخته یعنی «هنوز بلد نیستم»، خراب یعنی «یک طرف باگ دارد». قاطی‌کردنشان
    // یعنی باگ‌های framing برای همیشه پنهان می‌مانند.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_TYPES.HB_ERROR); // بدونِ code و message
    expect(() => decodeMessage(encoding.toUint8Array(encoder))).toThrow(ProtocolError);
  });

  it("بافرِ خالی `null` می‌دهد", () => {
    expect(decodeMessage(new Uint8Array())).toBeNull();
  });
});

describe("اندازه‌ی سیم", () => {
  it("سربارِ framing برای یک پیامِ کوچک ناچیز است", () => {
    const bytes = encodeMessage({ type: MSG_TYPES.HB_PERMISSION, role: "viewer" }).byteLength;
    // یک بایت نوع + یک بایت ایندکسِ نقش.
    expect(bytes).toBe(2);
  });

  it("پوششِ `SYNC` روی payload فقط طولش را اضافه می‌کند", () => {
    const payload = new Uint8Array(1000);
    const framed = encodeMessage({ type: MSG_TYPES.SYNC, payload }).byteLength;
    // ۱ بایت نوع + varUintِ طول (۲ بایت برای ۱۰۰۰) + خودِ payload.
    expect(framed).toBe(1 + 2 + 1000);
  });
});
