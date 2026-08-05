import type { HbElement, HbShapeElement, HbTextElement } from "@hamboom/shared-types";

/**
 * نمونه‌های عنصر برای تست‌های این پکیج — **کدِ محصولی نیست** و از `index.ts`
 * صادر نمی‌شود.
 *
 * ── چرا نمونه‌ی دستی، در حالی که M1 سازنده‌ی واقعی دارد ─────────────────
 *
 * `ydoc-schema` حق ندارد `canvas-core` را ببیند
 * ([ADR-029](../../../ARCHITECTURE_DECISIONS.md#adr-029)) — و نباید هم ببیند،
 * چون سرور همین پکیج را مصرف می‌کند. پس وفاداری در برابرِ **خروجیِ سازنده‌های
 * واقعی** جای دیگری آزموده می‌شود: [`canvas-sync/src/element-codec.test.ts`](../../canvas-sync/src/element-codec.test.ts)
 * که تنها پکیجِ مجاز به دیدنِ هر دو است.
 *
 * ★ در عوض، اینجا تنها جایی است که **`line`** پوشش داده می‌شود: کانکتورِ محصولی
 * همیشه `arrow` است، پس `line` هیچ سازنده‌ای ندارد و از تستِ نمونه‌های واقعی
 * می‌افتد — همان قیدِ سومِ گام ۱٫۲.
 *
 * ⚠️ نمونه‌ی دستی می‌تواند بی‌صدا از schema واگرا شود. `element-codec.test.ts`
 * قبل از هر ادعای دیگری همه‌ی این‌ها را با `hbElement.parse` اعتبارسنجی می‌کند،
 * وگرنه کلِ فایل یک سبزِ دروغین می‌شد.
 */

const base = {
  x: 10,
  y: 20,
  width: 200,
  height: 120,
  angle: 0,
  index: "a1",
  frameId: null,
  groupIds: [],
  locked: false,
  strokeColor: "#1e1e1e",
  backgroundColor: "#FFF9B1",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  roundness: { type: 3, value: 32 },
  seed: 123456,
  version: 1,
  versionNonce: 987654,
  updated: 1_700_000_000_000,
  isDeleted: false,
  boundElements: null,
  link: null,
  customData: {
    hb: {
      schema: 1,
      kind: "shape",
      createdBy: "u_fixture",
      lastEditedBy: "u_fixture",
      createdAt: 1_700_000_000_000,
    },
  },
  // ⚠️ `satisfies` و نه `as const`: با `as const` کلِ آبجکت `readonly` می‌شود و
  //    نمونه‌های زیر که آن را spread می‌کنند دیگر به `HbElement` نمی‌خورند.
  //    `satisfies` هم literal را نگه می‌دارد (`roughness: 0`) و هم mutable.
} satisfies Omit<HbShapeElement, "id" | "type">;

/** یک نمونه از **هر ۹ نوعِ رندر**، شاملِ `line` که سازنده‌ی محصولی ندارد. */
export const ELEMENT_FIXTURES: ReadonlyArray<{ label: string; element: HbElement }> = [
  {
    label: "rectangle (استیکی)",
    element: {
      ...base,
      id: "stk_1",
      type: "rectangle",
      customData: {
        hb: {
          ...base.customData.hb,
          kind: "sticky",
          tags: ["مهم"],
          sticky: { palette: "yellow", autoFit: true },
        },
      },
    },
  },
  { label: "ellipse", element: { ...base, id: "elp_1", type: "ellipse" } },
  { label: "diamond", element: { ...base, id: "dmd_1", type: "diamond" } },
  {
    label: "text (متنِ مقید)",
    element: {
      ...base,
      id: "txt_1",
      type: "text",
      index: "a2",
      containerId: "stk_1",
      text: "سلام\nدنیا",
      originalText: "سلام دنیا",
      fontSize: 20,
      fontFamily: 1,
      textAlign: "center",
      verticalAlign: "middle",
      lineHeight: 1.6,
      direction: "rtl",
      autoResize: true,
      customData: { hb: { ...base.customData.hb, kind: "text" } },
    },
  },
  {
    label: "arrow (کانکتور)",
    element: {
      ...base,
      id: "arw_1",
      type: "arrow",
      index: "a3",
      points: [
        [0, 0],
        [120, 60],
      ],
      startBinding: { elementId: "stk_1", focus: 0.2, gap: 4 },
      endBinding: null,
      startArrowhead: null,
      endArrowhead: "arrow",
      elbowed: false,
      customData: {
        hb: { ...base.customData.hb, kind: "connector", connector: { style: "curved" } },
      },
    },
  },
  {
    // ★ تنها نوعی که سازنده‌ی محصولی ندارد — قیدِ سومِ گام ۱٫۲.
    label: "line (بدونِ سازنده)",
    element: {
      ...base,
      id: "lin_1",
      type: "line",
      index: "a4",
      points: [
        [0, 0],
        [80, 0],
        [80, 40],
      ],
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: null,
      elbowed: true,
      customData: { hb: { ...base.customData.hb, kind: "connector" } },
    },
  },
  {
    label: "freedraw",
    element: {
      ...base,
      id: "drw_1",
      type: "freedraw",
      index: "a5",
      points: [
        [0, 0],
        [5, 8],
        [12, 20],
      ],
      pressures: [0.4, 0.6, 0.5],
      simulatePressure: true,
      customData: { hb: { ...base.customData.hb, kind: "draw" } },
    },
  },
  {
    label: "image",
    element: {
      ...base,
      id: "img_1",
      type: "image",
      index: "a6",
      fileId: "f_fixture",
      scale: [1, 1],
      status: "saved",
      crop: null,
      customData: { hb: { ...base.customData.hb, kind: "image" } },
    },
  },
  {
    label: "frame",
    element: {
      ...base,
      id: "frm_1",
      type: "frame",
      index: "a7",
      name: "جلسه‌ی هفتگی",
      roundness: null,
      customData: {
        hb: { ...base.customData.hb, kind: "frame", frame: { collapsed: false, color: "#868e96" } },
      },
    },
  },
];

/** نمونه‌ی استیکی — پرکاربردترین در تست‌ها. کپیِ تازه، تا تست‌ها همدیگر را آلوده نکنند. */
export function stickyFixture(): HbShapeElement {
  return structuredClone(ELEMENT_FIXTURES[0]!.element) as HbShapeElement;
}

/** نمونه‌ی متن — تنها نوعی که `originalText` دارد (ADR-034). */
export function textFixture(): HbTextElement {
  return structuredClone(ELEMENT_FIXTURES[3]!.element) as HbTextElement;
}
