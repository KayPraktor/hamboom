/**
 * فراداده‌ی ابزارهای نوار — گام ۴٫۲.
 *
 * خالص و مستقل از React، تا نگاشتِ میانبرها و کلیدهای i18n جدا از رندر
 * آزمودنی بمانند. برچسب‌ها **کلیدِ** i18n اند (`tool.*`)، نه متنِ ثابت — تا
 * از `@hamboom/i18n` بیایند و در یک جا نگهداری شوند.
 */

export type ToolId =
  | "select"
  | "hand"
  | "sticky"
  | "text"
  | "shape"
  | "connector"
  | "pen"
  | "image"
  | "frame"
  | "comment"
  | "eraser"
  | "laser";

export interface ToolMeta {
  id: ToolId;
  /** کلیدِ i18n برای برچسب/تولتیپ. */
  labelKey: string;
  /** میانبرِ تک‌حرفیِ کوچک. */
  shortcut: string;
  /** هنوز پیاده نشده (محتوایش کار M3) — دکمه «به‌زودی» و غیرفعالِ بصری می‌شود. */
  comingSoon?: boolean;
}

export const HB_TOOLS: readonly ToolMeta[] = [
  { id: "select", labelKey: "tool.select", shortcut: "v" },
  { id: "hand", labelKey: "tool.hand", shortcut: "h" },
  { id: "sticky", labelKey: "tool.sticky", shortcut: "n" },
  { id: "text", labelKey: "tool.text", shortcut: "t" },
  { id: "shape", labelKey: "tool.shape", shortcut: "r" },
  { id: "connector", labelKey: "tool.connector", shortcut: "c" },
  { id: "pen", labelKey: "tool.pen", shortcut: "p" },
  { id: "image", labelKey: "tool.image", shortcut: "u" },
  { id: "frame", labelKey: "tool.frame", shortcut: "f" },
  { id: "comment", labelKey: "tool.comment", shortcut: "k", comingSoon: true },
  { id: "eraser", labelKey: "tool.eraser", shortcut: "e" },
  { id: "laser", labelKey: "tool.laser", shortcut: "l" },
];

/** نگاشتِ میانبر (حرفِ کوچک) → شناسه‌ی ابزار. */
export const HB_TOOL_SHORTCUTS: Readonly<Record<string, ToolId>> = Object.fromEntries(
  HB_TOOLS.map((tool) => [tool.shortcut, tool.id]),
);

/** آیا این کلید یک میانبرِ ابزار است؟ (حرفِ بزرگ/کوچک مهم نیست) */
export function toolForShortcut(key: string): ToolId | undefined {
  return HB_TOOL_SHORTCUTS[key.toLowerCase()];
}
