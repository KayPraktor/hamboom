# ui/

رابط کاربری اطراف بوم — نوار ابزار، پنل‌ها، منوها، نشانگرها. همه RTL و فارسی.

**اینجا می‌آید:** `Toolbar.tsx`, `StylePanel.tsx`, `ContextMenu.tsx`,
`ZoomControls.tsx`, `MiniMap.tsx`, `PresenceBar.tsx`, `StatusBar.tsx`.

**قاعده‌ی ADR-016:** فقط logical properties — `margin-inline-start` نه `margin-left`،
`inset-inline-end` نه `right`. هیچ کلاس شرطی `rtl:` و هیچ stylesheet آینه‌ای.
یک قاعده‌ی ESLint روی style های inline این را چک می‌کند؛ نسخه‌ی CSS در گام ۴٫۱ اضافه می‌شود.

**استثنای مهم:** فضای مختصات بوم ریاضی است و RTL ندارد — `x` همیشه به راست افزایش می‌یابد.
RTL فقط به متنِ داخل عناصر و به همین پوشه مربوط است. این تفکیک را با هیچ «اصلاح»ی خراب نکن.

**گام TODO:** ۴٫۲ تا ۴٫۴
