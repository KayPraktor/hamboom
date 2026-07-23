import type { HbAppState, HbAsset, HbElement } from "@hamboom/shared-types";

import {
  assertEmittable,
  type CanvasDocument,
  type CanvasInbound,
  type CanvasOutbound,
  type CanvasSyncAdapter,
  type ElementChangeSet,
  type EphemeralPayload,
  type PeerState,
  type PointerState,
  type Viewport,
} from "./contract";

/**
 * پیاده‌سازی in-memory از `CanvasSyncAdapter` — بدون هیچ I/O.
 *
 * دو کار می‌کند:
 *
 * 1. **دمو و تست را ممکن می‌کند** بدون اینکه سروری لازم باشد.
 * 2. **مرجع پیاده‌سازی برای M2 است** — هر رفتاری که اینجا هست، آداپتور واقعی
 *    هم باید داشته باشد: تگ‌گذاری منشأ، نگهبان echo، وضعیت اتصال و ذخیره،
 *    ادغام awareness.
 *
 * آنچه اینجا **نیست** و کار M2 است: پایداری واقعی، حل تعارض CRDT، شبکه،
 * احراز هویت، و اعمال مجوز سمت سرور.
 */

const DEFAULT_APP_STATE: HbAppState = {
  viewBackgroundColor: "#ffffff",
  gridSize: 20,
  gridEnabled: false,
  snapToObjects: true,
  frameRendering: { enabled: true, name: true, outline: true, clip: true },
};

/**
 * ناحیه‌ی مشترک بین چند آداپتور — جای «سرور» را می‌گیرد.
 *
 * چند `LocalSyncAdapter` که به یک hub وصل شوند، تغییرات همدیگر را می‌بینند.
 * همین برای تست همکاری چندنفره کافی است.
 */
export class LocalSyncHub {
  private readonly elements = new Map<string, HbElement>();
  private readonly assets = new Map<string, HbAsset>();
  private appState: HbAppState = { ...DEFAULT_APP_STATE };
  private readonly members = new Set<LocalSyncAdapter>();
  private nextClientId = 1;

  /** وضعیت فعلی سند — برای بارگذاری اولیه و بازرسی در تست. */
  snapshot(): CanvasDocument {
    return {
      elements: [...this.elements.values()],
      assets: [...this.assets.values()],
      appState: { ...this.appState },
    };
  }

  join(adapter: LocalSyncAdapter): number {
    this.members.add(adapter);
    this.broadcastPeers();
    return this.nextClientId++;
  }

  leave(adapter: LocalSyncAdapter): void {
    this.members.delete(adapter);
    this.broadcastPeers();
  }

  /** اعمال تغییر روی سند مشترک و پخش به بقیه — نه به فرستنده. */
  publish(from: LocalSyncAdapter, changes: ElementChangeSet): void {
    for (const element of changes.upserted) this.elements.set(element.id, element);
    for (const id of changes.deleted) {
      const existing = this.elements.get(id);
      if (existing) this.elements.set(id, { ...existing, isDeleted: true });
    }
    for (const asset of changes.assets ?? []) this.assets.set(asset.fileId, asset);

    for (const member of this.members) {
      if (member === from) continue;
      // ★ منشأ عوض می‌شود. گیرنده نباید این را دوباره پخش کند —
      //   `assertEmittable` در `emitElementChanges` جلویش را می‌گیرد.
      member.receiveRemote({ ...changes, origin: "remote" });
    }
  }

  publishEphemeral(from: LocalSyncAdapter, payload: EphemeralPayload | null): void {
    for (const member of this.members) {
      if (member === from) continue;
      member.receiveEphemeral(from, payload);
    }
  }

  broadcastPeers(): void {
    for (const member of this.members) {
      member.receivePeers([...this.members].filter((m) => m !== member).map((m) => m.peerState()));
    }
  }
}

export interface LocalSyncAdapterOptions {
  hub?: LocalSyncHub;
  user?: { id: string; displayName: string; color: string; avatarUrl?: string | null };
  /** تاخیر مصنوعی پخش (ms) — برای شبیه‌سازی شبکه در تست. پیش‌فرض ۰. */
  latencyMs?: number;
}

export class LocalSyncAdapter implements CanvasSyncAdapter {
  private readonly hub: LocalSyncHub;
  private readonly latencyMs: number;
  private readonly user: {
    id: string;
    displayName: string;
    color: string;
    avatarUrl: string | null;
  };
  private inbound: CanvasInbound | null = null;
  private clientId = 0;
  private pointer: PointerState | null = null;
  private selectedIds: string[] = [];
  private viewport: Viewport | null = null;
  private activeTool: string | null = null;
  private ephemeral: EphemeralPayload | null = null;
  /** فایل‌های محلی — `URL.createObjectURL` جای Object Storage را می‌گیرد. */
  private readonly objectUrls = new Map<string, string>();

  constructor(options: LocalSyncAdapterOptions = {}) {
    this.hub = options.hub ?? new LocalSyncHub();
    this.latencyMs = options.latencyMs ?? 0;
    this.user = {
      id: options.user?.id ?? "u_local",
      displayName: options.user?.displayName ?? "کاربر محلی",
      color: options.user?.color ?? "#5B8DEF",
      avatarUrl: options.user?.avatarUrl ?? null,
    };
  }

  async connect(inbound: CanvasInbound): Promise<CanvasOutbound> {
    this.inbound = inbound;
    inbound.setConnectionState({ status: "connecting" });

    this.clientId = this.hub.join(this);
    inbound.replaceDocument(this.hub.snapshot());
    inbound.setPermissions({
      canEdit: true,
      canComment: true,
      canExport: true,
      canManageAccess: true,
    });
    inbound.setConnectionState({ status: "connected", peers: 0 });
    inbound.setSaveState({ status: "saved", at: Date.now() });

    return {
      emitElementChanges: (changes) => {
        // ★ نگهبان حلقه‌ی echo — در مرز، نه با اعتماد به بوم.
        assertEmittable(changes);
        this.inbound?.setSaveState({ status: "saving" });
        this.dispatch(() => {
          this.hub.publish(this, changes);
          this.inbound?.setSaveState({ status: "saved", at: Date.now() });
        });
      },
      emitPointer: (pointer) => {
        this.pointer = pointer;
        this.hub.broadcastPeers();
      },
      emitSelection: (ids) => {
        this.selectedIds = ids;
        this.hub.broadcastPeers();
      },
      emitViewport: (viewport) => {
        this.viewport = viewport;
        this.hub.broadcastPeers();
      },
      emitActiveTool: (tool) => {
        this.activeTool = tool;
        this.hub.broadcastPeers();
      },
      emitEphemeral: (payload) => {
        this.ephemeral = payload;
        this.hub.publishEphemeral(this, payload);
      },
      requestAssetUpload: async (file) => {
        const fileId = `f_local_${Math.random().toString(36).slice(2, 10)}`;
        // در محیط تست `URL.createObjectURL` ممکن است نباشد.
        if (typeof URL.createObjectURL === "function") {
          this.objectUrls.set(fileId, URL.createObjectURL(file));
        }
        const asset: HbAsset = {
          fileId,
          bucket: "local",
          key: `local/${fileId}`,
          mime: file.type,
          width: 0,
          height: 0,
          sizeBytes: file.size,
          sha256: null,
          uploadedBy: this.user.id,
          createdAt: Date.now(),
        };
        return asset;
      },
      resolveAssetUrl: async (fileId) => this.objectUrls.get(fileId) ?? "",
      emitReady: () => {
        this.hub.broadcastPeers();
      },
    };
  }

  disconnect(): void {
    this.hub.leave(this);
    for (const url of this.objectUrls.values()) {
      if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
    }
    this.objectUrls.clear();
    this.inbound?.setConnectionState({ status: "offline", pendingChanges: 0 });
    this.inbound = null;
  }

  // ── مصرف داخلی توسط hub ────────────────────────────────────

  receiveRemote(changes: ElementChangeSet): void {
    this.dispatch(() => this.inbound?.applyRemoteChanges(changes));
  }

  receiveEphemeral(_from: LocalSyncAdapter, _payload: EphemeralPayload | null): void {
    this.hub.broadcastPeers();
  }

  receivePeers(peers: PeerState[]): void {
    this.inbound?.applyPeers(peers);
    this.inbound?.setConnectionState({ status: "connected", peers: peers.length });
  }

  peerState(): PeerState {
    return {
      clientId: this.clientId,
      user: this.user,
      pointer: this.pointer,
      selectedIds: this.selectedIds,
      viewport: this.viewport,
      activeTool: this.activeTool,
      ephemeral: this.ephemeral,
    };
  }

  private dispatch(fn: () => void): void {
    if (this.latencyMs <= 0) fn();
    else setTimeout(fn, this.latencyMs);
  }
}
