import type { PeerState } from "@hamboom/canvas-core/sync";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * حضورِ نمایشیِ گام ۴٫۴ — با `BroadcastChannel` بین **تب‌ها**.
 *
 * هر تب یک `clientId`/کاربرِ تصادفی می‌گیرد، مکان‌نمای محلی‌اش را (در مختصاتِ
 * صحنه) پخش می‌کند و مکان‌نمای بقیه را جمع می‌کند. این جای آداپتورِ واقعیِ M2 را
 * می‌گیرد؛ همان شکلِ داده (`PeerState`) که `applyPeers` می‌دهد.
 */

const NAMES = ["نیلوفر", "کاوه", "سارا", "آرش", "مینا", "رضا", "لیلا", "بهرام"] as const;
const COLORS = ["#5B8DEF", "#D14343", "#1E7A3C", "#8E5BEF", "#E07B1B", "#0B8A8A"] as const;
const STALE_MS = 5000;

type Msg =
  | {
      type: "cursor";
      clientId: number;
      user: PeerState["user"];
      pointer: PeerState["pointer"];
      t: number;
    }
  | { type: "leave"; clientId: number };

function randomUser(clientId: number): PeerState["user"] {
  return {
    id: `u_${clientId}`,
    displayName: NAMES[clientId % NAMES.length]!,
    color: COLORS[clientId % COLORS.length]!,
    avatarUrl: null,
  };
}

export function usePresence() {
  const [peers, setPeers] = useState<PeerState[]>([]);
  const idRef = useRef(1 + Math.floor(Math.random() * 1_000_000));
  const userRef = useRef(randomUser(idRef.current));
  const channelRef = useRef<BroadcastChannel | null>(null);
  const seenRef = useRef(new Map<number, { peer: PeerState; t: number }>());

  const flush = useCallback(() => {
    setPeers([...seenRef.current.values()].map((v) => v.peer));
  }, []);

  useEffect(() => {
    const channel = new BroadcastChannel("hb-presence");
    channelRef.current = channel;
    const localId = idRef.current;

    channel.onmessage = (event: MessageEvent<Msg>) => {
      const msg = event.data;
      if (msg.clientId === localId) return;
      if (msg.type === "leave") {
        seenRef.current.delete(msg.clientId);
      } else {
        seenRef.current.set(msg.clientId, {
          t: msg.t,
          peer: {
            clientId: msg.clientId,
            user: msg.user,
            pointer: msg.pointer,
            selectedIds: [],
            viewport: null,
            activeTool: null,
          },
        });
      }
      flush();
    };

    const prune = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, v] of seenRef.current) {
        if (now - v.t > STALE_MS) {
          seenRef.current.delete(id);
          changed = true;
        }
      }
      if (changed) flush();
    }, 2000);

    const leave = () => channel.postMessage({ type: "leave", clientId: localId } satisfies Msg);
    window.addEventListener("beforeunload", leave);

    return () => {
      clearInterval(prune);
      window.removeEventListener("beforeunload", leave);
      leave();
      channel.close();
    };
  }, [flush]);

  const emitPointer = useCallback((pointer: PeerState["pointer"]) => {
    channelRef.current?.postMessage({
      type: "cursor",
      clientId: idRef.current,
      user: userRef.current,
      pointer,
      t: Date.now(),
    } satisfies Msg);
  }, []);

  return { peers, emitPointer, localUser: userRef.current };
}
