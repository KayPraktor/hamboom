import type { CanvasInbound, CanvasPermissions, ConnectionState } from "@hamboom/canvas-core/sync";
import {
  boardRoots,
  createBoardDoc,
  encodeMessage,
  HB_ERROR_CODES,
  META_KEYS,
  MSG_TYPES,
  SCHEMA_VERSION,
} from "@hamboom/ydoc-schema";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { describe, expect, it, vi } from "vitest";

import { YjsSyncAdapter } from "./adapter.ts";
import { permissionsForRole, READ_ONLY_PERMISSIONS, WRITER_ROLES } from "./permissions.ts";
import type { SyncTransport, TransportStatus } from "./transport.ts";

/**
 * تست‌های گام ۵٫۳ — **تغییرِ نقش وسطِ session و نسخه‌ی ناسازگار**.
 *
 * ⚠️ هر دو مسیر تا این گام **بی‌صدا دور ریخته می‌شدند**: `handleMessage` نه
 * شاخه‌ای برای `HB_PERMISSION` داشت و نه برای `HB_ERROR`. پس اولین ادعا این است
 * که اصلاً *اتفاقی* می‌افتد.
 */

function fakeCanvas() {
  const permissions: CanvasPermissions[] = [];
  const connectionStates: ConnectionState[] = [];
  const inbound: CanvasInbound = {
    applyRemoteChanges: vi.fn(),
    applyPeers: vi.fn(),
    setConnectionState: (state) => connectionStates.push(state),
    setSaveState: vi.fn(),
    setPermissions: (next) => permissions.push(next),
    replaceDocument: vi.fn(),
    focusOn: vi.fn(),
  };
  return {
    inbound,
    permissions,
    connectionStates,
    lastPermissions: (): CanvasPermissions | undefined => permissions.at(-1),
    lastConnection: (): ConnectionState | undefined => connectionStates.at(-1),
  };
}

function fakeLink() {
  const sent: Uint8Array[] = [];
  let onMessage: ((message: Uint8Array) => void) | null = null;
  let onStatus: ((status: TransportStatus) => void) | null = null;
  const state = { disconnected: false };

  const transport: SyncTransport = {
    send: (message) => sent.push(message),
    onMessage: (handler) => {
      onMessage = handler;
      return () => {
        onMessage = null;
      };
    },
    onStatus: (handler) => {
      onStatus = handler;
      return () => {
        onStatus = null;
      };
    },
    connect: () => Promise.resolve(),
    disconnect: () => {
      state.disconnected = true;
      // ⚠️ **هر دو کانال** بسته می‌شوند، مثلِ ترابریِ واقعی. اولین نسخه فقط
      //    `onMessage` را پاک می‌کرد و همین باعث شد تست یک `connected`ِ
      //    غیرممکن ببیند.
      onMessage = null;
      onStatus = null;
    },
  };

  return {
    transport,
    sent,
    state,
    deliver: (message: Uint8Array): void => onMessage?.(message),
    emit: (status: TransportStatus): void => onStatus?.(status),
  };
}

async function connected(options: { supportedSchemaVersion?: number; doc?: Y.Doc } = {}) {
  const canvas = fakeCanvas();
  const link = fakeLink();
  const errors: { code: string; message: string }[] = [];
  const adapter = new YjsSyncAdapter({
    ...options,
    transport: link.transport,
    onProtocolError: (error) => errors.push(error),
  });
  await adapter.connect(canvas.inbound);
  link.emit({ phase: "open", resumed: false });
  return { canvas, link, adapter, errors };
}

const permission = (role: "owner" | "editor" | "commenter" | "viewer"): Uint8Array =>
  encodeMessage({ type: MSG_TYPES.HB_PERMISSION, role });

describe("نگاشتِ نقش به مجوز", () => {
  it("★ فهرستِ نویسنده‌ها همان `WRITERS`ِ سرور است", () => {
    // ⚠️ نگهبانِ واگرایی: `apps/realtime/src/permission.ts` قابلِ import نیست
    //    (قاعده‌ی مرزی)، پس تنها کاری که می‌شود کرد این است که فهرست را
    //    **صریح** بنویسیم تا هر تغییری اینجا دیده شود.
    expect([...WRITER_ROLES]).toEqual(["owner", "editor"]);
  });

  it("هر نقش همان چیزی را می‌تواند که باید", () => {
    expect(permissionsForRole("owner")).toEqual({
      canEdit: true,
      canComment: true,
      canExport: true,
      canManageAccess: true,
    });
    expect(permissionsForRole("editor")).toMatchObject({ canEdit: true, canManageAccess: false });
    expect(permissionsForRole("commenter")).toMatchObject({ canEdit: false, canComment: true });
    expect(permissionsForRole("viewer")).toMatchObject({ canEdit: false, canComment: false });
  });

  it("★ نقشِ ناشناخته هیچ‌کاری نمی‌تواند — جهتِ امن", () => {
    expect(permissionsForRole("superuser")).toEqual(READ_ONLY_PERMISSIONS);
  });

  it("خروجی‌گرفتن برای همه باز است — یک عملِ خواندنی", () => {
    for (const role of ["owner", "editor", "commenter", "viewer", "???"]) {
      expect(permissionsForRole(role).canExport).toBe(true);
    }
  });
});

describe("★★ تنزلِ نقش وسطِ کار — بدونِ رفرش", () => {
  it("`HB_PERMISSION{viewer}` بوم را فقط-خواندنی می‌کند", async () => {
    const { canvas, link } = await connected();

    link.deliver(permission("viewer"));

    expect(canvas.lastPermissions()).toMatchObject({ canEdit: false, canComment: false });
  });

  it("★★ و **اتصال بسته نمی‌شود** — تماشاگر حقِ دیدن دارد (ADR-038)", async () => {
    const { link } = await connected();

    link.deliver(permission("viewer"));

    expect(link.state.disconnected).toBe(false);
  });

  it("ارتقا هم کار می‌کند — مسیر یک‌طرفه نیست", async () => {
    const { canvas, link } = await connected();
    link.deliver(permission("viewer"));

    link.deliver(permission("editor"));

    expect(canvas.lastPermissions()).toMatchObject({ canEdit: true });
  });

  it("نقشِ تکراری دوباره گزارش نمی‌شود", async () => {
    const { canvas, link } = await connected();
    link.deliver(permission("viewer"));
    const count = canvas.permissions.length;

    link.deliver(permission("viewer"));

    expect(canvas.permissions).toHaveLength(count);
  });
});

describe("★★ `HB_ERROR`ِ غیرمرگبار بی‌صدا دور ریخته نمی‌شود", () => {
  it("ردِ نوشتنِ `viewer` به صداکننده می‌رسد و اتصال باز می‌مانَد", async () => {
    const { link, errors } = await connected();

    // ★ همان دو پیامی که سرور در `denyWrite` پشتِ سر هم می‌فرستد (گام ۴٫۵).
    link.deliver(permission("viewer"));
    link.deliver(
      encodeMessage({
        type: MSG_TYPES.HB_ERROR,
        code: HB_ERROR_CODES.FORBIDDEN,
        message: "با نقشِ فعلی اجازه‌ی ویرایشِ این بورد را ندارید.",
      }),
    );

    expect(errors).toEqual([
      {
        code: HB_ERROR_CODES.FORBIDDEN,
        message: "با نقشِ فعلی اجازه‌ی ویرایشِ این بورد را ندارید.",
      },
    ]);
    expect(link.state.disconnected).toBe(false);
  });
});

describe("★★ نسخه‌ی ناسازگار — پیامِ فارسی، نه crash", () => {
  /** سندی که یک بیلدِ جدیدتر ساخته است. */
  function futureDoc(): Y.Doc {
    const doc = createBoardDoc();
    doc.transact(() => {
      boardRoots(doc).meta.set(META_KEYS.schemaVersion, SCHEMA_VERSION + 1);
    });
    return doc;
  }

  it("سندِ جلوتر از ما → `ConnectionState.error` با پیامِ فارسی", async () => {
    const { canvas } = await connected({ doc: futureDoc() });

    const state = canvas.lastConnection();
    expect(state).toMatchObject({ status: "error", code: HB_ERROR_CODES.CLIENT_TOO_OLD });
    if (state?.status === "error") {
      expect(state.message).toContain("صفحه را تازه کنید");
    }
  });

  it("★★ و **نوشتن قطع می‌شود** — وگرنه ساختاری را که نمی‌فهمیم خراب می‌کنیم", async () => {
    const { link, canvas } = await connected({ doc: futureDoc() });

    expect(link.state.disconnected).toBe(true);
    expect(canvas.lastPermissions()).toEqual(READ_ONLY_PERMISSIONS);
  });

  it("سندِ **عقب‌تر** یا هم‌نسخه مشکلی نیست", async () => {
    const older = createBoardDoc();
    older.transact(() => {
      boardRoots(older).meta.set(META_KEYS.schemaVersion, SCHEMA_VERSION);
    });

    const { canvas, link } = await connected({ doc: older });

    expect(canvas.lastConnection()).toMatchObject({ status: "connected" });
    expect(link.state.disconnected).toBe(false);
  });

  it("★ کلاینتی که عمداً محافظه‌کار اعلام کرده هم رد می‌شود", async () => {
    const { canvas } = await connected({ supportedSchemaVersion: 0 });

    expect(canvas.lastConnection()).toMatchObject({ status: "error" });
  });

  it("★★ سندی که **از راهِ sync** می‌رسد و جلوتر است هم گرفته می‌شود", async () => {
    // ⚠️ این مسیر با تستِ بالا فرق دارد و مهم‌تر است: آنجا سند از همان اول
    //    جلوتر بود؛ اینجا کلاینت **سالم وصل می‌شود** و بعد نسخه‌ی جدیدتر روی
    //    سیم می‌رسد — چیزی که در تولید وقتی رخ می‌دهد که کلاینتِ دیگری بورد را
    //    migrate کرده باشد.
    //
    // ★ سندِ ما عمداً مهرِ نسخه ندارد (`new Y.Doc()`)، وگرنه دو نوشتن روی یک
    //   کلید LWW می‌شد و برنده‌اش به `clientID` بستگی داشت — یک تستِ شانسی.
    const { canvas, link } = await connected({ doc: new Y.Doc() });
    expect(canvas.lastConnection()).toMatchObject({ status: "connected" });

    const encoder = encoding.createEncoder();
    syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(futureDoc()));
    link.deliver(encodeMessage({ type: MSG_TYPES.SYNC, payload: encoding.toUint8Array(encoder) }));

    expect(canvas.lastConnection()).toMatchObject({
      status: "error",
      code: HB_ERROR_CODES.CLIENT_TOO_OLD,
    });
    expect(link.state.disconnected).toBe(true);
  });

  it("`HB_ERROR{CLIENT_TOO_OLD}`ِ سرور همان مسیر را می‌رود", async () => {
    const { canvas, link, errors } = await connected();

    link.deliver(
      encodeMessage({
        type: MSG_TYPES.HB_ERROR,
        code: HB_ERROR_CODES.CLIENT_TOO_OLD,
        message: "سند جلوتر است.",
      }),
    );

    // ⚠️ **از `onProtocolError` رد نمی‌شود** — این یکی مرگبار است.
    expect(errors).toEqual([]);
    expect(canvas.lastConnection()).toMatchObject({
      status: "error",
      code: HB_ERROR_CODES.CLIENT_TOO_OLD,
    });
    expect(link.state.disconnected).toBe(true);
  });

  it("فقط یک‌بار — پیام‌های بعدی چیزی را دوباره اعلام نمی‌کنند", async () => {
    const { canvas, link } = await connected({ doc: futureDoc() });
    const count = canvas.connectionStates.length;

    link.deliver(
      encodeMessage({
        type: MSG_TYPES.HB_ERROR,
        code: HB_ERROR_CODES.CLIENT_TOO_OLD,
        message: "دوباره",
      }),
    );

    expect(canvas.connectionStates).toHaveLength(count);
  });
});
