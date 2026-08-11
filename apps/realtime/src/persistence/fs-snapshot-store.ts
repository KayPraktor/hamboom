import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, open, readFile, rename, rm, unlink } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import type { SnapshotStore } from "./snapshot-store.ts";

/**
 * `FsSnapshotStore` — پیاده‌سازیِ فایل‌سیستمیِ **D-3**.
 *
 * جای Object Storage را می‌گیرد تا اصلِ **P3** برقرار بمانَد: `docker compose up
 * && pnpm dev` باید کافی باشد و هیچ feature ای نباید برای توسعه به حسابِ ابریِ
 * واقعی نیاز داشته باشد. با آمدنِ `packages/storage` در M3 جایش را می‌دهد —
 * بدونِ هیچ تغییری در `compactor.ts`، چون هر دو همان interface اند.
 *
 * ── ★★ چرا نوشتن دو مرحله‌ای است ───────────────────────────────────────
 *
 * `writeFile` **اتمیک نیست**: اگر وسطش برق برود، یک فایلِ نصفه روی دیسک می‌مانَد
 * که هم وجود دارد و هم خراب است. و درست بعدِ همین نوشتن، `prune` updateهای
 * واقعی را **حذف** می‌کند — یعنی گران‌ترین لحظه برای یک فایلِ نصفه.
 *
 * پس: نوشتن در فایلِ موقت → `fsync` → `rename` (اتمیک در POSIX و NTFS).
 * ⚠️ **`fsync`ِ خودِ دایرکتوری اینجا نیست** — روی ویندوز قابلِ حمل نیست. یعنی در
 * برقِ‌رفتنِ ناگهانی، *ورودیِ دایرکتوری* ممکن است هنوز روی دیسک نباشد. سدِ واقعیِ
 * ما در برابرِ این، ترتیبِ `compactor.ts` است: تا وقتی رکوردِ کاتالوگ ننشسته
 * باشد، هیچ updateای حذف نمی‌شود — و بدونِ رکورد، آن فایل اصلاً خوانده نمی‌شود.
 */

export interface FsSnapshotStoreOptions {
  /** ریشه‌ی نگهداری — `RT_SNAPSHOT_DIR`. */
  directory: string;
}

export function createFsSnapshotStore({ directory }: FsSnapshotStoreOptions): SnapshotStore {
  const root = resolve(directory);

  /**
   * ★ کلید از بیرون می‌آید (`boardId` در آن است)، پس **مسیر باید مهار شود**.
   *
   * ⚠️ `boardId` از توکن می‌آید و امروز uuid است، ولی این انبار آن را نمی‌داند و
   * نباید بداند. یک کلیدِ `../../..` بدونِ این بررسی هر جای دیسک می‌نوشت. مهار
   * جای خودش است: **اینجا**، جایی که مسیر ساخته می‌شود.
   */
  function pathFor(key: string): string {
    const full = resolve(root, key);
    const rel = relative(root, full);
    if (rel === "" || rel.startsWith("..") || rel.startsWith(`..${sep}`)) {
      throw new Error(`[hamboom] کلیدِ snapshot از ریشه بیرون می‌زند: ${key}`);
    }
    return full;
  }

  return {
    async put(key, bytes) {
      const target = pathFor(key);
      await mkdir(dirname(target), { recursive: true });

      // نامِ موقت از خودِ کلید مشتق می‌شود تا دو نوشتنِ همزمانِ دو بورد به هم نخورند.
      const scratch = `${target}.${createHash("sha1").update(key).digest("hex").slice(0, 8)}.tmp`;
      const handle = await open(scratch, "w");
      try {
        await handle.writeFile(bytes);
        // ★ بدونِ این، «نوشتم» فقط یعنی «به کشِ صفحات دادم».
        await handle.sync();
      } finally {
        await handle.close();
      }

      try {
        await rename(scratch, target);
      } catch (cause) {
        await rm(scratch, { force: true });
        throw cause;
      }
    },

    async get(key) {
      const target = pathFor(key);
      try {
        await access(target, constants.R_OK);
      } catch {
        return null;
      }
      return new Uint8Array(await readFile(target));
    },

    async delete(key) {
      try {
        await unlink(pathFor(key));
      } catch {
        // نبودنش خطا نیست — زباله‌روبی باید idempotent باشد.
      }
    },
  };
}

/** مسیرِ پیش‌فرضِ توسعه — کنارِ ریپو، نه در `/tmp` که با ری‌بوت پاک می‌شود. */
export const DEFAULT_SNAPSHOT_DIR = join(".hamboom", "snapshots");
