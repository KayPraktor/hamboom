import type { ReactElement } from "react";

import type { ToolId } from "./toolbar-tools";

/**
 * آیکون‌های نوار ابزار — SVGهای درون‌خطیِ ساده (۲۰×۲۰، `currentColor`).
 *
 * عمداً مینیمال و بدونِ وابستگی به مجموعه‌ی آیکونِ خارجی (P1/P2). هندسه است،
 * نه متن جهت‌دار — پس با RTL کاری ندارد.
 */

const S = {
  width: 20,
  height: 20,
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const ICONS: Record<ToolId, ReactElement> = {
  select: (
    <svg {...S}>
      <path d="M4 3l6 14 2-6 6-2z" />
    </svg>
  ),
  hand: (
    <svg {...S}>
      <path d="M10 3v6M7 5v5M13 5v5M4.5 9.5c0 4 2 7.5 5.5 7.5s5.5-3 5.5-7V7" />
    </svg>
  ),
  sticky: (
    <svg {...S}>
      <path d="M4 4h12v8l-4 4H4z" />
      <path d="M16 12h-4v4" />
    </svg>
  ),
  text: (
    <svg {...S}>
      <path d="M5 5h10M10 5v10M8 15h4" />
    </svg>
  ),
  shape: (
    <svg {...S}>
      <rect x="4" y="4" width="12" height="12" rx="2" />
    </svg>
  ),
  connector: (
    <svg {...S}>
      <path d="M4 16L16 4M16 4h-5M16 4v5" />
    </svg>
  ),
  pen: (
    <svg {...S}>
      <path d="M14 3l3 3-9 9-4 1 1-4z" />
    </svg>
  ),
  image: (
    <svg {...S}>
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <circle cx="8" cy="8.5" r="1.4" />
      <path d="M4 14l4-4 3 3 2-2 3 3" />
    </svg>
  ),
  frame: (
    <svg {...S}>
      <path d="M6 3v14M14 3v14M3 6h14M3 14h14" />
    </svg>
  ),
  comment: (
    <svg {...S}>
      <path d="M4 5h12v8H9l-3 3v-3H4z" />
    </svg>
  ),
  eraser: (
    <svg {...S}>
      <path d="M8 16h8M4.5 12.5l5-5 5 5-3 3H7z" />
    </svg>
  ),
  laser: (
    <svg {...S}>
      <circle cx="10" cy="10" r="2.2" />
      <path d="M10 2.5v2.4M10 15.1v2.4M2.5 10h2.4M15.1 10h2.4M5 5l1.7 1.7M15 5l-1.7 1.7M5 15l1.7-1.7M15 15l-1.7-1.7" />
    </svg>
  ),
};

export function toolIcon(id: ToolId): ReactElement {
  return ICONS[id];
}
