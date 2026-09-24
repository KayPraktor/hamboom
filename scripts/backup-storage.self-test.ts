/**
 * ★ خودآزمونِ آینه‌ی Object Storage — M6 فاز ۲٫۲. بدونِ MinIO؛ روی انبارِ حافظه‌ای.
 *
 * پنج سناریو، و هر کدام یک ادعای مشخصِ [`mirrorBucket`](backup-run.ts):
 *   ۱. کپیِ کامل: بایت‌های آینه = مبدأ، و `sha256`ِ مانیفست = hashِ واقعیِ بایت‌ها.
 *   ۲. اجرای دوم با مانیفستِ قبلی ⇒ همه skip، sha از قبل حمل می‌شود.
 *   ۳. یک شیءِ آینه پاک شود ⇒ فقط همان دوباره کپی می‌شود.
 *   ۴. ★ مانیفستِ **قدیمی** (`{key,size}`ِ M5، بی‌sha) ⇒ هیچ skipی؛ همه دوباره hash می‌شوند.
 *   ۵. ★ هم‌اندازه ولی shaی مانیفستِ قبلی از اندازه‌ی **دیگری** بود ⇒ skip نه.
 *
 * ⚠️ چیزی که این خودآزمون **ادعا نمی‌کند:** خرابیِ درجای شیءِ آینه (هم‌اندازه، بایتِ متفاوت) —
 * آینه بایت‌های مقصد را دوباره نمی‌خوانَد؛ آن چکِ `integrity`ِ `restore-storage` است.
 */
import { createMemoryObjectStore } from "@hamboom/storage";

import { mirrorBucket, mirrorKeyOf, sha256Hex, type MirrorEntry } from "./backup-run.ts";

interface Result {
  name: string;
  ok: boolean;
  detail: string;
}

async function seedSource(): Promise<{
  source: ReturnType<typeof createMemoryObjectStore>;
  bytes: Record<string, Uint8Array>;
}> {
  const source = createMemoryObjectStore();
  const bytes: Record<string, Uint8Array> = {
    "a/1.ybin": new Uint8Array([1, 2, 3, 4, 5]),
    "a/2.ybin": new Uint8Array(70_000).map((_, i) => i & 0xff),
    "b/3.png": new Uint8Array([9, 9, 9]),
  };
  for (const [k, v] of Object.entries(bytes)) await source.putObject(k, v);
  return { source, bytes };
}

export async function runSelfTest(): Promise<void> {
  const results: Result[] = [];
  const record = (name: string, ok: boolean, detail: string): void => {
    results.push({ name, ok, detail });
  };
  const BUCKET = "snapshots-fake";

  // ── ۱: کپیِ کامل + sha ───────────────────────────────────────────────
  const { source, bytes } = await seedSource();
  const target = createMemoryObjectStore();
  const first = await mirrorBucket(source, target, BUCKET, false);
  {
    let allSame = true;
    let allSha = true;
    for (const [k, v] of Object.entries(bytes)) {
      const got = await target.getObject(mirrorKeyOf(BUCKET, k));
      allSame &&= got !== null && Buffer.compare(Buffer.from(got), Buffer.from(v)) === 0;
      const entry = first.entries.find((e) => e.key === k);
      allSha &&= entry?.sha256 === sha256Hex(v) && entry.size === v.byteLength;
    }
    const ok =
      first.copied === 3 && first.skipped === 0 && first.failed.length === 0 && allSame && allSha;
    record(
      "★ کپیِ کامل: بایت‌های آینه = مبدأ، و sha256ِ مانیفست = hashِ واقعیِ بایت‌ها",
      ok,
      ok
        ? "۳ کپی · ۰ skip · هر سه sha درست"
        : `copied=${String(first.copied)} skipped=${String(first.skipped)} failed=${String(first.failed.length)} bytes=${String(allSame)} sha=${String(allSha)}`,
    );
  }
  const previous = new Map(first.entries.map((e) => [e.key, e]));

  // ── ۲: اجرای دوم ⇒ همه skip، sha حمل می‌شود ───────────────────────────
  {
    const second = await mirrorBucket(source, target, BUCKET, false, previous);
    const shaCarried = second.entries.every((e) => e.sha256 === previous.get(e.key)?.sha256);
    const ok = second.copied === 0 && second.skipped === 3 && shaCarried;
    record(
      "اجرای دوم با مانیفستِ قبلی ⇒ ۳ skip، sha از مانیفستِ قبلی حمل می‌شود",
      ok,
      ok
        ? "هیچ بایتی دوباره رد نشد"
        : `copied=${String(second.copied)} skipped=${String(second.skipped)} sha=${String(shaCarried)}`,
    );
  }

  // ── ۳: یک شیءِ آینه گم شود ⇒ فقط همان دوباره کپی ─────────────────────
  {
    await target.deleteObject(mirrorKeyOf(BUCKET, "a/2.ybin"));
    const third = await mirrorBucket(source, target, BUCKET, false, previous);
    const restored = await target.getObject(mirrorKeyOf(BUCKET, "a/2.ybin"));
    const ok =
      third.copied === 1 &&
      third.skipped === 2 &&
      restored !== null &&
      restored.byteLength === 70_000 &&
      third.entries.find((e) => e.key === "a/2.ybin")?.sha256 === sha256Hex(bytes["a/2.ybin"]!);
    record(
      "★ شیءِ گم‌شده‌ی آینه ⇒ فقط همان یکی دوباره کپی و hash می‌شود",
      ok,
      ok
        ? "۱ کپی (a/2.ybin) · ۲ skip"
        : `copied=${String(third.copied)} skipped=${String(third.skipped)}`,
    );
  }

  // ── ۴: مانیفستِ قدیمی (بی‌sha) ⇒ هیچ skipی ─────────────────────────────
  {
    const legacy = new Map<string, MirrorEntry>(
      Object.entries(bytes).map(([k, v]) => [k, { key: k, size: v.byteLength }]),
    );
    const fourth = await mirrorBucket(source, target, BUCKET, false, legacy);
    const ok =
      fourth.copied === 3 &&
      fourth.skipped === 0 &&
      fourth.entries.every((e) => e.sha256 !== undefined);
    record(
      "★ مانیفستِ قدیمیِ M5 (`{key,size}`) ⇒ «نمی‌دانم» ⇒ همه دوباره hash می‌شوند، هیچ skipی",
      ok,
      ok
        ? "۳ کپی، هر سه با sha"
        : `copied=${String(fourth.copied)} skipped=${String(fourth.skipped)}`,
    );
  }

  // ── ۵: shaی شناخته ولی برای اندازه‌ی دیگر ⇒ skip نه ─────────────────
  {
    const stale = new Map<string, MirrorEntry>(
      first.entries.map((e) => [e.key, { ...e, size: e.size + 1 }]),
    );
    const fifth = await mirrorBucket(source, target, BUCKET, false, stale);
    const ok = fifth.copied === 3 && fifth.skipped === 0;
    record(
      "shaی مانیفستِ قبلی برای اندازه‌ی دیگری بود ⇒ skip نمی‌شود",
      ok,
      ok ? "۳ کپی" : `copied=${String(fifth.copied)} skipped=${String(fifth.skipped)}`,
    );
  }

  console.log("── خودآزمونِ آینه‌ی Object Storage ──");
  for (const r of results) console.log(`${r.ok ? "✔" : "✖"} ${r.name}\n    ${r.detail}`);
  const reds = results.filter((r) => !r.ok);
  if (reds.length > 0) {
    console.error(`\n✖ ${String(reds.length)} سناریو شکست — این آینه قابلِ اتکا نیست.`);
    process.exit(1);
  }
  console.log(
    "\n✔ آینه بایت‌به‌بایت است، sha می‌نویسد، و فقط چیزی را skip می‌کند که واقعاً می‌شناسد.",
  );
}
