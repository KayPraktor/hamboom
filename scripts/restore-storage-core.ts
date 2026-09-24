/**
 * منطقِ **خالصِ** بازیابیِ Object Storage — M6 فاز ۲٫۳. بدونِ هیچ اثرِ جانبیِ خودش.
 *
 * ⚠️ فایلِ جدا به همان دلیلِ `sweep-orphans-core`: [`restore-storage.ts`](restore-storage.ts)
 * ورودیِ اجرایی است و `await main()` دارد؛ خودآزمون و آینده‌ی گیت‌ها این را import می‌کنند.
 *
 * ── شش چک، هر کدام با idِ ثابت ───────────────────────────────────────────
 *
 * | id | ادعا | چه چیزی را می‌گیرد |
 * |---|---|---|
 * | `count` | هر ورودیِ مانیفست (در دامنه‌ی انتخاب‌شده) بعد از بازیابی در مقصد هست | شیءِ گم‌شده‌ی آینه |
 * | `size` | اندازه‌ی سمتِ مقصد = مانیفست | آینه‌ی بریده/دیسکِ پرشده |
 * | `integrity` | sha256ِ بایت‌های بازیابی‌شده = مانیفست | ★ خرابیِ **هم‌اندازه** — تنها چکی که می‌گیردش |
 * | `catalog` | هر `board_snapshots.storage_key`ِ دیتابیس در مقصد بایت دارد | ★ کلیدی که dump می‌شناسد و آینه ندیده (پنجره‌ی compactor) |
 * | `opens` | بایت‌های هر snapshotِ کاتالوگ‌شده یک Y.Docِ معتبر با همان `state_vector`ِ ردیف می‌سازند | همان بازخوانی‌ای که compactor بعد از put می‌کند |
 * | `vacuous` | دامنه‌ی انتخاب‌شده دستِ‌کم یک شیء دارد | بازیابیِ «هیچ» که سبزِ دروغین می‌شد |
 *
 * ⚠️ ورودیِ مانیفستِ **قدیمیِ** M5 (بی‌sha) نمی‌تواند `integrity` را پاس کند — «نمی‌دانم» قرمز
 * است، نه سبز (همان قاعده‌ی ADR-056 روی ابهام). یک `backup-all`ِ تازه رفعش می‌کند.
 */
import { createHash } from "node:crypto";
import { Transform } from "node:stream";

import type { ObjectStore } from "@hamboom/storage";
import * as Y from "yjs";

import { mirrorKeyOf, type MirrorEntry, type StorageManifest } from "./backup-run.ts";

export type StorageCheckId = "count" | "size" | "integrity" | "catalog" | "opens" | "vacuous";

export interface StorageCheck {
  id: StorageCheckId;
  name: string;
  ok: boolean;
  detail: string;
}

/** یک ردیفِ `board_snapshots` — آنچه چک‌های `catalog`/`opens` لازم دارند. */
export interface SnapshotRow {
  storageKey: string;
  byteSize: number;
  /** `state_vector`ِ ردیف — همان چیزی که compactor بعد از put با بازخوانی مقایسه کرد. */
  stateVector: Uint8Array;
}

export interface RestoreScope {
  /** نامِ باکتِ مبدأ (همان نامِ لحظه‌ی گرفتن، کلیدِ `manifest.buckets`). */
  bucket: string;
  /** فقط کلیدهایی که با این شروع می‌شوند (مثلاً `<boardId>/`)؛ خالی = همه. */
  prefix: string;
}

export interface RestoreInput {
  /** باکتِ پشتیبان (آینه + مانیفست‌ها). */
  backups: ObjectStore;
  /** مقصدِ بازیابی — یک store مقید به باکتِ drill یا (با `--to-live`) باکتِ زنده. */
  target: ObjectStore;
  manifest: StorageManifest;
  scope: RestoreScope;
  /** ردیف‌های `board_snapshots` برای چک‌های `catalog`/`opens` — `null` = این باکت snapshot نیست (assets). */
  snapshots: SnapshotRow[] | null;
  /** `true` = فقط چک‌ها، بدونِ کپی (مقصد از قبل پر شده). */
  verifyOnly?: boolean;
}

function hashingTap(): { tap: Transform; digest: () => string } {
  const hash = createHash("sha256");
  const tap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  return { tap, digest: () => hash.digest("hex") };
}

async function sha256OfStream(
  body: NodeJS.ReadableStream,
): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of body) {
    const buf = chunk as Buffer;
    hash.update(buf);
    bytes += buf.byteLength;
  }
  return { sha256: hash.digest("hex"), bytes };
}

async function readAll(body: NodeJS.ReadableStream): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(chunk as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}

/** ورودی‌های مانیفست در دامنه‌ی انتخاب‌شده. */
export function selectEntries(manifest: StorageManifest, scope: RestoreScope): MirrorEntry[] {
  return (manifest.buckets[scope.bucket] ?? []).filter((e) => e.key.startsWith(scope.prefix));
}

/**
 * بازیابی + شش چک. هیچ چکی زودتر `return` نمی‌کند (همه گزارش می‌شوند).
 *
 * ★ کپی استریمی است و sha **حینِ همان عبور** گرفته می‌شود؛ بعد اندازه‌ی مقصد با `headObject`
 * خوانده می‌شود. برای `--verify-only` بایت‌ها از مقصد خوانده و hash می‌شوند.
 */
export async function restoreAndVerify(input: RestoreInput): Promise<StorageCheck[]> {
  const { backups, target, manifest, scope } = input;
  const checks: StorageCheck[] = [];
  const add = (id: StorageCheckId, name: string, ok: boolean, detail: string): void => {
    checks.push({ id, name, ok, detail });
  };
  const entries = selectEntries(manifest, scope);

  // ── vacuous ───────────────────────────────────────────────────────────
  add(
    "vacuous",
    "دامنه‌ی بازیابی دستِ‌کم یک شیء دارد (بازیابیِ «هیچ» چیزی را اثبات نمی‌کند)",
    entries.length > 0,
    entries.length > 0
      ? `${String(entries.length)} ورودی برای «${scope.bucket}»${scope.prefix === "" ? "" : ` زیرِ ${scope.prefix}`}`
      : `مانیفست برای «${scope.bucket}»${scope.prefix === "" ? "" : ` زیرِ ${scope.prefix}`} هیچ ورودی‌ای ندارد`,
  );

  // ── کپی (یا فقط خواندن) + size + integrity ────────────────────────────
  const missing: string[] = [];
  const sizeMismatch: string[] = [];
  const shaMismatch: string[] = [];
  const shaUnknown: string[] = [];

  for (const entry of entries) {
    const mirrorKey = mirrorKeyOf(scope.bucket, entry.key);
    let actualSha: string | undefined;
    let actualSize: number | undefined;

    if (input.verifyOnly) {
      const body = await target.getObjectStream(entry.key);
      if (body === null) {
        missing.push(entry.key);
        continue;
      }
      const r = await sha256OfStream(body);
      actualSha = r.sha256;
      actualSize = r.bytes;
    } else {
      const body = await backups.getObjectStream(mirrorKey);
      if (body === null) {
        missing.push(entry.key);
        continue;
      }
      const { tap, digest } = hashingTap();
      body.once("error", (e) => tap.destroy(e));
      try {
        await target.putObjectStream(entry.key, body.pipe(tap), {
          contentLength: entry.size,
          contentType: "application/octet-stream",
        });
      } catch (e) {
        // طولِ ناهم‌خوان (آینه‌ی بریده) همین‌جا رد می‌شود — به‌عنوانِ ناهم‌خوانیِ اندازه ثبت می‌شود.
        sizeMismatch.push(
          `${entry.key}: ${e instanceof Error ? e.message.slice(0, 80) : String(e)}`,
        );
        continue;
      }
      actualSha = digest();
      actualSize = (await target.headObject(entry.key))?.size;
    }

    if (actualSize !== entry.size) {
      sizeMismatch.push(`${entry.key}: ${String(actualSize)} ≠ ${String(entry.size)}`);
    }
    if (entry.sha256 === undefined) shaUnknown.push(entry.key);
    else if (actualSha !== entry.sha256) shaMismatch.push(entry.key);
  }

  add(
    "count",
    "هر ورودیِ مانیفست بعد از بازیابی در مقصد هست",
    missing.length === 0,
    missing.length === 0
      ? `${String(entries.length - missing.length)} شیء`
      : `${String(missing.length)} شیء در آینه نیست: ${missing.slice(0, 3).join("، ")}`,
  );
  add(
    "size",
    "اندازه‌ی هر شیء در مقصد = مانیفست",
    sizeMismatch.length === 0,
    sizeMismatch.length === 0
      ? "همه هم‌اندازه"
      : `${String(sizeMismatch.length)} ناهم‌خوانی: ${sizeMismatch.slice(0, 3).join(" · ")}`,
  );
  add(
    "integrity",
    "★ sha256ِ بایت‌های بازیابی‌شده = مانیفست (خرابیِ هم‌اندازه فقط این‌جا دیده می‌شود)",
    shaMismatch.length === 0 && shaUnknown.length === 0,
    shaMismatch.length === 0 && shaUnknown.length === 0
      ? "همه هم‌hash"
      : shaUnknown.length > 0
        ? `${String(shaUnknown.length)} ورودی sha ندارد (مانیفستِ قدیمیِ M5) — «نمی‌دانم» سبز نیست؛ یک backup-all تازه بگیر`
        : `${String(shaMismatch.length)} شیء با hashِ متفاوت: ${shaMismatch.slice(0, 3).join("، ")}`,
  );

  // ── catalog + opens (فقط باکتِ snapshots) ─────────────────────────────
  if (input.snapshots === null) {
    add("catalog", "کاتالوگ — این باکت snapshot نیست", true, "بدونِ ردیفِ مرجع (assets)");
    add("opens", "بازخوانیِ Y.Doc — این باکت snapshot نیست", true, "بدونِ ردیفِ مرجع (assets)");
  } else {
    const inScope = input.snapshots.filter((r) => r.storageKey.startsWith(scope.prefix));
    const noBytes: string[] = [];
    const badDoc: string[] = [];
    for (const row of inScope) {
      const body = await target.getObjectStream(row.storageKey);
      if (body === null) {
        noBytes.push(row.storageKey);
        continue;
      }
      const bytes = await readAll(body);
      try {
        const doc = new Y.Doc();
        Y.applyUpdate(doc, bytes);
        const sv = Y.encodeStateVector(doc);
        if (Buffer.compare(Buffer.from(sv), Buffer.from(row.stateVector)) !== 0) {
          badDoc.push(`${row.storageKey} (state vector ≠ ردیف)`);
        }
        doc.destroy();
      } catch (e) {
        badDoc.push(
          `${row.storageKey} (${e instanceof Error ? e.message.slice(0, 60) : String(e)})`,
        );
      }
    }
    add(
      "catalog",
      "★ هر snapshotی که دیتابیس می‌شناسد، در مقصد بایت دارد",
      noBytes.length === 0,
      noBytes.length === 0
        ? `${String(inScope.length)} ردیف، همه با بایت`
        : `${String(noBytes.length)} ردیف بی‌بایت: ${noBytes.slice(0, 3).join("، ")} — کلیدی که dump می‌شناسد و آینه ندیده`,
    );
    add(
      "opens",
      "★ بایت‌های هر snapshot یک Y.Docِ معتبر با همان state vectorِ ردیف می‌سازند",
      badDoc.length === 0 && noBytes.length === 0,
      badDoc.length === 0 && noBytes.length === 0
        ? `${String(inScope.length)} سند بازخوانی شد`
        : badDoc.length === 0
          ? "به‌خاطرِ ردیف‌های بی‌بایت سنجیده نشد"
          : `${String(badDoc.length)} سندِ خراب: ${badDoc.slice(0, 3).join(" · ")}`,
    );
  }

  return checks;
}
