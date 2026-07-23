/**
 * Stub حداقلی canvas برای jsdom.
 *
 * **چرا لازم است:** Excalidraw در زمان **لود ماژول** (نه رندر) روی یک canvas
 * موقت `getContext("2d")` می‌زند. jsdom این را پیاده نکرده و `null` برمی‌گرداند،
 * پس هر تستی که چیزی از `@hamboom/canvas-core` import کند در زمان collect می‌ترکد.
 *
 * ── دو تله که این فایل قبلاً در آن‌ها افتاد ────────────────────────────
 *
 * ۱. **نسخه‌ی اول یک آبجکت ساده برمی‌گرداند** که `fillText` را به‌عنوان own
 *    property داشت. نتیجه: کدی که `CanvasRenderingContext2D.prototype.fillText`
 *    را wrap می‌کند (`engine/canvas-direction.ts`) هرگز در زنجیره قرار نمی‌گرفت.
 *
 * ۲. **jsdom اصلاً `CanvasRenderingContext2D` را تعریف نمی‌کند.** پس حتی با
 *    زنجیره‌ی درست هم هدفی برای wrap کردن وجود نداشت. این فایل خودش آن
 *    سازنده را می‌سازد تا API مرورگر شبیه‌سازی شود.
 *
 * ── مرز صریح این stub ─────────────────────────────────────────────────
 *
 * این **رندر واقعی نمی‌کند**. هیچ پیکسلی کشیده نمی‌شود و `measureText` عددی
 * ساختگی و قطعی می‌دهد که هیچ ربطی به فونت واقعی ندارد.
 *
 * پس این‌ها را **هرگز** نمی‌شود با تست jsdom آزمود:
 *   - اندازه‌گیری و شکست خط متن (فارسی یا غیر آن)
 *   - شکل‌دهی حروف و ترتیب bidi
 *   - هر چیزی که به پیکسل واقعی وابسته است
 *
 * آنچه **می‌شود** آزمود: اینکه wrapper ها در زنجیره‌ی prototype قرار می‌گیرند و
 * مقدار درستی ست می‌کنند. تایید خروجی بصری فقط در مرورگر واقعی — صفحه‌های
 * `#spike` و `#spike-edit` و `docs/spike-persian-text.md`.
 */

/** عرض ساختگی هر کاراکتر — عمداً گرد و غیرواقعی تا کسی جدی‌اش نگیرد. */
const FAKE_CHAR_WIDTH = 10;

/**
 * سازنده‌ی `CanvasRenderingContext2D` را برمی‌گرداند و اگر jsdom آن را نداشت،
 * یک معادل حداقلی می‌سازد و روی `globalThis` می‌گذارد.
 *
 * `fillText`/`strokeText` عمداً روی **prototype** می‌نشینند، نه روی نمونه —
 * تا کد محصولی که prototype را wrap می‌کند واقعاً آزموده شود.
 */
let contextConstructorReady = false;

function ensureContextConstructor(): { prototype: Record<string, unknown> } {
  const existing = (globalThis as Record<string, unknown>).CanvasRenderingContext2D as
    { prototype: Record<string, unknown> } | undefined;

  if (existing?.prototype) {
    // ⚠️ فقط **یک‌بار**. نسخه‌ی قبلی این کار را در هر ساخت context تکرار می‌کرد
    // و چون `createFake2dContext` هم این تابع را صدا می‌زند، هر بار
    // `prototype.fillText` را روی noop برمی‌گرداند — یعنی wrapper ای که تست
    // همان لحظه نصب کرده بود پاک می‌شد و تست بی‌دلیل شکست می‌خورد.
    if (!contextConstructorReady) {
      // jsdom این متدها را پیاده نکرده و صدا زدنشان خطا می‌دهد.
      existing.prototype.fillText = () => undefined;
      existing.prototype.strokeText = () => undefined;
      contextConstructorReady = true;
    }
    return existing;
  }

  class FakeCanvasRenderingContext2D {
    fillText(): void {}
    strokeText(): void {}
  }

  (globalThis as Record<string, unknown>).CanvasRenderingContext2D = FakeCanvasRenderingContext2D;
  contextConstructorReady = true;

  return FakeCanvasRenderingContext2D as unknown as { prototype: Record<string, unknown> };
}

function createFake2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const noop = () => undefined;
  const Ctor = ensureContextConstructor();

  // ارث‌بری واقعی از prototype — نکته‌ی کلیدی این فایل.
  const context = Object.assign(Object.create(Ctor.prototype as object) as object, {
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
    // ★ fillText و strokeText عمداً اینجا نیستند — روی prototype می‌مانند.
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
  });

  return context as unknown as CanvasRenderingContext2D;
}

/** نصب stub. چندبار صدا زدن بی‌ضرر است. */
export function installCanvasStub(): void {
  ensureContextConstructor();

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
