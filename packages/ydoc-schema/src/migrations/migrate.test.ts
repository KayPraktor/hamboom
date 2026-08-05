import * as Y from "yjs";
import { describe, expect, it } from "vitest";

import { boardRoots, createBoardDoc, getSchemaVersion, META_KEYS, SCHEMA_VERSION } from "../doc.ts";
import { HB_ERROR_CODES } from "../error-codes.ts";
import { writeElement } from "../element-codec.ts";
import { stickyFixture } from "../test-fixtures.ts";

import {
  checkClientVersion,
  DOC_MIGRATION_ORIGIN,
  DocumentTooNewError,
  migrateDocument,
  MIGRATIONS,
  MigrationPathError,
  type Migration,
} from "./index.ts";

/**
 * ★★ **معیارِ سختِ گام ۲٫۳:** «مسیرِ migration خودش آزموده باشد، نه فقط وجود
 * داشته باشد.»
 *
 * رجیستریِ محصولی خالی است (هنوز نسخه‌ی ۱ ایم)، پس اگر فقط آن را می‌آزمودیم هیچ
 * migrationی هرگز اجرا نمی‌شد و **اولین migrationِ واقعی روی مسیرِ نیازموده**
 * می‌رفت — روی سندهای واقعیِ کاربران. به همین دلیل `migrateDocument` رجیستریِ
 * تزریق‌شدنی می‌گیرد و تست‌های زیر یک زنجیره‌ی ساختگی از همان موتور می‌گذرانند.
 */

/** migrationِ ساختگی: یک فیلدِ نو با مقدارِ پیش‌فرض روی همه‌ی عناصر. */
function addFieldMigration(from: number, field: string, value: unknown): Migration {
  return {
    from,
    to: from + 1,
    describe: `افزودنِ «${field}» با پیش‌فرض`,
    migrate(doc) {
      for (const element of boardRoots(doc).elements.values()) {
        if (element instanceof Y.Map && !element.has(field)) element.set(field, value);
      }
    },
  };
}

describe("رجیستریِ محصولی", () => {
  it("خالی است و روی سندِ نو کاری نمی‌کند", () => {
    const doc = createBoardDoc();
    const result = migrateDocument(doc);

    expect(MIGRATIONS).toEqual([]);
    expect(result).toEqual({
      from: SCHEMA_VERSION,
      to: SCHEMA_VERSION,
      applied: [],
      changed: false,
    });
  });

  it("سندِ از قبل به‌روز هیچ updateای تولید نمی‌کند", () => {
    // بارگذاریِ هر اتاق از این مسیر می‌گذرد (گام ۴٫۲). اگر هر بار یک update
    // می‌ساخت، `board_updates` با ردیف‌های بی‌معنی پر می‌شد.
    const doc = createBoardDoc();
    let updates = 0;
    doc.on("update", () => updates++);
    migrateDocument(doc);
    expect(updates).toBe(0);
  });
});

describe("★ مسیرِ V1→V2 با یک migrationِ ساختگی", () => {
  it("فیلدِ نو روی عناصرِ موجود می‌نشیند و نسخه بالا می‌رود", () => {
    const doc = createBoardDoc();
    writeElement(boardRoots(doc).elements, stickyFixture());

    const result = migrateDocument(doc, {
      migrations: [addFieldMigration(1, "shadow", false)],
      target: 2,
    });

    expect(result.from).toBe(1);
    expect(result.to).toBe(2);
    expect(result.applied).toEqual(["افزودنِ «shadow» با پیش‌فرض"]);
    expect(result.changed).toBe(true);
    expect(getSchemaVersion(doc)).toBe(2);
    expect((boardRoots(doc).elements.get("stk_1") as Y.Map<unknown>).get("shadow")).toBe(false);
  });

  it("زنجیره‌ی چندگامی به ترتیب اجرا می‌شود", () => {
    const doc = createBoardDoc();
    writeElement(boardRoots(doc).elements, stickyFixture());

    const result = migrateDocument(doc, {
      migrations: [addFieldMigration(1, "a", 1), addFieldMigration(2, "b", 2)],
      target: 3,
    });

    expect(result.applied).toHaveLength(2);
    expect(getSchemaVersion(doc)).toBe(3);
    const element = boardRoots(doc).elements.get("stk_1") as Y.Map<unknown>;
    expect(element.get("a")).toBe(1);
    expect(element.get("b")).toBe(2);
  });

  it("اجرای دوباره idempotent است", () => {
    const migrations = [addFieldMigration(1, "shadow", false)];
    const doc = createBoardDoc();
    writeElement(boardRoots(doc).elements, stickyFixture());
    migrateDocument(doc, { migrations, target: 2 });

    let updates = 0;
    doc.on("update", () => updates++);
    const again = migrateDocument(doc, { migrations, target: 2 });

    expect(again.applied).toEqual([]);
    expect(again.changed).toBe(false);
    expect(updates).toBe(0);
  });

  it("★ هر گام تراکنشِ خودش را دارد، با originِ نام‌دار", () => {
    // نه `null`: پیش‌فرضِ `Y.UndoManager` دقیقاً `null` را ردیابی می‌کند
    // (گام ۱٫۴)، پس migrationِ بی‌origin با اولین `Ctrl+Z` برمی‌گشت.
    const doc = createBoardDoc();
    writeElement(boardRoots(doc).elements, stickyFixture());

    const origins: unknown[] = [];
    doc.on("update", (_update: Uint8Array, origin: unknown) => origins.push(origin));
    migrateDocument(doc, {
      migrations: [addFieldMigration(1, "a", 1), addFieldMigration(2, "b", 2)],
      target: 3,
    });

    // دو گام → دو تراکنش. یک تراکنشِ واحد یعنی شکستِ گامِ دوم، گامِ اول را
    // بدونِ برچسبِ نسخه‌ی درست جا می‌گذاشت.
    expect(origins).toEqual([DOC_MIGRATION_ORIGIN, DOC_MIGRATION_ORIGIN]);
  });

  it("★ شکستِ گامِ دوم، گامِ اولِ موفق را **برچسب‌خورده** باقی می‌گذارد", () => {
    const doc = createBoardDoc();
    writeElement(boardRoots(doc).elements, stickyFixture());

    const broken: Migration = {
      from: 2,
      to: 3,
      describe: "گامِ خراب",
      migrate() {
        throw new Error("شکست عمدی");
      },
    };

    expect(() =>
      migrateDocument(doc, { migrations: [addFieldMigration(1, "a", 1), broken], target: 3 }),
    ).toThrow("شکست عمدی");

    // ★ نسخه روی ۲ ایستاده، نه ۱ و نه ۳ — پس بارگذاریِ بعدی گامِ اول را روی
    //   داده‌ی already-migrated **دوباره اجرا نمی‌کند** و از گامِ دوم ادامه می‌دهد.
    expect(getSchemaVersion(doc)).toBe(2);
    expect((boardRoots(doc).elements.get("stk_1") as Y.Map<unknown>).get("a")).toBe(1);
  });
});

describe("سندِ بدونِ نسخه", () => {
  it("نسخه‌ی ۱ فرض و مهر می‌شود", () => {
    // امن است چون `SCHEMA_VERSION` هنوز ۱ است و هیچ بوردی منتشر نشده — نسخه‌ی
    // صفری وجود ندارد که با ۱ اشتباه گرفته شود.
    const doc = new Y.Doc();
    expect(getSchemaVersion(doc)).toBeUndefined();

    const result = migrateDocument(doc);
    expect(result).toEqual({ from: 1, to: 1, applied: [], changed: true });
    expect(getSchemaVersion(doc)).toBe(1);
  });

  it("سندِ بی‌نسخه با migration هم درست بالا می‌رود", () => {
    const doc = new Y.Doc();
    writeElement(boardRoots(doc).elements, stickyFixture());

    migrateDocument(doc, { migrations: [addFieldMigration(1, "shadow", false)], target: 2 });
    expect(getSchemaVersion(doc)).toBe(2);
  });
});

describe("★★ سندِ جلوتر از این build", () => {
  it("خطای صریح می‌دهد و سند را دست نمی‌زند", () => {
    const doc = createBoardDoc();
    boardRoots(doc).meta.set(META_KEYS.schemaVersion, SCHEMA_VERSION + 5);

    let updates = 0;
    doc.on("update", () => updates++);

    expect(() => migrateDocument(doc)).toThrow(DocumentTooNewError);
    // ★ migrateِ رو به عقب وجود ندارد — سکوت اینجا یعنی خرابیِ ساختارِ سندی که
    //   نسخه‌ی جدیدترِ برنامه درستش کرده بود.
    expect(updates).toBe(0);
    expect(getSchemaVersion(doc)).toBe(SCHEMA_VERSION + 5);
  });

  it("کدِ خطا همان چیزی است که به کلاینت می‌رود", () => {
    try {
      const doc = createBoardDoc();
      boardRoots(doc).meta.set(META_KEYS.schemaVersion, 9);
      migrateDocument(doc);
      expect.unreachable("باید خطا می‌داد");
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentTooNewError);
      expect((error as DocumentTooNewError).code).toBe(HB_ERROR_CODES.CLIENT_TOO_OLD);
    }
  });
});

describe("★ نگهبانِ خودِ رجیستری", () => {
  it("پرشِ نسخه رد می‌شود", () => {
    const doc = createBoardDoc();
    const jumping: Migration = { from: 1, to: 3, describe: "پرش", migrate() {} };
    expect(() => migrateDocument(doc, { migrations: [jumping], target: 3 })).toThrow(
      MigrationPathError,
    );
  });

  it("زنجیره‌ی گسسته رد می‌شود", () => {
    const doc = createBoardDoc();
    expect(() =>
      migrateDocument(doc, {
        migrations: [addFieldMigration(1, "a", 1), addFieldMigration(3, "c", 3)],
        target: 4,
      }),
    ).toThrow(MigrationPathError);
  });

  it("★ migration بدونِ بالابردنِ نسخه‌ی هدف رد می‌شود", () => {
    // رایج‌ترین اشتباهِ ممکن: کسی migration اضافه می‌کند و `SCHEMA_VERSION` را
    // فراموش. بدونِ این نگهبان، migration **هرگز اجرا نمی‌شد** و هیچ‌کس نمی‌فهمید.
    const doc = createBoardDoc();
    expect(() =>
      migrateDocument(doc, { migrations: [addFieldMigration(1, "a", 1)], target: 1 }),
    ).toThrow(/SCHEMA_VERSION/);
  });

  it("زنجیره‌ی ناقص تا هدف رد می‌شود", () => {
    const doc = createBoardDoc();
    expect(() =>
      migrateDocument(doc, { migrations: [addFieldMigration(2, "b", 2)], target: 3 }),
    ).toThrow(MigrationPathError);
  });
});

describe("سازگاریِ نسخه‌ی کلاینت", () => {
  it("کلاینتِ هم‌نسخه و جلوتر مجازند", () => {
    expect(checkClientVersion(1, 1)).toEqual({ ok: true });
    // کلاینتِ جلوتر سند را می‌فهمد و چیزی که نمی‌شناسد نمی‌نویسد.
    expect(checkClientVersion(1, 2)).toEqual({ ok: true });
  });

  it("کلاینتِ عقب‌تر با `CLIENT_TOO_OLD` رد می‌شود", () => {
    // اگر رد نشود، ساختاری را که نمی‌فهمد بازنویسی می‌کند و برای بقیه هم خرابش می‌کند.
    expect(checkClientVersion(3, 2)).toEqual({
      ok: false,
      code: HB_ERROR_CODES.CLIENT_TOO_OLD,
      documentVersion: 3,
    });
  });
});
