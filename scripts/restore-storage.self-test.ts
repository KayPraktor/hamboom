/**
 * ★★ خودآزمونِ بازیابیِ Object Storage — M6 فاز ۲٫۳. بدونِ MinIO و بدونِ Postgres.
 *
 * هفت سناریو، و برای هر شکستنِ عمدی **کدام چک** باید بگیردش (درسِ مشقِ M5: «قرمز شد» کافی نیست):
 *
 * | سناریو | چکِ مسئول | چه چیزی را اثبات می‌کند |
 * |---|---|---|
 * | آینه‌ی سالم | — (همه سبز) | گیت «همیشه قرمز» نیست |
 * | ★ یک بیتِ چرخانده، **هم‌اندازه** | فقط `integrity` | اندازه کافی نیست؛ sha لازم است |
 * | شیءِ آینه بریده | `size` | آینه‌ی ناقص |
 * | ورودیِ مانیفست بی‌شیء | `count` | شیءِ گم‌شده |
 * | ★ ردیفِ DB با کلیدی که مانیفست ندارد | `catalog` | پنجره‌ی compactor بینِ dump و آینه |
 * | ★ بایت‌های درستِ آینه ولی Y.Docِ خراب (sha درست!) | فقط `opens` | integrity سبز و سند بی‌ارزش |
 * | دامنه‌ی خالی | `vacuous` | بازیابیِ «هیچ» |
 */
import { createHash } from "node:crypto";

import { createMemoryObjectStore, type ObjectStore } from "@hamboom/storage";
import * as Y from "yjs";

import { mirrorKeyOf, type MirrorEntry, type StorageManifest } from "./backup-run.ts";
import { restoreAndVerify, type SnapshotRow, type StorageCheckId } from "./restore-storage-core.ts";

const BUCKET = "hamboom-snapshots";
const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

interface World {
  backups: ObjectStore;
  manifest: StorageManifest;
  snapshots: SnapshotRow[];
  bytes: Record<string, Uint8Array>;
}

/** یک Y.Docِ واقعی با محتوا — همان چیزی که compactor می‌نویسد. */
function realSnapshot(seed: string): { bytes: Uint8Array; stateVector: Uint8Array } {
  const doc = new Y.Doc();
  doc.getMap("elements").set(seed, { x: 1, y: 2, text: seed });
  const bytes = Y.encodeStateAsUpdate(doc);
  const stateVector = Y.encodeStateVector(doc);
  doc.destroy();
  return { bytes, stateVector };
}

async function world(): Promise<World> {
  const backups = createMemoryObjectStore();
  const s1 = realSnapshot("board-a");
  const s2 = realSnapshot("board-b");
  const bytes: Record<string, Uint8Array> = {
    "board-a/000000000010.ybin": s1.bytes,
    "board-b/000000000020.ybin": s2.bytes,
    "misc/not-a-snapshot.bin": new Uint8Array(4096).map((_, i) => (i * 7) & 0xff),
  };
  for (const [k, v] of Object.entries(bytes)) await backups.putObject(mirrorKeyOf(BUCKET, k), v);
  const entries: MirrorEntry[] = Object.entries(bytes).map(([key, v]) => ({
    key,
    size: v.byteLength,
    sha256: sha(v),
  }));
  const manifest: StorageManifest = {
    takenAt: "2026-09-12T00:00:00Z",
    buckets: { [BUCKET]: entries },
  };
  const snapshots: SnapshotRow[] = [
    {
      storageKey: "board-a/000000000010.ybin",
      byteSize: s1.bytes.byteLength,
      stateVector: s1.stateVector,
    },
    {
      storageKey: "board-b/000000000020.ybin",
      byteSize: s2.bytes.byteLength,
      stateVector: s2.stateVector,
    },
  ];
  return { backups, manifest, snapshots, bytes };
}

interface Result {
  name: string;
  ok: boolean;
  detail: string;
}

export async function runSelfTest(): Promise<void> {
  const results: Result[] = [];
  const run = async (w: World, prefix = ""): Promise<Map<StorageCheckId, boolean>> => {
    const checks = await restoreAndVerify({
      backups: w.backups,
      target: createMemoryObjectStore(),
      manifest: w.manifest,
      scope: { bucket: BUCKET, prefix },
      snapshots: w.snapshots,
    });
    return new Map(checks.map((c) => [c.id, c.ok]));
  };
  const exactly = (m: Map<StorageCheckId, boolean>, reds: StorageCheckId[]): boolean =>
    [...m.entries()].every(([id, ok]) => ok === !reds.includes(id));
  const describe = (m: Map<StorageCheckId, boolean>): string =>
    [...m.entries()]
      .filter(([, ok]) => !ok)
      .map(([id]) => id)
      .join(",") || "هیچ";
  const record = (name: string, m: Map<StorageCheckId, boolean>, reds: StorageCheckId[]): void => {
    const ok = exactly(m, reds);
    results.push({
      name,
      ok,
      detail: ok
        ? reds.length === 0
          ? "هر ۶ چک سبز"
          : `فقط ${reds.join(",")} قرمز شد`
        : `انتظار قرمز: ${reds.join(",") || "هیچ"} · واقعی: ${describe(m)}`,
    });
  };

  // ۱) سالم
  record("آینه‌ی سالم ⇒ هر شش چک **سبز**", await run(await world()), []);

  // ۲) ★ بیتِ چرخانده، هم‌اندازه — روی شیئی که snapshot نیست تا opens دخیل نشود
  {
    const w = await world();
    const k = mirrorKeyOf(BUCKET, "misc/not-a-snapshot.bin");
    const b = (await w.backups.getObject(k))!;
    b[100] = (b[100] ?? 0) ^ 0xff;
    await w.backups.putObject(k, b);
    record(
      "★ یک بیتِ چرخانده با اندازه‌ی برابر ⇒ **فقط** `integrity` قرمز (اندازه کافی نیست)",
      await run(w),
      ["integrity"],
    );
  }

  // ۳) بریده
  {
    const w = await world();
    const k = mirrorKeyOf(BUCKET, "misc/not-a-snapshot.bin");
    const b = (await w.backups.getObject(k))!;
    await w.backups.putObject(k, b.slice(0, 1000));
    // ★ انتظارِ اولیه «size و integrity» بود؛ واقعی فقط `size` است — putِ طولِ ناهم‌خوان همان‌جا رد می‌شود
    //   و sha اصلاً محاسبه نمی‌شود. دقیق‌تر از انتظار، نه ضعیف‌تر.
    record("شیءِ آینه بریده ⇒ **فقط** `size` قرمز", await run(w), ["size"]);
  }

  // ۴) ورودیِ مانیفست بی‌شیء
  {
    const w = await world();
    await w.backups.deleteObject(mirrorKeyOf(BUCKET, "misc/not-a-snapshot.bin"));
    record("ورودیِ مانیفست بدونِ شیء در آینه ⇒ **فقط** `count` قرمز", await run(w), ["count"]);
  }

  // ۵) ★ ردیفِ DB با کلیدی که مانیفست ندارد (پنجره‌ی compactor)
  {
    const w = await world();
    const ghost = realSnapshot("board-c");
    w.snapshots.push({
      storageKey: "board-c/000000000030.ybin",
      byteSize: ghost.bytes.byteLength,
      stateVector: ghost.stateVector,
    });
    record(
      "★ ردیفِ board_snapshots با کلیدی که آینه ندیده ⇒ `catalog` قرمز (و `opens` که به آن تکیه دارد)",
      await run(w),
      ["catalog", "opens"],
    );
  }

  // ۶) ★ sha درست ولی Y.Doc خراب — آینه «درست» کپی کرده، سند بی‌ارزش است
  {
    const w = await world();
    const k = "board-a/000000000010.ybin";
    const garbage = new Uint8Array(w.bytes[k]!.byteLength).map((_, i) => (i * 13 + 5) & 0xff);
    await w.backups.putObject(mirrorKeyOf(BUCKET, k), garbage);
    const entry = w.manifest.buckets[BUCKET]!.find((e) => e.key === k)!;
    entry.sha256 = sha(garbage); // مانیفست هم همین زباله را «درست» می‌داند
    record(
      "★ بایت‌های آینه با shaی درست ولی Y.Docِ نامعتبر ⇒ **فقط** `opens` قرمز (integrity سبز و بی‌فایده)",
      await run(w),
      ["opens"],
    );
  }

  // ۷) دامنه‌ی خالی
  {
    const w = await world();
    record("دامنه‌ای که هیچ ورودی ندارد ⇒ `vacuous` قرمز", await run(w, "nobody/"), ["vacuous"]);
  }

  console.log("── خودآزمونِ بازیابیِ Object Storage ──");
  for (const r of results) console.log(`${r.ok ? "✔" : "✖"} ${r.name}\n    ${r.detail}`);
  const reds = results.filter((r) => !r.ok);
  if (reds.length > 0) {
    console.error(`\n✖ خودآزمون شکست: ${String(reds.length)} سناریو — این گیت قابلِ اتکا نیست.`);
    process.exit(1);
  }
  console.log("\n✔ هر شکستنِ عمدی را چکِ **درست** گرفت، و آینه‌ی سالم سبز مانْد.");
}
