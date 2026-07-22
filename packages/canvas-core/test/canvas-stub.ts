/**
 * Stub حداقلی برای `HTMLCanvasElement.getContext` در jsdom.
 *
 * **چرا لازم است:** Excalidraw در زمان **لود ماژول** (نه رندر) روی یک canvas
 * موقت `getContext("2d")` می‌زند تا قابلیت‌ها را تشخیص دهد. jsdom این را پیاده
 * نکرده و `null` برمی‌گرداند، پس هر تستی که چیزی از `@hamboom/canvas-core`
 * import کند در زمان collect می‌ترکد.
 *
 * ── مرز صریح این stub ─────────────────────────────────────────────────
 *
 * این **رندر واقعی نمی‌کند**. هیچ پیکسلی کشیده نمی‌شود و `measureText` یک عدد
 * ساختگی و قطعی برمی‌گرداند که هیچ ربطی به فونت واقعی ندارد.
 *
 * پس این‌ها را **هرگز** نمی‌شود با تست jsdom آزمود:
 *   - اندازه‌گیری و شکست خط متن (فارسی یا غیر آن)
 *   - شکل‌دهی حروف و ترتیب bidi
 *   - هر چیزی که به پیکسل واقعی وابسته است
 *
 * این‌ها باید در مرورگر واقعی آزموده شوند — spike گام ۱٫۳ و تست‌های گام ۶٫۱.
 * اگر روزی دیدی یک تست jsdom درباره‌ی عرض متن ادعایی می‌کند، آن تست دروغ می‌گوید.
 */

/** عرض ساختگی هر کاراکتر — عمداً گرد و غیرواقعی تا کسی جدی‌اش نگیرد. */
const FAKE_CHAR_WIDTH = 10;

function createFake2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const noop = () => undefined;

  const context = {
    canvas,
    // ویژگی‌هایی که کد بالادست وجودشان را چک می‌کند (`'filter' in ctx`)
    filter: "none",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    miterLimit: 10,
    lineDashOffset: 0,
    shadowBlur: 0,
    shadowColor: "rgba(0, 0, 0, 0)",
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    direction: "inherit",
    imageSmoothingEnabled: true,

    measureText: (text: string) => ({
      width: text.length * FAKE_CHAR_WIDTH,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: text.length * FAKE_CHAR_WIDTH,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
      fontBoundingBoxAscent: 8,
      fontBoundingBoxDescent: 2,
    }),

    save: noop,
    restore: noop,
    scale: noop,
    rotate: noop,
    translate: noop,
    transform: noop,
    setTransform: noop,
    resetTransform: noop,
    getTransform: () => new DOMMatrix(),
    clearRect: noop,
    fillRect: noop,
    strokeRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    bezierCurveTo: noop,
    quadraticCurveTo: noop,
    arc: noop,
    arcTo: noop,
    ellipse: noop,
    rect: noop,
    roundRect: noop,
    fill: noop,
    stroke: noop,
    clip: noop,
    isPointInPath: () => false,
    isPointInStroke: () => false,
    fillText: noop,
    strokeText: noop,
    drawImage: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => null,
    createImageData: (w: number, h: number) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
      colorSpace: "srgb",
    }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
      colorSpace: "srgb",
    }),
    putImageData: noop,
    setLineDash: noop,
    getLineDash: () => [] as number[],
  };

  return context as unknown as CanvasRenderingContext2D;
}

/** نصب stub روی prototype. چندبار صدا زدن بی‌ضرر است. */
export function installCanvasStub(): void {
  const proto = globalThis.HTMLCanvasElement?.prototype;
  if (!proto) return;

  proto.getContext = function getContext(this: HTMLCanvasElement, contextId: string) {
    // فقط 2d پشتیبانی می‌شود؛ برای webgl عمداً null برمی‌گردانیم تا کد بالادست
    // مسیر fallback خودش را برود، نه اینکه با یک context دروغین جلو برود.
    return contextId === "2d" ? createFake2dContext(this) : null;
  } as HTMLCanvasElement["getContext"];

  proto.toDataURL = () => "data:image/png;base64,";
  proto.toBlob = (callback: BlobCallback) => {
    callback(new Blob([], { type: "image/png" }));
  };
}
