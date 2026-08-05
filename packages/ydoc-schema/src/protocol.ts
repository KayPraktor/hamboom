import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";

import { HB_ERROR_CODES, type HbErrorCode } from "./error-codes.ts";

/**
 * پروتکلِ WebSocketِ هم‌بوم — [PLAN بخش ۵٫۳](../../../PLAN.md).
 *
 * هر پیام با یک `varUint`ِ **نوع** شروع می‌شود. دو کدِ اول payloadِ خامِ
 * y-protocols را حمل می‌کنند و پنج کدِ `0x1_` فضای نامِ خودِ هم‌بوم‌اند.
 *
 * ── ★ دو قاعده‌ی سازگاریِ رو به جلو ───────────────────────────────────
 *
 * ۱. **نوعِ ناشناخته بی‌صدا نادیده گرفته می‌شود** (`decodeMessage` → `null`).
 *    بدونِ این، اولین کدِ پیامِ جدیدی که در آینده اضافه شود **همه‌ی کلاینت‌های
 *    قدیمی را می‌شکند** — و در یک اپِ وب که کاربر تبش را هفته‌ها باز نگه می‌دارد،
 *    «کلاینتِ قدیمی» یعنی نصفِ کاربرها.
 * ۲. **بایتِ اضافه در انتهای پیام خطا نیست.** هر فیلد طولِ خودش را دارد و decoder
 *    «تا ته خوانده شد» را بررسی **نمی‌کند**. پس نسخه‌ی بعدی می‌تواند فیلد به یک
 *    پیامِ موجود **اضافه** کند و کلاینتِ قدیمی همچنان بخشِ آشنایش را بخواند.
 *
 * ⚠️ ولی **پیامِ خرابِ نوعِ شناخته‌شده خطا می‌دهد** (`ProtocolError`)، نه سکوت.
 * ناشناخته یعنی «هنوز بلد نیستم» و خراب یعنی «یک طرف باگ دارد» — قاطی‌کردنشان
 * یعنی باگ‌های framing برای همیشه پنهان می‌مانند.
 *
 * ── framing و y-protocols ─────────────────────────────────────────────
 *
 * payloadِ `SYNC`/`AWARENESS`/`HB_EPHEMERAL` **طول‌دار** نوشته می‌شود، برخلافِ
 * قراردادِ رایجِ `y-websocket` که بقیه‌ی بافر را payload می‌گیرد. هر دو سرِ این
 * پروتکل خودمانیم (`canvas-sync` و `apps/realtime`)، پس به آن قرارداد مقید
 * نیستیم — و framingِ یکدست همان چیزی است که قاعده‌ی ۲ بالا را ممکن می‌کند.
 */

/** کدهای نوعِ پیام — [PLAN بخش ۵٫۳](../../../PLAN.md). */
export const MSG_TYPES = {
  /** دوطرفه — `y-protocols/sync`: step 1/2/update. */
  SYNC: 0x00,
  /** دوطرفه — `y-protocols/awareness`: مکان‌نما، انتخاب، نما، ابزار. */
  AWARENESS: 0x01,
  /** client→server — توکنِ تازه پیش از انقضا. */
  HB_AUTH_REFRESH: 0x10,
  /** server→client — تغییرِ نقش در لحظه ([ADR-012](../../../ARCHITECTURE_DECISIONS.md#adr-012)). */
  HB_PERMISSION: 0x11,
  /** server→client — تعداد کاربران، وضعیت ذخیره، `seq` جاری. */
  HB_ROOM_INFO: 0x12,
  /** دوطرفه — داده‌ی موقت، **ذخیره نمی‌شود** ([ADR-022](../../../ARCHITECTURE_DECISIONS.md#adr-022)). */
  HB_EPHEMERAL: 0x13,
  /** server→client — `{ code, message }` و سپس بستنِ اتصال. */
  HB_ERROR: 0x14,
} as const;

export type MsgType = (typeof MSG_TYPES)[keyof typeof MSG_TYPES];

/**
 * نقشِ کاربر روی یک بورد — [PLAN بخش ۴](../../../PLAN.md) (`BoardRole`).
 *
 * ⚠️ عمداً اینجاست نه در `shared-types`: قیدِ فعالِ M2 این است که این ماژول بدونِ
 * تغییر در آن تمام شود، و M3 هنوز قراردادِ نقش را ننوشته. اگر M3 لازمش داشت،
 * بردنش تاییدِ مالک می‌خواهد — در فهرستِ گام ۶٫۴ ثبت است.
 *
 * ★ **ترتیب معنا دارد:** روی سیم با **ایندکس** فرستاده می‌شود، پس فقط می‌شود به
 * **انتهای** این آرایه اضافه کرد. جابه‌جا کردنشان یعنی کلاینتِ قدیمی نقشِ اشتباه
 * می‌فهمد — بدترین نوعِ باگِ مجوز.
 */
export const BOARD_ROLES = ["owner", "editor", "commenter", "viewer"] as const;
export type BoardRole = (typeof BOARD_ROLES)[number];

/**
 * وضعیتِ ذخیره — همان سه حالتِ `SaveState`ِ قراردادِ M1.
 *
 * ★ ترتیب همان قاعده‌ی `BOARD_ROLES` را دارد: فقط به انتها اضافه شود.
 */
export const SAVE_STATUSES = ["saved", "saving", "unsaved"] as const;
export type SaveStatus = (typeof SAVE_STATUSES)[number];

/** پیامی از نوعِ شناخته‌شده که خوانده نشد. */
export class ProtocolError extends Error {
  constructor(
    readonly type: number,
    cause: unknown,
  ) {
    super(`پیامِ نوعِ 0x${type.toString(16).padStart(2, "0")} خوانده نشد: ${String(cause)}`);
    this.name = "ProtocolError";
  }
}

export type HbMessage =
  | { type: typeof MSG_TYPES.SYNC; payload: Uint8Array }
  | { type: typeof MSG_TYPES.AWARENESS; payload: Uint8Array }
  | { type: typeof MSG_TYPES.HB_AUTH_REFRESH; token: string }
  | { type: typeof MSG_TYPES.HB_PERMISSION; role: BoardRole }
  | { type: typeof MSG_TYPES.HB_ROOM_INFO; users: number; seq: number; save: SaveStatus }
  /** `payload` برای سرور **مات** است — فقط پخشش می‌کند، هرگز parse یا ذخیره نه. */
  | { type: typeof MSG_TYPES.HB_EPHEMERAL; clientId: number; payload: string }
  /**
   * `code` عمداً `string` است نه `HbErrorCode`: سرورِ جدیدتر می‌تواند کدی بفرستد
   * که این کلاینت نمی‌شناسد، و آن نباید decode را بشکند. فرستنده باید از
   * `HB_ERROR_CODES` استفاده کند و گیرنده قبل از `switch` با
   * [`isKnownErrorCode`](#isknownerrorcode) بسنجد.
   */
  | { type: typeof MSG_TYPES.HB_ERROR; code: string; message: string };

// ─────────────────────────────────────────────────────────────
// encode
// ─────────────────────────────────────────────────────────────

export function encodeMessage(message: HbMessage): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, message.type);

  switch (message.type) {
    case MSG_TYPES.SYNC:
    case MSG_TYPES.AWARENESS:
      encoding.writeVarUint8Array(encoder, message.payload);
      break;
    case MSG_TYPES.HB_AUTH_REFRESH:
      encoding.writeVarString(encoder, message.token);
      break;
    case MSG_TYPES.HB_PERMISSION:
      encoding.writeVarUint(encoder, BOARD_ROLES.indexOf(message.role));
      break;
    case MSG_TYPES.HB_ROOM_INFO:
      encoding.writeVarUint(encoder, message.users);
      encoding.writeVarUint(encoder, message.seq);
      encoding.writeVarUint(encoder, SAVE_STATUSES.indexOf(message.save));
      break;
    case MSG_TYPES.HB_EPHEMERAL:
      encoding.writeVarUint(encoder, message.clientId);
      encoding.writeVarString(encoder, message.payload);
      break;
    case MSG_TYPES.HB_ERROR:
      encoding.writeVarString(encoder, message.code);
      encoding.writeVarString(encoder, message.message);
      break;
    default: {
      // اگر عضوی به union اضافه شود و اینجا جا بیفتد، typecheck می‌افتد.
      const unreachable: never = message;
      throw new Error(`نوعِ پیامِ پشتیبانی‌نشده: ${JSON.stringify(unreachable)}`);
    }
  }

  return encoding.toUint8Array(encoder);
}

// ─────────────────────────────────────────────────────────────
// decode
// ─────────────────────────────────────────────────────────────

/**
 * ★ **fail closed** — ایندکسِ ناشناخته‌ی نقش به محدودترین نقش نگاشته می‌شود.
 *
 * سناریو: سرورِ جدیدتر نقشی می‌فرستد که این کلاینت نمی‌شناسد. سه گزینه بود و دو
 * تایش بد:
 *
 * - **انداختنِ پیام** → کاربری که همین الان به `viewer` تنزل داده شده، با
 *   دسترسیِ قبلی‌اش ادامه می‌دهد. یک حفره‌ی مجوز.
 * - **خطا و بستنِ اتصال** → کلاینت وصل می‌شود، همان پیام را می‌گیرد، دوباره
 *   می‌افتد. حلقه.
 * - ★ **تنزل به `viewer`** → کاربر بوم را فقط-خواندنی می‌بیند. محدودیت **دیده
 *   می‌شود** و با یک رفرش (که نسخه‌ی نو را می‌آورد) درست می‌شود.
 */
function readRole(index: number): BoardRole {
  return BOARD_ROLES[index] ?? "viewer";
}

/**
 * ★ همان قاعده برای وضعیتِ ذخیره: ناشناخته → `unsaved`.
 *
 * قراردادِ M1 صریح است که این وضعیت باید **حقیقت** را بگوید نه خوش‌بینی: اگر
 * `saved` نمایش داده شود در حالی که روی دیسک ننشسته، کاربر تب را می‌بندد و کارش
 * را از دست می‌دهد. پس بدبینانه‌ترین حالت، پیش‌فرضِ درست است.
 */
function readSaveStatus(index: number): SaveStatus {
  return SAVE_STATUSES[index] ?? "unsaved";
}

/**
 * خواندنِ یک پیام.
 *
 * `null` یعنی **نوعِ ناشناخته** — بی‌صدا نادیده بگیر (سازگاریِ رو به جلو).
 * پیامِ خرابِ نوعِ شناخته‌شده `ProtocolError` می‌دهد.
 */
export function decodeMessage(data: Uint8Array): HbMessage | null {
  const decoder = decoding.createDecoder(data);

  let type: number;
  try {
    type = decoding.readVarUint(decoder);
  } catch {
    // حتی یک بایتِ نوع هم نداشت — پیامِ خالی یا خراب، نه «نوعِ ناشناخته».
    return null;
  }

  try {
    switch (type) {
      case MSG_TYPES.SYNC:
        return { type: MSG_TYPES.SYNC, payload: decoding.readVarUint8Array(decoder) };
      case MSG_TYPES.AWARENESS:
        return { type: MSG_TYPES.AWARENESS, payload: decoding.readVarUint8Array(decoder) };
      case MSG_TYPES.HB_AUTH_REFRESH:
        return { type: MSG_TYPES.HB_AUTH_REFRESH, token: decoding.readVarString(decoder) };
      case MSG_TYPES.HB_PERMISSION:
        return { type: MSG_TYPES.HB_PERMISSION, role: readRole(decoding.readVarUint(decoder)) };
      case MSG_TYPES.HB_ROOM_INFO:
        return {
          type: MSG_TYPES.HB_ROOM_INFO,
          users: decoding.readVarUint(decoder),
          seq: decoding.readVarUint(decoder),
          save: readSaveStatus(decoding.readVarUint(decoder)),
        };
      case MSG_TYPES.HB_EPHEMERAL:
        return {
          type: MSG_TYPES.HB_EPHEMERAL,
          clientId: decoding.readVarUint(decoder),
          payload: decoding.readVarString(decoder),
        };
      case MSG_TYPES.HB_ERROR:
        return {
          type: MSG_TYPES.HB_ERROR,
          code: decoding.readVarString(decoder),
          message: decoding.readVarString(decoder),
        };
      default:
        // ★ نوعِ ناشناخته — نه خطا، نه لاگِ ترسناک. همین سکوت است که اجازه می‌دهد
        //   نسخه‌ی بعدی پیامِ تازه اضافه کند بدونِ شکستنِ کلاینت‌های باز.
        return null;
    }
  } catch (cause) {
    throw new ProtocolError(type, cause);
  }
}

/**
 * فهرست از **خودِ** `HB_ERROR_CODES` مشتق می‌شود، نه یک کپیِ دستی — همان دلیلی که
 * آن ثابت در گام ۲٫۳ ساخته شد: enumی که دو نسخه دارد enum نیست.
 */
const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set(Object.values(HB_ERROR_CODES));

/** آیا این کدِ خطا برای این نسخه شناخته‌شده است؟ */
export function isKnownErrorCode(code: string): code is HbErrorCode {
  return KNOWN_ERROR_CODES.has(code);
}
