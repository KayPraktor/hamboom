import { t } from "@hamboom/i18n";

import { toolIcon } from "./toolbar-icons";
import { HB_TOOLS, type ToolId } from "./toolbar-tools";
import "./overlay-layout.css";
import "./toolbar.css";

/**
 * نوار ابزارِ هم‌بوم — گام ۴٫۲.
 *
 * دو چیدمان دارد (`orientation`، پیش‌فرض `"horizontal"`):
 *
 * - **افقی** (پیش‌فرض، سازگار با گذشته): **پایین، وسط، شناور** — جهت‌خنثی، پس
 *   دعوای چپ/راستِ RTL را ندارد. مرکز با `margin-inline: auto` (نه `left`) تا با
 *   گیتِ Stylelintِ ADR-016 نسازد.
 * - **عمودی** (M3 گام ۹٫۱، تاییدِ مالک ۱۴۰۵/۰۶/۱۲): لبه‌ی **inline-start** (در
 *   RTL سمتِ راست)، وسطِ عمودی — نوارِ فشرده‌ی شبیه‌میرو. جای‌گذاری باز هم منطقی
 *   است (`inset-inline-start` + محورِ بلوک)، پس دعوای چپ/راست را با logical
 *   properties حل می‌کند، نه با آینه‌کردن.
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
  /**
   * چیدمان — افقیِ پایین-وسط (پیش‌فرض) یا عمودیِ لبه‌ی inline-start.
   * افزایشی و سازگار با گذشته: مصرف‌کننده‌های موجود بدونِ تغییر افقی می‌مانند.
   */
  orientation?: "horizontal" | "vertical";
}

export function Toolbar({ activeTool, onSelectTool, orientation = "horizontal" }: ToolbarProps) {
  const vertical = orientation === "vertical";
  // جای‌گذاری از همان منبعِ واحدِ overlay-layout می‌آید (ADR-027) — نه offsetِ دستی.
  const placement = vertical ? "hb-overlay--center-start" : "hb-overlay--bottom-center";
  return (
    <div
      className={`hb-toolbar${vertical ? " hb-toolbar--vertical" : ""} hb-overlay ${placement}`}
      role="toolbar"
      aria-label="ابزارها"
      aria-orientation={vertical ? "vertical" : "horizontal"}
    >
      {HB_TOOLS.map((tool) => {
        const label = t(tool.labelKey);
        const active = activeTool === tool.id;
        const shortcut = tool.shortcut.toUpperCase();
        const soon = tool.comingSoon ?? false;
        return (
          <button
            key={tool.id}
            type="button"
            className={`hb-tool${active ? " is-active" : ""}${soon ? " is-coming-soon" : ""}`}
            title={soon ? `${label} · به‌زودی` : `${label} · ${shortcut}`}
            aria-label={label}
            aria-pressed={active}
            aria-disabled={soon || undefined}
            aria-keyshortcuts={soon ? undefined : shortcut}
            onClick={() => {
              if (soon) return; // stub — محتوایش کار M3
              onSelectTool(tool.id);
            }}
          >
            {toolIcon(tool.id)}
          </button>
        );
      })}
    </div>
  );
}
