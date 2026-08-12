import type Redis from "ioredis";

import { createLogger, type Logger } from "../log.ts";
import {
  BUS_KINDS,
  decodeEnvelope,
  encodeEnvelope,
  type BoardBus,
  type BusEnvelope,
} from "./board-bus.ts";

/**
 * گذرگاه روی Redis pub/sub — [ADR-006](../../../../ARCHITECTURE_DECISIONS.md#adr-006) فاز ۲.
 *
 * کانال‌ها همان‌هایی‌اند که ADR نام برده: `hb:board:<boardId>` برای updateهای سند
 * و `hb:aware:<boardId>` برای حضور و ephemeral.
 *
 * ── ★ چرا **دو** اتصال ────────────────────────────────────────────────
 *
 * یک اتصالِ Redis که `SUBSCRIBE` کرده وارد حالتِ اشتراک می‌شود و دیگر دستورِ
 * معمولی نمی‌پذیرد (`PUBLISH`، `SET`ِ قفل، …). پس اشتراک اتصالِ **خودش** را
 * می‌خواهد. این محدودیتِ خودِ پروتکل است، نه انتخابِ ما.
 *
 * ── ⚠️ چه چیزی این گذرگاه تضمین **نمی‌کند** ────────────────────────────
 *
 * Redis pub/sub تحویل را تضمین نمی‌کند: نودی که در لحظه‌ی انتشار مشترک نباشد،
 * پیام را **هرگز** نمی‌گیرد. برای سند بی‌خطر است چون صاحب همه‌چیز را پایدار
 * می‌کند و هر نودی که بعداً اتاق را باز کند از دیتابیس می‌خواند — ولی به همین
 * دلیل اتاق **قبل از** خواندن از دیتابیس مشترک می‌شود، نه بعدش.
 */

export interface RedisBoardBusOptions {
  /** اتصالِ انتشار و دستورهای معمولی. */
  publisher: Redis;
  /** اتصالِ **جدا** برای اشتراک (بالا). */
  subscriber: Redis;
  logger?: Logger;
}

/** کانالِ سند و کانالِ حضور — همان نام‌های ADR-006. */
export function boardChannel(boardId: string): string {
  return `hb:board:${boardId}`;
}
export function awarenessChannel(boardId: string): string {
  return `hb:aware:${boardId}`;
}

export function createRedisBoardBus({
  publisher,
  subscriber,
  logger = createLogger(),
}: RedisBoardBusOptions): BoardBus {
  /** مشترکانِ هر بورد — یک اتصال، چند اتاق. */
  const handlers = new Map<string, Set<(envelope: BusEnvelope) => void>>();

  // ⚠️ **یک شنونده برای همه‌ی کانال‌ها.** `ioredis` رویدادِ `messageBuffer` را
  //    سراسری می‌دهد، نه به‌ازای کانال؛ ثبتِ یک شنونده به‌ازای هر اتاق یعنی نشتیِ
  //    شنونده و هشدارِ `MaxListenersExceeded` روی سرورِ پرترافیک.
  subscriber.on("messageBuffer", (channel: Buffer, message: Buffer) => {
    const board = boardIdFrom(channel.toString());
    if (!board) return;
    const envelope = decodeEnvelope(new Uint8Array(message));
    if (!envelope) {
      logger.warn("پیامِ گذرگاه خوانده نشد", { channel: channel.toString() });
      return;
    }
    for (const handler of handlers.get(board) ?? []) handler(envelope);
  });

  return {
    publish(boardId, envelope) {
      // ★ سند و «تا کجا ذخیره شد» روی کانالِ بورد؛ حضور و ephemeral روی کانالِ
      //   حضور — همان تفکیکی که ADR-006 خواسته، چون دومی **هیچ‌وقت** پایدار
      //   نمی‌شود و حجمش چند برابرِ اولی است.
      const onBoardChannel =
        envelope.kind === BUS_KINDS.UPDATE || envelope.kind === BUS_KINDS.SAVED;
      const channel = onBoardChannel ? boardChannel(boardId) : awarenessChannel(boardId);
      // ⚠️ `void`: انتشار نباید مسیرِ داغِ پخشِ محلی را نگه دارد. شکستش لاگ
      //    می‌شود — و بی‌خطر است، چون همان update روی این نود از قبل اعمال شده و
      //    صاحب پایدارش می‌کند.
      void publisher
        .publish(channel, Buffer.from(encodeEnvelope(envelope)))
        .catch((cause: unknown) => {
          logger.error("انتشار روی گذرگاه شکست خورد", { channel, error: String(cause) });
        });
    },

    async subscribe(boardId, handler) {
      const set = handlers.get(boardId) ?? new Set();
      const first = set.size === 0;
      set.add(handler);
      handlers.set(boardId, set);

      // ★ فقط بارِ اول واقعاً `SUBSCRIBE` می‌زنیم؛ بقیه از همان اتصال می‌خوانند.
      if (first) await subscriber.subscribe(boardChannel(boardId), awarenessChannel(boardId));

      return () => {
        set.delete(handler);
        if (set.size > 0) return;
        handlers.delete(boardId);
        void subscriber
          .unsubscribe(boardChannel(boardId), awarenessChannel(boardId))
          .catch(() => undefined);
      };
    },

    async close() {
      handlers.clear();
      await subscriber.quit().catch(() => undefined);
      await publisher.quit().catch(() => undefined);
    },
  };
}

/** `hb:board:<id>` یا `hb:aware:<id>` → `<id>`. */
function boardIdFrom(channel: string): string | null {
  const match = /^hb:(?:board|aware):(.+)$/.exec(channel);
  return match?.[1] ?? null;
}
