import type { HbElement, HbKind, HbTextDirection } from "@hamboom/shared-types";

/**
 * نگاشت دوطرفه بین عنصر هم‌بوم و عنصر موتور رندر.
 *
 * ⚠️ **این تنها فایلی است که اجازه دارد روی `element.type` شرط بگذارد**
 * ([ADR-010](../../../../ARCHITECTURE_DECISIONS.md#adr-010)). یک قاعده‌ی ESLint
 * بقیه‌ی کد را مجبور می‌کند از {@link getKind} استفاده کنند.
 *
 * ── چرا `direction` جابه‌جا می‌شود ────────────────────────────────────
 *
 * `direction` یک افزوده‌ی هم‌بوم است ([ADR-024](../../../../ARCHITECTURE_DECISIONS.md#adr-024))
 * و موتور آن را نمی‌شناسد. تنها فیلدی که موتور تضمین می‌کند دست‌نخورده نگه
 * دارد `customData` است، پس در مسیر رفت داخل `customData.hb.direction` گذاشته
 * می‌شود و در مسیر برگشت به سطح بالا برمی‌گردد.
 *
 * نتیجه: schema در `shared-types` خوانا و تخت می‌ماند (کار با
 * `element.direction`)، ولی نمایش ذخیره‌شده جایی است که قطعاً زنده می‌ماند.
 * این دقیقاً کاری است که یک لایه‌ی نگاشت باید بکند.
 */

/** شکل حداقلی عنصر موتور که این ماژول با آن کار می‌کند. */
type EngineElement = Record<string, unknown> & {
  type: string;
  customData?: Record<string, unknown>;
};

/** `customData.hb` بعد از عبور از موتور — همه‌ی فیلدها ممکن است نباشند. */
interface EngineHbData {
  kind?: HbKind;
  direction?: HbTextDirection;
  [key: string]: unknown;
}

/**
 * نگاشت نوع رندر به معنای محصولی، برای عناصری که هم‌بوم نساخته.
 *
 * لازم است چون نوار ابزار خودِ موتور هم عنصر می‌سازد و آن‌ها `customData`
 * ندارند. بدون این، هر شکلی که کاربر با ابزار پیش‌فرض بکشد «بدون kind»
 * می‌شد و منطق محصولی رویش کار نمی‌کرد.
 */
const KIND_BY_TYPE: Readonly<Record<string, HbKind>> = {
  rectangle: "shape",
  ellipse: "shape",
  diamond: "shape",
  line: "shape",
  arrow: "connector",
  text: "text",
  freedraw: "draw",
  image: "image",
  frame: "frame",
  magicframe: "frame",
  embeddable: "embed",
  iframe: "embed",
};

/** معنای محصولی یک عنصر — پیش‌فرض `shape` برای نوع ناشناخته. */
export function getKind(element: { type: string; customData?: unknown }): HbKind {
  const hb = (element.customData as { hb?: EngineHbData } | undefined)?.hb;
  if (hb?.kind) return hb.kind;
  return KIND_BY_TYPE[element.type] ?? "shape";
}

/** آیا این عنصر یک استیکی‌نوت است؟ از دید موتور فقط یک مستطیل است. */
export function isSticky(element: { type: string; customData?: unknown }): boolean {
  return getKind(element) === "sticky";
}

/** جهت متن یک عنصر، اگر داشته باشد. */
export function getDirection(element: {
  customData?: unknown;
  direction?: unknown;
}): HbTextDirection | undefined {
  if (typeof element.direction === "string") return element.direction as HbTextDirection;
  const hb = (element.customData as { hb?: EngineHbData } | undefined)?.hb;
  return hb?.direction;
}

/**
 * عنصر هم‌بوم → عنصر موتور.
 *
 * `direction` از سطح بالا به `customData.hb` منتقل می‌شود تا از serialization
 * موتور جان سالم به در ببرد.
 */
export function toExcalidraw(element: HbElement): EngineElement {
  const { customData, ...rest } = element;
  const direction = "direction" in element ? element.direction : undefined;

  const mapped: EngineElement = {
    ...(rest as unknown as EngineElement),
    customData: {
      ...customData,
      hb: {
        ...customData.hb,
        ...(direction === undefined ? {} : { direction }),
      },
    },
  };

  // در سطح بالا می‌ماند تا کد بوم بدون رفتن سراغ customData هم بخواندش،
  // ولی منبع پایدارش همان customData است.
  return mapped;
}

/**
 * عنصر موتور → عنصر هم‌بوم.
 *
 * ⚠️ **اعتبارسنجی نمی‌کند.** خروجی از نظر تایپ `HbElement` است ولی اگر عنصر
 * ورودی از موتور ناقص باشد (مثلاً ساخته‌ی نوار ابزار پیش‌فرض بدون `customData`)
 * فیلدهای هم‌بوم با مقدار پیش‌فرض پر می‌شوند. برای اعتبارسنجی واقعی از
 * `hbElement.parse` در `shared-types` استفاده کن.
 */
export function fromExcalidraw(element: EngineElement): HbElement {
  const rawHb = (element.customData as { hb?: EngineHbData } | undefined)?.hb;
  const direction = getDirection(element as { customData?: unknown; direction?: unknown });

  // ★ `direction` از `customData.hb` **برداشته** می‌شود، نه فقط کپی.
  //   اگر هر دو جا بماند دو منبع حقیقت داریم و همان چیزی می‌شود که این لایه
  //   قرار بود جلویش را بگیرد — تست round-trip دقیقاً همین را گرفت.
  const { direction: _hoisted, ...hbWithoutDirection } = rawHb ?? {};

  const result = {
    ...element,
    customData: {
      ...(element.customData ?? {}),
      hb: {
        schema: 1,
        kind: getKind(element),
        createdBy: "",
        lastEditedBy: "",
        createdAt: 0,
        ...hbWithoutDirection,
      },
    },
  } as Record<string, unknown>;

  // `direction` فقط روی عناصر متنی معنا دارد؛ روی بقیه اضافه نمی‌شود.
  if (element.type === "text") {
    result.direction = direction ?? "auto";
  }

  return result as unknown as HbElement;
}
