import type { HbElement } from "@hamboom/shared-types";

import type { PeerState } from "../sync/contract";

import "./peer-selections.css";

/**
 * هاله‌ی انتخابِ همکاران — گام ۴٫۴.
 *
 * دورِ هر عنصری که یک همتا انتخاب کرده، یک قابِ رنگیِ او می‌کشد. `selectedIds`
 * از `PeerState` می‌آید و مرزِ عنصر از صحنه‌ی محلی؛ نگاشتِ صحنه→پیکسل تزریق
 * می‌شود (مثل `PeerCursors`، پروجکتورِ استاندارد `sceneToOverlayPixel`). لایه
 * شفاف و `pointer-events: none`.
 *
 * ⚠️ موقعیت با `transform`ِ فیزیکی (مختصاتِ بوم، استثنای ADR-016). رنگِ قاب
 * از `peer.user.color` است — رنگ، نه property جهت‌دار.
 */

export interface PeerSelectionsProps {
  peers: PeerState[];
  elements: HbElement[];
  project: (sceneX: number, sceneY: number) => { x: number; y: number };
}

export function PeerSelections({ peers, elements, project }: PeerSelectionsProps) {
  const byId = new Map(elements.map((el) => [el.id, el]));
  return (
    <div className="hb-peer-selections" aria-hidden="true">
      {peers.flatMap((peer) =>
        peer.selectedIds.map((id) => {
          const el = byId.get(id);
          if (!el || el.isDeleted) return null;
          const topStart = project(el.x, el.y);
          const bottomEnd = project(el.x + el.width, el.y + el.height);
          return (
            <div
              key={`${peer.clientId}:${id}`}
              className="hb-peer-halo"
              style={{
                transform: `translate(${topStart.x}px, ${topStart.y}px)`,
                inlineSize: `${bottomEnd.x - topStart.x}px`,
                blockSize: `${bottomEnd.y - topStart.y}px`,
                borderColor: peer.user.color,
              }}
            />
          );
        }),
      )}
    </div>
  );
}
