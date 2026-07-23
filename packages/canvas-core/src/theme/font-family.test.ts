import { FONT_FAMILY } from "@excalidraw/excalidraw";
import { describe, expect, it } from "vitest";

import { HB_FONT_FAMILY, HB_FONT_NAME } from "./tokens";

/**
 * ★ `theme/` عمداً از موتور import نمی‌کند تا لایه تمیز بماند، پس شناسه‌ی فونت
 * آنجا یک عدد ثابت است. این تست تنها چیزی است که جلوی جدا شدن آن عدد از
 * مقدار واقعی موتور را می‌گیرد.
 *
 * بدون این، یک ارتقای نسخه‌ی موتور می‌توانست شماره‌ها را جابه‌جا کند و همه‌ی
 * متن‌های ما بی‌صدا با فونت دیگری رندر شوند — چیزی که نه build می‌شکند نه
 * خطا می‌دهد، فقط ظاهر عوض می‌شود.
 */
describe("شناسه‌ی فونت با موتور هم‌خوان است", () => {
  it("HB_FONT_FAMILY همان FONT_FAMILY.Excalifont است", () => {
    expect(HB_FONT_FAMILY).toBe(FONT_FAMILY.Excalifont);
  });

  it("نام خانواده با کلید رجیستری موتور می‌خواند", () => {
    expect(Object.keys(FONT_FAMILY)).toContain(HB_FONT_NAME);
  });
});
