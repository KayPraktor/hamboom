import type { PeerState } from "../sync/contract";

import "./peer-avatars.css";

/**
 * فهرستِ آواتارِ کاربرانِ آنلاین — گام ۴٫۴.
 *
 * از `PeerState[]` آواتارِ هر همتا را نشان می‌دهد؛ کلیک = دنبال‌کردنِ او
 * (`focusOn({ kind: "peer" })` را مصرف‌کننده انجام می‌دهد). آواتار اگر تصویر
 * نداشت، حرفِ اولِ نام روی رنگِ کاربر است.
 */

export interface PeerAvatarsProps {
  peers: PeerState[];
  /** کلیک روی آواتار = دنبال‌کردنِ آن همتا. */
  onFollow: (clientId: number) => void;
}

export function PeerAvatars({ peers, onFollow }: PeerAvatarsProps) {
  if (peers.length === 0) return null;
  return (
    <div className="hb-peer-avatars" role="group" aria-label="کاربرانِ آنلاین">
      {peers.map((peer) => {
        const initial = peer.user.displayName.trim().charAt(0) || "؟";
        return (
          <button
            key={peer.clientId}
            type="button"
            className="hb-peer-avatar"
            style={{ background: peer.user.color }}
            title={`${peer.user.displayName} — دنبال‌کردن`}
            aria-label={`دنبال‌کردنِ ${peer.user.displayName}`}
            onClick={() => onFollow(peer.clientId)}
          >
            {peer.user.avatarUrl ? (
              <img className="hb-peer-avatar-img" src={peer.user.avatarUrl} alt="" />
            ) : (
              initial
            )}
          </button>
        );
      })}
    </div>
  );
}
