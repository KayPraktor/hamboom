# elements/

سازنده، نرمال‌ساز و نگاشت انواع عنصر هم‌بوم.

**اینجا می‌آید:** `sticky.ts`, `shape.ts`, `text.ts`, `connector.ts`,
`connector-routing.ts`, `frame.ts`, `image.ts`, `draw.ts`, و `mapping.ts`
(`toExcalidraw` / `fromExcalidraw` / `getKind`).

**قاعده‌ی ADR-010:** هیچ کدی خارج از `mapping.ts` نباید روی `element.type` شرط بگذارد.
همیشه `getKind(element)` — چون `type` چیزی است که موتور رندر می‌فهمد و
`customData.hb.kind` چیزی است که محصول می‌فهمد. یک قاعده‌ی ESLint این را چک می‌کند (گام ۲٫۳).

**قاعده‌ی ADR-008:** `connector-routing.ts` باید یک تابع **خالص و قطعی** باشد —
بدون `Math.random`، بدون وابستگی به زمان، مختصات گردشده به ۲ رقم اعشار.
ورودی یکسان در دو مرورگر باید خروجی بیت‌به‌بیت یکسان بدهد.

**گام TODO:** ۲٫۳ و ۳٫۲ تا ۳٫۶
