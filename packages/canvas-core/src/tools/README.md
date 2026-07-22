# tools/

ابزارهای تعاملی بوم — هر ابزار یک ماشین حالت روی رویدادهای اشاره‌گر.

**اینجا می‌آید:** `sticky-tool.ts`, `shape-tool.ts`, `text-tool.ts`,
`connector-tool.ts`, `draw-tool.ts`, `frame-tool.ts`, `image-tool.ts`, `comment-pin-tool.ts`.

**قاعده‌ی ADR-022:** هر داده‌ای که «در حال شکل‌گیری» است — استروک قلم قبل از رها شدن،
پیش‌نمایش کشیدن شکل، لیزر پوینتر — از `emitEphemeral` می‌رود و **هرگز** وارد سند نمی‌شود.
فقط نتیجه‌ی نهایی در `pointerup` یک‌بار commit می‌شود.

**قاعده‌ی throttle:** جدول فرکانس در [PLAN.md بخش ۷٫۴](../../../../PLAN.md) — درگ ۵۰ms،
مکان‌نما ۴۰ms، viewport ۱۰۰ms، تایپ ۱۵۰ms debounce. throttle در همین لایه اعمال می‌شود،
نه در آداپتور sync.

**گام TODO:** ۳٫۲ تا ۳٫۷
