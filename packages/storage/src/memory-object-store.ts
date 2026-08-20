import type { ObjectHead, ObjectStore, PresignUploadOptions, PresignedUpload } from "./object-store.ts";

/**
 * `ObjectStore`ِ حافظه‌ای — برای تستِ **مصرف‌کننده‌ها** (مثلِ `StorageSnapshotStore`)، نه ادعای دوام.
 * همتای `MemorySnapshotStore`/`MemoryUpdateLog`ِ M2.
 *
 * ⚠️ `presignGet`/`presignUpload` عمداً **throw** می‌کنند: URLِ امضاشده در حافظه بی‌معناست، و یک
 * رشته‌ی ساختگی برگرداندن یعنی تستی که به یک URLِ کارنکن اعتماد کند. مصرف‌کننده‌هایی که فقط
 * `put`/`get`/`delete` می‌خواهند (مثلِ snapshot) با این کار می‌کنند.
 */
export function createMemoryObjectStore(): ObjectStore {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string | undefined }>();

  return {
    putObject(key, body, opts) {
      objects.set(key, { bytes: body.slice(), contentType: opts?.contentType });
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
      };
      return Promise.resolve(head);
    },

    listPrefix(prefix) {
      return Promise.resolve([...objects.keys()].filter((k) => k.startsWith(prefix)).sort());
    },

    presignGet() {
      return Promise.reject(
        new Error("createMemoryObjectStore: presignGet پشتیبانی نمی‌شود — انبارِ حافظه‌ای URLِ واقعی ندارد"),
      );
    },

    presignUpload(_opts: PresignUploadOptions): Promise<PresignedUpload> {
      return Promise.reject(
        new Error("createMemoryObjectStore: presignUpload پشتیبانی نمی‌شود — انبارِ حافظه‌ای URLِ واقعی ندارد"),
      );
    },
  };
}
