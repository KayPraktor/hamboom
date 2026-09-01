import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useState, type ComponentProps } from "react";

import { defaultTextAlignFor, type TextDirection } from "../text/bidi";
import { assertAssetPathConfigured } from "./asset-path";
import { installCanvasTextDirection } from "./canvas-direction";
import { guardDocumentDirection } from "./document-direction-guard";
import { guardEditorDirection } from "./editor-direction";

import "@excalidraw/excalidraw/index.css";
// فونت‌ها بخشی از پکیج‌اند تا مصرف‌کننده نتواند فراموششان کند.
import "../theme/fonts.css";

export interface HamboomCanvasProps {
  /**
   * وقتی موتور آماده شد با دسته‌ی امری آن صدا زده می‌شود.
   * از اینجا می‌شود صحنه را خواند/نوشت، ابزار فعال را عوض کرد و رویدادها را شنید.
   */
  onReady?: (api: ExcalidrawImperativeAPI) => void;
  /** فقط-خواندنی — در گام ۴٫۴ به `CanvasPermissions.canEdit` وصل می‌شود. */
  viewModeEnabled?: boolean;
  /** کد زبان رابط موتور. فارسی در گام ۴٫۲ با رابط خودمان جایگزین می‌شود. */
  langCode?: string;
  /**
   * جهت پیش‌فرض بورد — فقط برای عناصری که هیچ حرف قوی‌ای ندارند.
   * متن‌های واقعی جهتشان از محتوای خودشان می‌آید (ADR-024).
   */
  defaultDirection?: TextDirection;
  /**
   * موقعیتِ مکان‌نمای محلی در مختصاتِ **صحنه** — برای کانالِ حضور.
   *
   * ★ موتور `onPointerUpdate` را از قبل در مختصاتِ **صحنه** می‌دهد، پس مصرف‌کننده
   *   بی هیچ تبدیلِ پیکسل→صحنه آن را emit می‌کند. این propِ نازک همان گپِ ثبت‌شده‌ی
   *   M2 (§۴) را می‌بندد: دیگر لازم نیست اپ فرمولِ معکوس را از نو بنویسد (ADR-024).
   */
  onPointerUpdate?: (pointer: { x: number; y: number }) => void;
}

/**
 * پوسته‌ی هم‌بوم روی موتور رندر Excalidraw.
 *
 * در گام ۱٫۱ این کامپوننت عمداً نازک است: فقط موتور را با تضمین‌های
 * زیرساختی هم‌بوم بالا می‌آورد. لایه‌های محصولی (عناصر، ابزارها، رابط RTL)
 * در فازهای ۲ تا ۴ روی همین نقطه می‌نشینند.
 *
 * **قواعدی که همین‌جا اعمال می‌شوند:**
 * - اصل P2 — اگر مسیر دارایی‌ها ست نشده باشد، به‌جای دانلود بی‌صدا از CDN
 *   خارجی، صریح خطا می‌دهد.
 * - [ADR-017](../../../../ARCHITECTURE_DECISIONS.md#adr-017) — بوم تا آماده
 *   شدن فونت‌ها رندر نمی‌شود، وگرنه عرض متن با فونت fallback اندازه‌گیری
 *   می‌شود و بعداً می‌پرد.
 *
 * @see ../../../../TODO.md گام ۱٫۱
 */
export function HamboomCanvas({
  onReady,
  viewModeEnabled = false,
  langCode = "fa-IR",
  defaultDirection = "rtl",
  onPointerUpdate,
}: HamboomCanvasProps) {
  // اگر مسیر دارایی‌ها ست نشده باشد باید همین اول بشکند، نه اینکه بی‌صدا
  // از اینترنت فونت بگیرد. throw داخل بدنه‌ی رندر تا error boundary بگیردش.
  assertAssetPathConfigured();

  const [fontsReady, setFontsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // ADR-017 — اندازه‌گیری متن روی canvas باید بعد از لود فونت انجام شود.
    void document.fonts.ready.then(() => {
      if (!cancelled) setFontsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Excalidraw جهت و زبان کل سند را عوض می‌کند؛ اثرش خنثی می‌شود.
  useEffect(() => guardDocumentDirection(), []);

  // ADR-024 — سومین مصرف‌کننده‌ی جهت: ویرایشگر inline. موتور روی آن `dir="auto"`
  // می‌گذارد که «اولین حرف قوی» را ملاک می‌گیرد؛ اگر با بوم هم‌راستا نشود، متن
  // هنگام ورود و خروج از ویرایش می‌پرد.
  useEffect(() => guardEditorDirection(), []);

  // ADR-023/ADR-025 — موتور `ctx.direction` را ست نمی‌کند، پس متن فارسی با جهت
  // پایه‌ی LTR چیده می‌شود. باید **قبل از اولین رندر** نصب شود، نه در یک effect —
  // موتور عناصر را کش می‌کند و متنی که یک‌بار اشتباه کشیده شد دوباره کشیده نمی‌شود.
  installCanvasTextDirection();

  if (!fontsReady) {
    return (
      <div className="hb-canvas-loading" role="status" aria-live="polite">
        در حال آماده‌سازی بوم…
      </div>
    );
  }

  // ★ payloadِ موتور در مختصاتِ صحنه است؛ فقط `{x,y}` را به مصرف‌کننده می‌دهیم.
  const handlePointer: ComponentProps<typeof Excalidraw>["onPointerUpdate"] = onPointerUpdate
    ? (payload) => onPointerUpdate({ x: payload.pointer.x, y: payload.pointer.y })
    : undefined;

  return (
    <Excalidraw
      excalidrawAPI={onReady}
      viewModeEnabled={viewModeEnabled}
      langCode={langCode}
      detectScroll={false}
      onPointerUpdate={handlePointer}
      initialData={{
        appState: {
          // spike گام ۱٫۳ب: `text-align` ویرایشگر inline از همین مقدار می‌آید و
          // پیش‌فرض موتور `"left"` است — یعنی متن فارسی چپ‌چین. مقدار منطقی از
          // `defaultTextAlignFor` می‌آید تا با بقیه‌ی لایه‌ها یک منبع داشته باشد.
          currentItemTextAlign: defaultTextAlignFor(defaultDirection),
          // گام ۵٫۱ — snap به عناصر + خطوطِ راهنمای هم‌ترازی هنگام درگ، به‌صورت
          // پیش‌فرض روشن (سبکِ میرو). snap به شبکه با `gridModeEnabled` جداست و
          // در دمو با یک toggle آزمودنی است.
          objectsSnapModeEnabled: true,
        },
      }}
    />
  );
}
