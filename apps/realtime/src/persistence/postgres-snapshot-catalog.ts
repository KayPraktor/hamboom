import { randomUUID } from "node:crypto";

import type pg from "pg";

import type { SnapshotCatalog, SnapshotRecord } from "./snapshot-catalog.ts";

/**
 * کاتالوگِ snapshot روی PostgreSQL — جدولِ `board_snapshots` از
 * [migrationِ ۰۰۰۱](../../../../infra/sql/migrations/0001_realtime_documents.sql).
 *
 * ⚠️ **این جدول توسطِ `postgres-update-log` هم خوانده می‌شود** (در محاسبه‌ی `seq`).
 * پیوندشان عمدی است و دلیلش آنجا نوشته شده: بعد از فشرده‌سازی، `MAX(seq)`ِ
 * `board_updates` دیگر بلندترین شماره‌ی تاریخِ بورد نیست.
 */

export interface PostgresSnapshotCatalogOptions {
  /** استخرِ مشترک با لاگِ update — یک اتصال کافی است. */
  pool: pg.Pool;
}

interface Row {
  seq_upto: string;
  storage_key: string;
  state_vector: Buffer;
  byte_size: string;
  element_count: number;
}

function toRecord(row: Row): SnapshotRecord {
  return {
    seqUpto: Number(row.seq_upto),
    storageKey: row.storage_key,
    stateVector: new Uint8Array(row.state_vector),
    byteSize: Number(row.byte_size),
    elementCount: row.element_count,
  };
}

const COLUMNS = "seq_upto, storage_key, state_vector, byte_size, element_count";

export function createPostgresSnapshotCatalog({
  pool,
}: PostgresSnapshotCatalogOptions): SnapshotCatalog {
  return {
    async record(boardId, entry) {
      await pool.query(
        `INSERT INTO board_snapshots
           (id, board_id, seq_upto, storage_key, state_vector, byte_size, element_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          randomUUID(),
          boardId,
          entry.seqUpto,
          entry.storageKey,
          Buffer.from(entry.stateVector),
          entry.byteSize,
          entry.elementCount,
        ],
      );
    },

    async latest(boardId) {
      const result = await pool.query<Row>(
        `SELECT ${COLUMNS} FROM board_snapshots
         WHERE board_id = $1
         ORDER BY seq_upto DESC
         LIMIT 1`,
        [boardId],
      );
      const row = result.rows[0];
      return row ? toRecord(row) : null;
    },

    async older(boardId, keepFromSeq) {
      const result = await pool.query<Row>(
        `SELECT ${COLUMNS} FROM board_snapshots
         WHERE board_id = $1 AND seq_upto < $2
         ORDER BY seq_upto ASC`,
        [boardId, keepFromSeq],
      );
      return result.rows.map(toRecord);
    },

    async forget(boardId, seqUpto) {
      await pool.query("DELETE FROM board_snapshots WHERE board_id = $1 AND seq_upto = $2", [
        boardId,
        seqUpto,
      ]);
    },
  };
}
