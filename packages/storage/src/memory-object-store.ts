import { Readable } from "node:stream";

import type {
  ObjectHead,
  ObjectStore,
  PresignUploadOptions,
  PresignedUpload,
} from "./object-store.ts";

/**
 * `ObjectStore`ِ حافظه‌ای — برای تستِ **مصرف‌کننده‌ها** (مثلِ `StorageSnapshotStore`)، نه ادعای دوام.
 * همتای `MemorySnapshotStore`/`MemoryUpdateLog`ِ M2.
 *
 * ⚠️ `presignGet`/`presignUpload` عمداً **throw** می‌کنند: URLِ امضاشده در حافظه بی‌معناست، و یک
 * رشته‌ی ساختگی برگرداندن یعنی تستی که به یک URLِ کارنکن اعتماد کند. مصرف‌کننده‌هایی که فقط
 * `put`/`get`/`delete` می‌خواهند (مثلِ snapshot) با این کار می‌کنند.
 */
export function createMemoryObjectStore(): ObjectStore {
  const objects = new Map<
    string,
    { bytes: Uint8Array; contentType: string | undefined; lastModified: Date }
  >();

  return {
    putObject(key, body, opts) {
      objects.set(key, {
        bytes: body.slice(),
        contentType: opts?.contentType,
        lastModified: new Date(),
      });
      return Promise.resolve();
    },

    getObject(key) {
      const found = objects.get(key);
      return Promise.resolve(found ? found.bytes.slice() : null);
    },

    deleteObject(key) {
      objects.delete(key);
      return Promise.resolve();
    },

    headObject(key) {
      const found = objects.get(key);
      if (!found) return Promise.resolve(null);
      const head: ObjectHead = {
        size: found.bytes.byteLength,
        contentType: found.contentType,
        etag: undefined,
        lastModified: found.lastModified,
      };
      return Promise.resolve(head);
    },

    listPrefix(prefix) {
      return Promise.resolve([...objects.keys()].filter((k) => k.startsWith(prefix)).sort());
    },

    presignGet() {
      return Promise.reject(
        new Error(
          "createMemoryObjectStore: presignGet پشتیبانی نمی‌شود — انبارِ حافظه‌ای URLِ واقعی ندارد",
        ),
      );
    },

    presignUpload(_opts: PresignUploadOptions): Promise<PresignedUpload> {
      return Promise.reject(
        new Error(
          "createMemoryObjectStore: presignUpload پشتیبانی نمی‌شود — انبارِ حافظه‌ای URLِ واقعی ندارد",
        ),
      );
    },

    // ── M6 / ADR-069 ─────────────────────────────────────────────────────
    getObjectStream(key) {
      const found = objects.get(key);
      return Promise.resolve(found ? Readable.from([Buffer.from(found.bytes.slice())]) : null);
    },

    async putObjectStream(key, body, opts) {
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of body) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        chunks.push(buf);
        total += buf.byteLength;
      }
      // ★ S3 با طولِ ناهم‌خوان خطا می‌دهد؛ بدلِ حافظه‌ای هم باید — وگرنه تستی که طولِ غلط
      //   می‌دهد سبز می‌مانَد و روی انبارِ واقعی می‌شکند.
      if (total !== opts.contentLength) {
        throw new Error(
          `createMemoryObjectStore: contentLength=${String(opts.contentLength)} ولی ${String(total)} بایت رسید`,
        );
      }
      objects.set(key, {
        bytes: new Uint8Array(Buffer.concat(chunks)),
        contentType: opts.contentType,
        lastModified: new Date(),
      });
    },

    async *iteratePrefix(prefix) {
      // ★ عمداً روی یک snapshotِ مرتب‌شده — همان ترتیبِ `listPrefix`، تا خودآزمون‌ها قطعی بمانند.
      for (const key of [...objects.keys()].filter((k) => k.startsWith(prefix)).sort()) yield key;
    },
  };
}
