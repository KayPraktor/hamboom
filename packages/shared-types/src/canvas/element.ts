import { z } from "zod";

/**
 * انواع عنصر بوم — قرارداد مشترک بین `canvas-core` و `realtime-sync`.
 *
 * پیاده‌سازی [PLAN بخش ۷](../../../../PLAN.md) با zod. یک تعریف، سه خروجی:
 * تایپ زمان کامپایل، اعتبارسنجی زمان اجرا، و schema برای مستندسازی
 * ([ADR-021](../../../../ARCHITECTURE_DECISIONS.md#adr-021)).
 *
 * ── قاعده‌ی مرکزی: `type` در برابر `kind` ([ADR-010](../../../../ARCHITECTURE_DECISIONS.md#adr-010)) ──
 *
 * `type` چیزی است که **موتور رندر** می‌فهمد (`rectangle`, `arrow`, `text`).
 * `customData.hb.kind` چیزی است که **محصول** می‌فهمد (`sticky`, `connector`).
 *
 * یک استیکی‌نوت از دید موتور فقط یک مستطیل با متن مقید است — یعنی انتخاب،
 * تغییر اندازه، چرخش، گروه‌بندی و undo رایگان کار می‌کنند — ولی از دید هم‌بوم
 * یک موجودیت درجه‌یک است. به همین دلیل union زیر روی `type` تفکیک می‌شود،
 * نه روی `kind`.
 */

// ─────────────────────────────────────────────────────────────
// شمارشی‌های پایه
// ─────────────────────────────────────────────────────────────

/** نوعی که موتور رندر می‌شناسد. */
export const hbElementType = z.enum([
  "rectangle",
  "ellipse",
  "diamond",
  "arrow",
  "line",
  "freedraw",
  "text",
  "image",
  "frame",
]);
export type HbElementType = z.infer<typeof hbElementType>;

/** معنای محصولی عنصر. با `type` یکی نیست — ADR-010. */
export const hbKind = z.enum([
  "sticky",
  "shape",
  "text",
  "connector",
  "frame",
  "image",
  "draw",
  "embed",
]);
export type HbKind = z.infer<typeof hbKind>;

/** جهت متن. `auto` با `detectBaseDirection` حل می‌شود — ADR-024. */
export const hbTextDirection = z.enum(["rtl", "ltr", "auto"]);
export type HbTextDirection = z.infer<typeof hbTextDirection>;

/** کلیدهای پالت استیکی — مقادیر رنگ در `canvas-core/theme` تعریف می‌شوند. */
export const hbStickyColor = z.enum([
  "yellow",
  "lime",
  "green",
  "mint",
  "sky",
  "blue",
  "violet",
  "pink",
  "red",
  "orange",
  "gray",
  "black",
]);
export type HbStickyColor = z.infer<typeof hbStickyColor>;

export const hbFillStyle = z.enum(["solid", "hachure", "cross-hatch"]);
export const hbStrokeStyle = z.enum(["solid", "dashed", "dotted"]);
export const hbTextAlign = z.enum(["left", "center", "right"]);
export const hbVerticalAlign = z.enum(["top", "middle", "bottom"]);
export const hbArrowhead = z.enum(["arrow", "triangle", "dot", "bar", "circle"]).nullable();
export const hbConnectorStyle = z.enum(["straight", "elbow", "curved"]);

/** نقطه‌ی دوبعدی — مختصات نسبی به `x`/`y` عنصر. */
export const hbPoint = z.tuple([z.number(), z.number()]);
export type HbPoint = z.infer<typeof hbPoint>;

// ─────────────────────────────────────────────────────────────
// customData — قلمروی هم‌بوم روی عنصر موتور
// ─────────────────────────────────────────────────────────────

export const hbCustomData = z.object({
  hb: z.object({
    /** نسخه‌ی ساختار `customData` — مستقل از `meta.schemaVersion` سند. */
    schema: z.literal(1),
    kind: hbKind,
    createdBy: z.string(),
    lastEditedBy: z.string(),
    createdAt: z.number().int(),
    tags: z.array(z.string()).optional(),

    sticky: z
      .object({
        palette: hbStickyColor,
        /** اندازه‌ی فونت با طول متن تنظیم شود (رفتار میرو). */
        autoFit: z.boolean(),
      })
      .optional(),

    connector: z
      .object({
        style: hbConnectorStyle,
        label: z.string().optional(),
      })
      .optional(),

    frame: z
      .object({
        collapsed: z.boolean(),
        color: z.string(),
      })
      .optional(),

    /** فاز ۲ — کانبان. الان فقط جا باز می‌کند. */
    card: z
      .object({
        status: z.string().optional(),
        assigneeIds: z.array(z.string()).optional(),
      })
      .optional(),
  }),
});
export type HbCustomData = z.infer<typeof hbCustomData>;

// ─────────────────────────────────────────────────────────────
// پایه‌ی مشترک همه‌ی عناصر
// ─────────────────────────────────────────────────────────────

/**
 * فیلدهایی که هر عنصر دارد.
 *
 * `seed`, `version`, `versionNonce`, `updated`, `isDeleted` متادیتای موتورند و
 * حذفشان رندر را می‌شکند — حتی اگر برای منطق هم‌بوم بی‌معنی باشند.
 */
export const hbElementBase = z.object({
  id: z.string().min(1),
  type: hbElementType,

  // هندسه
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  /** رادیان */
  angle: z.number(),

  // چیدمان
  /** ایندکس کسری برای ترتیب لایه — ADR-007. رشته است، نه عدد. */
  index: z.string(),
  frameId: z.string().nullable(),
  /** گروه‌بندی تودرتو؛ بیرونی‌ترین گروه آخر می‌آید. */
  groupIds: z.array(z.string()),
  locked: z.boolean(),

  // ظاهر
  strokeColor: z.string(),
  backgroundColor: z.string(),
  fillStyle: hbFillStyle,
  strokeWidth: z.number(),
  strokeStyle: hbStrokeStyle,
  /** هم‌بوم پیش‌فرض `0` = خط تمیز، نه دست‌نویس. */
  roughness: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  opacity: z.number().min(0).max(100),
  roundness: z
    .object({
      type: z.union([z.literal(2), z.literal(3)]),
      value: z.number().optional(),
    })
    .nullable(),

  // متادیتای موتور
  seed: z.number(),
  version: z.number().int(),
  versionNonce: z.number(),
  /** epoch ms */
  updated: z.number().int(),
  /** حذف نرم — عنصر می‌ماند تا undo و CRDT درست کار کنند. */
  isDeleted: z.boolean(),
  boundElements: z.array(z.object({ id: z.string(), type: z.enum(["text", "arrow"]) })).nullable(),
  link: z.string().nullable(),

  customData: hbCustomData,
});

// ─────────────────────────────────────────────────────────────
// عناصر بر اساس نوع رندر
// ─────────────────────────────────────────────────────────────

/** مستطیل، بیضی، لوزی — پایه‌ی هم `shape` و هم `sticky`. */
export const hbShapeElement = hbElementBase.extend({
  type: z.enum(["rectangle", "ellipse", "diamond"]),
});
export type HbShapeElement = z.infer<typeof hbShapeElement>;

/** متن — آزاد روی بوم یا مقید در یک ظرف. */
export const hbTextElement = hbElementBase.extend({
  type: z.literal("text"),
  /** اگر پر باشد، متن داخل این عنصر مقید است (استیکی، شکل با متن). */
  containerId: z.string().nullable(),
  /** متن بعد از wrap. منبع حقیقت `originalText` است. */
  text: z.string(),
  originalText: z.string(),
  fontSize: z.number().positive(),
  /** شناسه‌ی عددی فونت در رجیستری موتور. */
  fontFamily: z.number().int(),
  textAlign: hbTextAlign,
  verticalAlign: hbVerticalAlign,
  /** فارسی به فضای عمودی بیشتری نیاز دارد؛ پیش‌فرض هم‌بوم ۱٫۶ است. */
  lineHeight: z.number().positive(),
  /** ★ افزوده‌ی هم‌بوم — ADR-024. */
  direction: hbTextDirection,
  autoResize: z.boolean(),
});
export type HbTextElement = z.infer<typeof hbTextElement>;

/** پیکان و خط — پایه‌ی `connector`. */
export const hbLinearElement = hbElementBase.extend({
  type: z.enum(["arrow", "line"]),
  points: z.array(hbPoint),
  startBinding: z
    .object({
      elementId: z.string(),
      focus: z.number(),
      gap: z.number(),
    })
    .nullable(),
  endBinding: z
    .object({
      elementId: z.string(),
      focus: z.number(),
      gap: z.number(),
    })
    .nullable(),
  startArrowhead: hbArrowhead,
  endArrowhead: hbArrowhead,
  /** مسیریابی پله‌ای (میرو-استایل). */
  elbowed: z.boolean(),
});
export type HbLinearElement = z.infer<typeof hbLinearElement>;

/** قلم آزاد — ADR-022: فقط نتیجه‌ی نهایی اینجا می‌آید، نه استروک در حال کشیدن. */
export const hbDrawElement = hbElementBase.extend({
  type: z.literal("freedraw"),
  points: z.array(hbPoint),
  pressures: z.array(z.number()),
  simulatePressure: z.boolean(),
});
export type HbDrawElement = z.infer<typeof hbDrawElement>;

/** تصویر — باینری هرگز اینجا نیست، فقط ارجاع به `assets`. */
export const hbImageElement = hbElementBase.extend({
  type: z.literal("image"),
  /** کلید در `Y.Map("assets")` — PLAN بخش ۷٫۱. */
  fileId: z.string(),
  scale: z.tuple([z.number(), z.number()]),
  status: z.enum(["pending", "saved", "error"]),
  crop: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      naturalWidth: z.number(),
      naturalHeight: z.number(),
    })
    .nullable(),
});
export type HbImageElement = z.infer<typeof hbImageElement>;

/** فریم — عضویت با `frameId` روی فرزندان اعلام می‌شود، نه با فهرست اینجا. */
export const hbFrameElement = hbElementBase.extend({
  type: z.literal("frame"),
  name: z.string(),
});
export type HbFrameElement = z.infer<typeof hbFrameElement>;

/**
 * هر عنصر بوم.
 *
 * تفکیک روی `type` است نه `kind` — چون `sticky` و `shape` هر دو `rectangle` اند
 * و تفاوتشان محصولی است، نه رندری (ADR-010).
 */
export const hbElement = z.discriminatedUnion("type", [
  hbShapeElement,
  hbTextElement,
  hbLinearElement,
  hbDrawElement,
  hbImageElement,
  hbFrameElement,
]);
export type HbElement = z.infer<typeof hbElement>;

// ─────────────────────────────────────────────────────────────
// وضعیت مشترک بورد
// ─────────────────────────────────────────────────────────────

/** وضعیتی که بین همه‌ی کاربران یک بورد مشترک است — PLAN بخش ۷٫۱. */
export const hbAppState = z.object({
  viewBackgroundColor: z.string(),
  gridSize: z.number().int().positive().nullable(),
  gridEnabled: z.boolean(),
  snapToObjects: z.boolean(),
  frameRendering: z.object({
    enabled: z.boolean(),
    name: z.boolean(),
    outline: z.boolean(),
    clip: z.boolean(),
  }),
});
export type HbAppState = z.infer<typeof hbAppState>;
