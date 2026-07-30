import { t } from "@hamboom/i18n";

import type { ConnectionState, SaveState } from "../sync/contract";
import "./overlay-layout.css";
import "./statusbar.css";

/**
 * نوار وضعیت — گام ۴٫۳.
 *
 * وضعیتِ اتصال و ذخیره را با متنِ **فارسی** نشان می‌دهد (از `@hamboom/i18n`).
 * ارائه‌ای است: حالت‌ها را از بیرون می‌گیرد؛ منبعِ واقعیِ `ConnectionState`/
 * `SaveState` آداپتورِ M2 است. اعداد (تعدادِ همتاها، تغییرهای معلق) خودکار فارسی
 * می‌شوند چون از `t()` رد می‌شوند.
 *
 * ⚠️ نشانگرِ ذخیره باید **حقیقت** بگوید، نه خوش‌بینی (چرایش در `sync/contract`).
 */

export interface StatusBarProps {
  connection: ConnectionState;
  save: SaveState;
}

const CONNECTION_TONE: Record<ConnectionState["status"], string> = {
  connecting: "is-pending",
  connected: "is-ok",
  reconnecting: "is-pending",
  offline: "is-warn",
  error: "is-error",
};

function connectionText(connection: ConnectionState): string {
  switch (connection.status) {
    case "connecting":
      return t("connection.connecting");
    case "connected":
      return t("connection.connected", { count: connection.peers });
    case "reconnecting":
      return t("connection.reconnecting", { attempt: connection.attempt });
    case "offline":
      return t("connection.offline", { pending: connection.pendingChanges });
    case "error":
      return connection.message; // پیامِ خطا از سرور می‌آید (از قبل فارسی)
  }
}

function saveText(save: SaveState): string {
  switch (save.status) {
    case "saved":
      return t("status.saved");
    case "saving":
      return t("status.saving");
    case "unsaved":
      return t("status.unsaved");
  }
}

export function StatusBar({ connection, save }: StatusBarProps) {
  return (
    <div
      className="hb-statusbar hb-overlay hb-overlay--top-center"
      role="status"
      aria-live="polite"
    >
      <span className={`hb-status-dot ${CONNECTION_TONE[connection.status]}`} aria-hidden="true" />
      <span className="hb-status-conn">{connectionText(connection)}</span>
      <span className="hb-status-sep" aria-hidden="true">
        ·
      </span>
      <span className="hb-status-save">{saveText(save)}</span>
    </div>
  );
}
