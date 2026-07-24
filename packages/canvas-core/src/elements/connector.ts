import type { HbConnectorStyle, HbElement } from "@hamboom/shared-types";

import { HB_CONNECTOR_DEFAULTS } from "../theme/defaults";
import { HB_UI_COLORS } from "../theme/tokens";
import { buildBaseElement, resolveSeed, type ElementSeedOptions } from "./factory";
import { routeConnector, toRelativePoints, type Box, type Point } from "./connector-routing";

/**
 * کانکتور (پیکان) — گام ۳٫۴.
 *
 * ── مسیر، حالت مشتق‌شده است ────────────────────────────────────────────
 *
 * `points` عنصر از `routeConnector` حساب می‌شود، نه اینکه داده‌ی مستقل باشد.
 * وقتی یک سر جابه‌جا می‌شود، مسیر دوباره حساب می‌شود — همه‌ی کلاینت‌ها به یک
 * نتیجه می‌رسند چون تابع قطعی است ([ADR-008](../../../../ARCHITECTURE_DECISIONS.md#adr-008)).
 *
 * `startBinding`/`endBinding` منبع حقیقت اتصال‌اند؛ `points` فقط کش رندر.
 */

/** فاصله‌ی نوک پیکان از لبه‌ی عنصر متصل. */
const CONNECTOR_GAP = 4;

export interface ConnectorEnd {
  /** اگر به عنصری وصل است، شناسه‌اش. */
  elementId?: string;
  /** جعبه‌ی محیطی آن عنصر، یا نقطه‌ی آزاد. */
  box: Box | Point;
}

export interface CreateConnectorOptions extends ElementSeedOptions {
  start: ConnectorEnd;
  end: ConnectorEnd;
  authorId: string;
  index?: string;
  style?: HbConnectorStyle;
  strokeColor?: string;
  label?: string;
}

/**
 * ساخت یک کانکتور بین دو سر.
 *
 * `x`/`y` عنصر برابر نقطه‌ی اول مسیر است و بقیه‌ی نقاط نسبی به آن ذخیره
 * می‌شوند — قرارداد موتور برای عناصر خطی (`points[0]` همیشه `[0,0]`).
 */
export function createConnector(options: CreateConnectorOptions): HbElement {
  const {
    start,
    end,
    authorId,
    index = "a0",
    style = HB_CONNECTOR_DEFAULTS.style,
    strokeColor = HB_UI_COLORS.text,
    label,
    ...seedOptions
  } = options;

  const seed = resolveSeed(seedOptions);
  const absolutePoints = routeConnector({ start: start.box, end: end.box, style });
  const relativePoints = toRelativePoints(absolutePoints);
  const origin = absolutePoints[0] ?? { x: 0, y: 0 };

  // اندازه‌ی جعبه‌ی محیطی خطِ کانکتور — موتور برای hit-test لازمش دارد.
  const xs = absolutePoints.map((p) => p.x);
  const ys = absolutePoints.map((p) => p.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);

  const makeBinding = (endSpec: ConnectorEnd) =>
    endSpec.elementId ? { elementId: endSpec.elementId, focus: 0, gap: CONNECTOR_GAP } : null;

  return {
    ...buildBaseElement({
      id: `arw_${seed.makeId()}`,
      type: "arrow",
      x: origin.x,
      y: origin.y,
      width,
      height,
      index,
      kind: "connector",
      authorId,
      seed,
      hbExtra: { connector: { style, ...(label === undefined ? {} : { label }) } },
    }),
    strokeColor,
    backgroundColor: "transparent",
    roundness: null,
    points: relativePoints,
    startBinding: makeBinding(start),
    endBinding: makeBinding(end),
    startArrowhead: HB_CONNECTOR_DEFAULTS.startArrowhead,
    endArrowhead: HB_CONNECTOR_DEFAULTS.endArrowhead,
    elbowed: style === "elbow",
  } as unknown as HbElement;
}

/**
 * مسیر یک کانکتور موجود را با موقعیت جدید دو سرش دوباره حساب می‌کند.
 *
 * این همان تابعی است که وقتی کاربر عنصری را حرکت می‌دهد صدا زده می‌شود.
 * چون `routeConnector` قطعی است، هر کلاینت مستقل به همین نتیجه می‌رسد — پس
 * فقط کلاینتی که حرکت داده لازم است `points` را در سند بنویسد.
 *
 * ⚠️ خروجی جدید `x`/`y`/`points`/`width`/`height` است، نه یک عنصر کامل —
 * تا مصرف‌کننده تصمیم بگیرد چطور merge کند.
 */
export function rerouteConnector(
  connector: HbElement,
  startBox: Box | Point,
  endBox: Box | Point,
): { x: number; y: number; width: number; height: number; points: [number, number][] } {
  const style = connector.customData.hb.connector?.style ?? "elbow";

  const absolute = routeConnector({ start: startBox, end: endBox, style });
  const origin = absolute[0] ?? { x: 0, y: 0 };
  const points = toRelativePoints(absolute);

  const xs = absolute.map((p) => p.x);
  const ys = absolute.map((p) => p.y);

  return {
    x: origin.x,
    y: origin.y,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    points,
  };
}
