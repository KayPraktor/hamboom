import type { PeerState } from "../sync/contract";

import "./peer-cursors.css";

/**
 * مکان‌نمای همکاران — گام ۴٫۴.
 *
 * از `PeerState[]` (که `applyPeers` می‌دهد) مکان‌نمای هر همتا را با نام و رنگش
 * رندر می‌کند. ارائه‌ای است: نگاشتِ **صحنه → پیکسلِ محلی** تزریق می‌شود (`project`)
 * تا کامپوننت به موتور گره نخورد.
 *
 * ⚠️ موقعیت با `transform: translate(...)`ِ فیزیکی است، نه logical — مختصاتِ
 * مکان‌نما فیزیکی‌اند و آینه نمی‌شوند (استثنای ADR-016، مثل مختصاتِ بوم).
 * لایه `pointer-events: none` است تا کلیک به بوم برسد.
 */

export interface PeerCursorsProps {
  peers: PeerState[];
  /** نقطه‌ی صحنه → مختصاتِ پیکسلیِ محلیِ لایه. */
  project: (sceneX: number, sceneY: number) => { x: number; y: number };
}

export function PeerCursors({ peers, project }: PeerCursorsProps) {
  return (
    <div className="hb-peer-cursors" aria-hidden="true">
      {peers.map((peer) => {
        const pointer = peer.pointer;
        if (!pointer || !pointer.visible) return null;
        const { x, y } = project(pointer.x, pointer.y);
        return (
          <div
            key={peer.clientId}
            className="hb-peer-cursor"
            style={{ transform: `translate(${x}px, ${y}px)` }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M4 3l6 14 2-6 6-2z" fill={peer.user.color} stroke="#fff" strokeWidth="1" />
            </svg>
            <span className="hb-peer-label" style={{ background: peer.user.color }}>
              {peer.user.displayName}
            </span>
          </div>
        );
      })}
    </div>
  );
}
