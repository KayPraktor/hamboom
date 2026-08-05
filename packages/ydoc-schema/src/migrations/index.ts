import type * as Y from "yjs";

import { boardRoots, getSchemaVersion, META_KEYS, SCHEMA_VERSION } from "../doc.ts";
import { HB_ERROR_CODES } from "../error-codes.ts";

import { MIGRATIONS, type Migration } from "./registry.ts";

export { MIGRATIONS, type Migration } from "./registry.ts";

/**
 * اجرای migrationِ ساختارِ سند — [PLAN بخش ۷٫۵](../../../../PLAN.md).
 *
 * ── کجا اجرا می‌شود ───────────────────────────────────────────────────
 *
 * **در سرور، هنگام بارگذاریِ اتاق** (گام ۴٫۲) — نه در کلاینت. اگر هر کلاینت خودش
 * migrate می‌کرد، دو کلاینت با دو نسخه‌ی متفاوت از کد دو نتیجه‌ی متفاوت روی یک سند
 * می‌نوشتند و CRDT هر دو را نگه می‌داشت. یک نقطه‌ی اجرا یعنی یک نتیجه.
 */

/**
 * originِ تراکنشِ migration.
 *
 * نام‌دار، به همان دلیلِ [`DOC_INIT_ORIGIN`](../doc.ts): پیش‌فرضِ `Y.UndoManager`
 * دقیقاً originِ `null` را ردیابی می‌کند (سنجیده‌شده در گام ۱٫۴)، پس migrationِ
 * بی‌origin می‌توانست با اولین `Ctrl+Z`ِ کاربر برگردانده شود.
 */
export const DOC_MIGRATION_ORIGIN = "ydoc-schema:migration";

/**
 * نسخه‌ای که سندِ **بدونِ** `meta.schemaVersion` با آن یکی گرفته می‌شود.
 *
 * چرا این امن است و یک حدسِ خطرناک نیست: `SCHEMA_VERSION` هنوز ۱ است و هیچ
 * بوردی منتشر نشده، پس نسخه‌ی صفری وجود ندارد که با ۱ اشتباه گرفته شود. سندِ
 * بی‌نسخه یعنی سندی که پیش از نوشتنِ `meta` ساخته شده — یا اصلاً خالی است.
 */
export const EARLIEST_SCHEMA_VERSION = 1;

/** سند از چیزی که این build می‌فهمد **جلوتر** است. */
export class DocumentTooNewError extends Error {
  readonly code = HB_ERROR_CODES.CLIENT_TOO_OLD;

  constructor(
    readonly documentVersion: number,
    readonly supportedVersion: number,
  ) {
    super(
      `نسخه‌ی سند ${documentVersion} است ولی این نسخه از برنامه تا ${supportedVersion} را می‌فهمد. ` +
        `سند به عقب migrate نمی‌شود — این build نباید بارگذاری‌اش کند.`,
    );
    this.name = "DocumentTooNewError";
  }
}

/** زنجیره‌ی migration پیوسته نیست یا به نسخه‌ی هدف نمی‌رسد. */
export class MigrationPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationPathError";
  }
}

export interface MigrationResult {
  /** نسخه‌ی سند پیش از اجرا. */
  from: number;
  /** نسخه‌ی سند پس از اجرا. */
  to: number;
  /** `describe`ِ migrationهای اجراشده، به ترتیب — برای لاگِ سرور. */
  applied: string[];
  /** آیا سند اصلاً دست خورد؟ (`false` یعنی از قبل به‌روز و مهر خورده بود.) */
  changed: boolean;
}

export interface MigrateOptions {
  /**
   * رجیستریِ جایگزین — **فقط برای تست**.
   *
   * بدونِ این، تا اولین migrationِ واقعی هیچ راهی برای آزمودنِ خودِ موتور نبود و
   * اولین migrationِ محصولی روی مسیرِ نیازموده اجرا می‌شد.
   */
  migrations?: readonly Migration[];
  /** نسخه‌ی هدف — پیش‌فرض `SCHEMA_VERSION`. */
  target?: number;
}

/**
 * بررسیِ اینکه زنجیره پیوسته است و به هدف می‌رسد.
 *
 * جدا و همیشه اجرا می‌شود (نه فقط وقتی migration لازم است): یک رجیستریِ خراب
 * باید در اولین بارگذاری بیرون بیفتد، نه ماه‌ها بعد وقتی اولین سندِ قدیمی رسید.
 */
function assertChain(migrations: readonly Migration[], target: number): void {
  for (const [i, migration] of migrations.entries()) {
    if (migration.to !== migration.from + 1) {
      throw new MigrationPathError(
        `migrationِ «${migration.describe}» از ${migration.from} به ${migration.to} می‌پرد. ` +
          `هر گام باید دقیقاً یکی جلو برود تا زنجیره قابلِ بازرسی بماند.`,
      );
    }
    const previous = migrations[i - 1];
    if (previous && previous.to !== migration.from) {
      throw new MigrationPathError(
        `زنجیره پیوسته نیست: بعد از نسخه‌ی ${previous.to} یک migration با from=${migration.from} آمده.`,
      );
    }
  }

  const last = migrations.at(-1);
  if (last && last.to !== target) {
    throw new MigrationPathError(
      `آخرین migration به نسخه‌ی ${last.to} می‌رسد ولی نسخه‌ی هدف ${target} است. ` +
        `احتمالاً migration اضافه شده و SCHEMA_VERSION بالا نرفته (یا برعکس).`,
    );
  }
}

/**
 * سند را به `target` می‌رساند.
 *
 * ── ★ چرا هر گام تراکنشِ **خودش** را دارد ─────────────────────────────
 *
 * وسوسه‌اش این است که کلِ زنجیره در یک تراکنش برود. ولی اگر گامِ دوم خطا بدهد،
 * Yjs تغییراتِ گامِ اول را برنمی‌گرداند — و اگر مهرِ نسخه فقط در انتها زده شود،
 * سند **داده‌ی migrate‌شده با برچسبِ نسخه‌ی قدیمی** می‌مانَد و بارگذاریِ بعدی همان
 * گام را روی داده‌ی already-migrated دوباره اجرا می‌کند. با یک تراکنش به‌ازای هر
 * گام، هر گامِ موفق **بادوام و برچسب‌خورده** است و ادامه از همان‌جا امن می‌مانَد.
 */
export function migrateDocument(doc: Y.Doc, options: MigrateOptions = {}): MigrationResult {
  const migrations = options.migrations ?? MIGRATIONS;
  const target = options.target ?? SCHEMA_VERSION;
  assertChain(migrations, target);

  const stored = getSchemaVersion(doc);
  const from = stored ?? EARLIEST_SCHEMA_VERSION;

  if (from > target) throw new DocumentTooNewError(from, target);

  const applied: string[] = [];
  let current = from;

  while (current < target) {
    const step = migrations.find((migration) => migration.from === current);
    if (!step) {
      throw new MigrationPathError(
        `راهی از نسخه‌ی ${current} به ${target} وجود ندارد — migrationِ ${current}→${current + 1} ثبت نشده.`,
      );
    }
    doc.transact(() => {
      step.migrate(doc);
      boardRoots(doc).meta.set(META_KEYS.schemaVersion, step.to);
    }, DOC_MIGRATION_ORIGIN);
    applied.push(step.describe);
    current = step.to;
  }

  // سندی که نسخه‌اش نوشته نشده بود، همین‌جا مهر می‌خورد — وگرنه هر بار بارگذاری
  // دوباره «بی‌نسخه» به نظر می‌رسید.
  let stamped = false;
  if (stored === undefined) {
    doc.transact(() => {
      boardRoots(doc).meta.set(META_KEYS.schemaVersion, current);
    }, DOC_MIGRATION_ORIGIN);
    stamped = true;
  }

  return { from, to: current, applied, changed: applied.length > 0 || stamped };
}

export type ClientVersionCheck =
  { ok: true } | { ok: false; code: typeof HB_ERROR_CODES.CLIENT_TOO_OLD; documentVersion: number };

/**
 * آیا کلاینتی که تا `clientSupports` را می‌فهمد می‌تواند این اتاق را باز کند؟
 *
 * سرور بعد از migration این را می‌سنجد (گام ۴٫۱). کلاینتِ **جلوتر** مشکلی نیست —
 * سند را می‌فهمد و چیزی که نمی‌شناسد نمی‌نویسد. فقط کلاینتِ **عقب‌تر** باید رد
 * شود، وگرنه ساختاری را که نمی‌فهمد بازنویسی می‌کند و برای بقیه هم خرابش می‌کند.
 *
 * تصمیم اینجاست و فرستادنِ پیام در فاز ۴ — تا این قاعده بدونِ سرور آزمودنی بماند.
 */
export function checkClientVersion(
  documentVersion: number,
  clientSupports: number,
): ClientVersionCheck {
  if (clientSupports < documentVersion) {
    return { ok: false, code: HB_ERROR_CODES.CLIENT_TOO_OLD, documentVersion };
  }
  return { ok: true };
}
