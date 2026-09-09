/**
 * ★★ خودآزمونِ جاروبِ بلابِ یتیم — M5 گام ۸٫۲.
 *
 * ⚠️ **چرا این خودآزمون از بقیه مهم‌تر است:** خطای بقیه‌ی سنجه‌ها یک گزارشِ غلط است؛
 * خطای این یکی **پاک‌شدنِ بلابِ یک کاربرِ زنده**. پس چیزی که این‌جا اثبات می‌شود بیشتر
 * از «کار می‌کند» است — اینکه هر محافظ **به‌تنهایی لازم** است.
 *
 * | سناریو | انتظار | محافظِ مسئول |
 * |---|---|---|
 * | شیءِ **دارای مرجع**، هرچقدر هم کهنه | ✅ دست‌نخورده | مرجعِ دیتابیس |
 * | بی‌مرجع ولی **جوان** | ✅ دست‌نخورده | دوره‌ی مهلت |
 * | همان شیءِ جوان، با مهلتِ صفر | ⚠️ یتیم می‌شود | ← اثبات می‌کند مهلت نگهش داشته بود، نه چیزِ دیگر |
 * | بی‌مرجع با **سنِ نامعلوم** | ✅ دست‌نخورده + گزارش | قاعده‌ی ابهامِ ADR-056 |
 * | بی‌مرجع و کهنه | ✔ یتیم | — |
 *
 * ★ سناریوی سوم همان الگوی «کدام چک گرفتش» است: یک محافظ که با برداشتنش هم نتیجه
 * عوض نشود، محافظ نیست.
 */
import type { ObjectHead, ObjectStore } from "@hamboom/storage";

import { deleteOrphans, planSweep, type SweepPlan } from "./sweep-orphans-core.ts";

interface FakeObject {
  bytes: number;
  /** `undefined` یعنی انبار سن را نمی‌داند — حالتِ ابهام. */
  lastModified: Date | undefined;
}

/** انبارِ ساختگی با سنِ **کنترل‌شده** — انبارِ حافظه‌ای همیشه «الان» می‌دهد. */
function fakeStore(objects: Record<string, FakeObject>): ObjectStore {
  const head = (key: string): ObjectHead | null => {
    const found = objects[key];
    if (found === undefined) return null;
    return {
      size: found.bytes,
      contentType: "application/octet-stream",
      etag: undefined,
      lastModified: found.lastModified,
    };
  };
  return {
    putObject: () => Promise.resolve(),
    getObject: () => Promise.resolve(null),
    deleteObject: () => Promise.resolve(),
    headObject: (key) => Promise.resolve(head(key)),
    listPrefix: (prefix) =>
      Promise.resolve(Object.keys(objects).filter((k) => k.startsWith(prefix))),
    presignGet: () => Promise.reject(new Error("بدلِ تست")),
    presignUpload: () => Promise.reject(new Error("بدلِ تست")),
  };
}

const NOW = Date.UTC(2026, 8, 9, 12, 0, 0);
const hoursAgo = (h: number): Date => new Date(NOW - h * 3_600_000);

interface Result {
  name: string;
  ok: boolean;
  detail: string;
}

export async function runSelfTest(): Promise<void> {
  const results: Result[] = [];
  const record = (name: string, ok: boolean, detail: string): void => {
    results.push({ name, ok, detail });
  };

  const objects: Record<string, FakeObject> = {
    "live/referenced-and-ancient.bin": { bytes: 10, lastModified: hoursAgo(24 * 365) },
    "junk/young.bin": { bytes: 20, lastModified: hoursAgo(1) },
    "junk/old.bin": { bytes: 30, lastModified: hoursAgo(72) },
    "junk/unknown-age.bin": { bytes: 40, lastModified: undefined },
  };
  const store = fakeStore(objects);
  const referenced = new Set(["live/referenced-and-ancient.bin"]);

  const plan: SweepPlan = await planSweep(store, "fake", referenced, NOW, 24);
  const orphanKeys = plan.orphans.map((o) => o.key);

  // ── ۱: شیءِ دارای مرجع هرگز یتیم نیست ─────────────────────────────
  {
    const ok = !orphanKeys.includes("live/referenced-and-ancient.bin") && plan.referenced === 1;
    record(
      "★★ شیءِ **دارای مرجع** هرگز یتیم شمرده نمی‌شود — حتی با سنِ یک‌ساله",
      ok,
      ok
        ? "کهنگی هیچ‌وقت جای مرجع را نمی‌گیرد"
        : `واقعی: یتیم‌ها=${orphanKeys.join(",")} · دارای مرجع=${String(plan.referenced)}`,
    );
  }

  // ── ۲: بی‌مرجعِ جوان دست‌نخورده ────────────────────────────────────
  {
    const ok = plan.tooYoung.includes("junk/young.bin") && !orphanKeys.includes("junk/young.bin");
    record(
      "★ بی‌مرجعِ **جوان** دست‌نخورده می‌مانَد (پنجره‌ی آپلودِ commit‌نشده)",
      ok,
      ok ? "۱ ساعته، زیرِ مهلتِ ۲۴ ساعت" : `واقعی: ${orphanKeys.join(",")}`,
    );
  }

  // ── ۳: ★ همان شیء با مهلتِ صفر ⇒ یتیم می‌شود ───────────────────────
  {
    const zero = await planSweep(store, "fake", referenced, NOW, 0);
    const zeroKeys = zero.orphans.map((o) => o.key);
    const ok = zeroKeys.includes("junk/young.bin");
    record(
      "★ با مهلتِ **صفر** همان شیء یتیم می‌شود ⇒ پس مهلت بود که نگهش داشت",
      ok,
      ok
        ? "محافظِ مهلت واقعاً کار می‌کند، نه اینکه تصادفاً چیزی انتخاب نشده باشد"
        : `واقعی با مهلتِ صفر: ${zeroKeys.join(",")}`,
    );
  }

  // ── ۴: سنِ نامعلوم ⇒ دست‌نخورده و گزارش‌شده ────────────────────────
  {
    const ok =
      plan.unknownAge.includes("junk/unknown-age.bin") &&
      !orphanKeys.includes("junk/unknown-age.bin");
    record(
      "★ سنِ **نامعلوم** ⇒ پاک نمی‌شود و ساکت هم نمی‌مانَد (ADR-056)",
      ok,
      ok ? "ابهام هیچ‌وقت به حذف تبدیل نمی‌شود" : `واقعی: unknownAge=${plan.unknownAge.join(",")}`,
    );
  }

  // ── ۵: و بالاخره، یتیمِ واقعی پیدا می‌شود ──────────────────────────
  {
    const ok = orphanKeys.length === 1 && orphanKeys[0] === "junk/old.bin";
    record(
      "یتیمِ واقعی (بی‌مرجع و کهنه) پیدا می‌شود ⇒ جاروب «همیشه خالی» نیست",
      ok,
      ok ? "junk/old.bin — ۷۲ ساعته، بی‌مرجع" : `واقعی: ${orphanKeys.join(",") || "هیچ"}`,
    );
  }

  // ── ۶: ★★ مسیرِ **حذف** — فقط یتیم‌ها به deleteObject می‌رسند ────────
  {
    // ⚠️ این خطرناک‌ترین چند خطِ ریپوست و بدونِ این سناریو تنها بخشِ آزمون‌نشده‌اش
    //    می‌مانْد: اثباتش با داده‌ی واقعی یعنی پاک‌کردنِ داده‌ی واقعی.
    const deleted: string[] = [];
    const recording: ObjectStore = {
      ...fakeStore(objects),
      deleteObject: (key) => {
        deleted.push(key);
        return Promise.resolve();
      },
    };
    const removed = await deleteOrphans(recording, plan);
    const ok =
      deleted.length === 1 &&
      deleted[0] === "junk/old.bin" &&
      removed.length === 1 &&
      !deleted.includes("live/referenced-and-ancient.bin") &&
      !deleted.includes("junk/young.bin") &&
      !deleted.includes("junk/unknown-age.bin");
    record(
      "★★ مسیرِ حذف **فقط** یتیم را پاک می‌کند — نه دارای‌مرجع، نه جوان، نه مبهم",
      ok,
      ok
        ? "deleteObject دقیقاً یک بار، روی junk/old.bin"
        : `واقعی: پاک‌شده‌ها=${deleted.join(",") || "هیچ"}`,
    );
  }

  console.log("── خودآزمونِ جاروبِ بلابِ یتیم ──");
  for (const r of results) console.log(`${r.ok ? "✔" : "✖"} ${r.name}\n    ${r.detail}`);
  const reds = results.filter((r) => !r.ok);
  if (reds.length > 0) {
    console.error(`\n✖ ${String(reds.length)} سناریو شکست — این جاروب قابلِ اتکا نیست.`);
    process.exit(1);
  }
  console.log("\n✔ هر سه محافظ **به‌تنهایی** لازم‌اند، و مسیرِ حذف فقط به یتیمِ واقعی می‌رسد.");
}
