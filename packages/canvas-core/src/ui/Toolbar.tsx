import { t } from "@hamboom/i18n";

import { toolIcon } from "./toolbar-icons";
import { HB_TOOLS, type ToolId } from "./toolbar-tools";
import "./toolbar.css";

/**
 * نوار ابزارِ هم‌بوم — گام ۴٫۲.
 *
 * **پایین، وسط، شناور** (تصمیمِ ثبت‌شده در PROGRESS) — جهت‌خنثی، پس دعوای
 * چپ/راستِ RTL را ندارد. مرکز با `margin-inline: auto` (نه `left`) تا با گیتِ
 * Stylelintِ ADR-016 نسازد.
 *
 * ── ارائه‌ای است، نه رفتاری ────────────────────────────────────────────
 *
 * این کامپوننت فقط دکمه‌ها را می‌کشد و `onSelectTool` را صدا می‌زند؛ سیم‌کشیِ
 * واقعیِ ابزار (setActiveTool موتور، ابزارهای استیکی/قلم، انتخابگرِ فایلِ تصویر)
 * و میانبرها با مصرف‌کننده است (`toolForShortcut` برای نگاشتِ کلید). این تفکیک
 * تست را ساده و رفتار را قابلِ ترکیب نگه می‌دارد.
 */

export interface ToolbarProps {
  activeTool: ToolId;
  onSelectTool: (id: ToolId) => void;
}

export function Toolbar({ activeTool, onSelectTool }: ToolbarProps) {
  return (
    <div className="hb-toolbar" role="toolbar" aria-label="ابزارها">
      {HB_TOOLS.map((tool) => {
        const label = t(tool.labelKey);
        const active = activeTool === tool.id;
        const shortcut = tool.shortcut.toUpperCase();
        return (
          <button
            key={tool.id}
            type="button"
            className={`hb-tool${active ? " is-active" : ""}`}
            title={`${label} · ${shortcut}`}
            aria-label={label}
            aria-pressed={active}
            aria-keyshortcuts={shortcut}
            onClick={() => onSelectTool(tool.id)}
          >
            {toolIcon(tool.id)}
          </button>
        );
      })}
    </div>
  );
}
