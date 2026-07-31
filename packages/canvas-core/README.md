# @hamboom/canvas-core

موتور بومِ هم‌بوم — رندر، عناصر، ابزارها و قراردادِ همگام‌سازی. ماژول **M1**.

این پکیج **کاملاً آفلاین** است: هیچ شبکه‌ای، هیچ Yjs، هیچ احراز هویتی. تنها راهِ
ارتباط با دنیای بیرون، پیاده‌سازیِ `CanvasSyncAdapter` است که ماژولِ همگام‌سازی
(M2) فراهم می‌کند. این مرز با ESLint اعمال می‌شود (`canvasCoreBoundaries`).

```
┌──────────────────┐   ElementChangeSet   ┌─────────────────┐
│   canvas-core    │ ───────────────────▶ │  SyncAdapter    │
│   (این پکیج)     │ ◀─────────────────── │   (ماژول M2)    │
└──────────────────┘   PeerState، وضعیت    └─────────────────┘
      بدون شبکه                                 با شبکه
```

## مصرفِ پکیج

پکیجِ داخلیِ مونوریپو است (JIT — بدون build، `exports` مستقیم به `src/*.ts`).
مصرف‌کننده‌ها آن را workspace می‌گیرند و خودشان (با Vite) transpile می‌کنند:

```jsonc
// package.json مصرف‌کننده
{
  "dependencies": {
    "@hamboom/canvas-core": "workspace:*"
  }
}
```

- **peer:** `react@^19` و `react-dom@^19`.
- دو نقطه‌ی ورود: `@hamboom/canvas-core` (بوم، عناصر، ابزارها، رابط) و
  `@hamboom/canvas-core/sync` (فقط قرارداد + آداپتورِ لوکال).

### ★ پیش‌نیازِ اجباری — مسیرِ دارایی‌ها (اصل P2)

Excalidraw اگر `window.EXCALIDRAW_ASSET_PATH` ست نشده باشد، فونت‌هایش را **بی‌صدا**
از `esm.sh` دانلود می‌کند — نقضِ P2 و غیرقابل‌اتکا از داخل ایران. بوم اگر این تنظیم
نباشد **صریح خطا می‌دهد** (به‌جای دانلودِ خاموش). دو کار لازم است:

1. اسکریپتِ کپیِ فونت‌ها اجرا شود (هوکِ `predev`/`prebuild:demo` این کار را می‌کند):
   ```bash
   node scripts/copy-excalidraw-fonts.mjs
   ```
2. قبل از اولین رندرِ بوم، مسیرِ پایه ست شود:
   ```ts
   import { configureExcalidrawAssetPath } from "@hamboom/canvas-core";
   configureExcalidrawAssetPath("/excalidraw-assets/"); // که fonts/ زیرِ آن سرو می‌شود
   ```

## مثالِ حداقلی

```tsx
import { useRef } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import {
  HamboomCanvas,
  configureExcalidrawAssetPath,
  createSticky,
  toExcalidraw,
  commitGesture,
} from "@hamboom/canvas-core";

configureExcalidrawAssetPath("/excalidraw-assets/"); // یک‌بار، قبل از رندر

export function Board() {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);

  function addSticky() {
    const api = apiRef.current;
    if (!api) return;
    // سازنده‌ی خالص → عناصرِ HbElement؛ toExcalidraw آن‌ها را به عنصرِ موتور نگاشت می‌کند.
    const { elements } = createSticky({ x: 0, y: 0, text: "سلام", authorId: "u_1" });
    // ★ یک ژستِ کاربر = یک نوشتنِ IMMEDIATELY (یک ورودیِ undo) — ADR-026.
    //   آرگومانِ دوم آرایه‌ی آماده‌ی موتور است؛ سومی انتخابِ پس از نوشتن.
    const next = [...api.getSceneElements(), ...elements.map(toExcalidraw)];
    commitGesture(api, next, { select: elements.map((e) => e.id) });
  }

  return (
    <div style={{ inlineSize: "100%", blockSize: "100dvh" }}>
      <button type="button" onClick={addSticky}>استیکیِ نو</button>
      <HamboomCanvas onReady={(api) => (apiRef.current = api)} />
    </div>
  );
}
```

## props — `HamboomCanvasProps`

| prop | نوع | پیش‌فرض | شرح |
|---|---|---|---|
| `onReady` | `(api: ExcalidrawImperativeAPI) => void` | — | وقتی موتور آماده شد با دسته‌ی امری‌اش صدا زده می‌شود؛ نقطه‌ی خواندن/نوشتنِ صحنه، تعویضِ ابزار، و شنیدنِ رویدادها. |
| `viewModeEnabled` | `boolean` | `false` | فقط-خواندنی. در محصول به `CanvasPermissions.canEdit` وصل می‌شود. |
| `langCode` | `string` | `"fa-IR"` | کدِ زبانِ رابطِ موتور (رابطِ فارسیِ خودمان جای آن را می‌گیرد). |
| `defaultDirection` | `"rtl" \| "ltr"` | `"rtl"` | جهتِ پیش‌فرض **فقط** برای عناصرِ بدونِ حرفِ قوی؛ متنِ واقعی جهتش را از محتوای خودش می‌گیرد (ADR-024). |

## اتصال به همگام‌سازی

بوم با دنیای بیرون فقط از راهِ `CanvasSyncAdapter` حرف می‌زند. برای توسعه و تست،
[`@hamboom/canvas-core/sync`](src/sync/) یک `LocalSyncAdapter` کاملاً درون‌حافظه‌ای
دارد (بدونِ I/O) که چند نمونه می‌توانند به یک `LocalSyncHub` وصل شوند:

```ts
import { LocalSyncAdapter, LocalSyncHub } from "@hamboom/canvas-core/sync";

const hub = new LocalSyncHub();
const adapter = new LocalSyncAdapter({ hub, user: { id: "u_1", displayName: "…", color: "#5B8DEF" } });
const outbound = await adapter.connect(inbound); // inbound را بوم/بایندر می‌دهد
```

قرارداد، چرخه‌ی عمر، نگهبانِ حلقه‌ی echo، و فهرستِ کاملِ «آنچه M2 باید پیاده کند»
در [`src/sync/README.md`](src/sync/README.md) است.

## قواعدِ مصرف (که به‌سادگی فراموش می‌شوند)

- **`element.type` را مستقیم نخوان** — همیشه `getKind(element)`. استیکی و شکل هر دو
  از دیدِ موتور `rectangle`اند؛ فرقشان در `customData.hb.kind` است (ADR-010).
- **هر نوشتنِ صحنه از `commitGesture` (کاربر) یا `commitSystemUpdate` (سیستم/remote)** —
  یک ژستِ کاربر = یک `captureUpdate: "IMMEDIATELY"` = یک undo (ADR-026).
- **هر جهشِ عنصر از `bumpVersion()`** (هم `version` هم `versionNonce`)، وگرنه موتور
  تغییر را برای undo ثبت نمی‌کند — باگِ خاموش.
- **از `@excalidraw/excalidraw` مستقیم import نکن** (به‌جز `engine/` و
  `elements/mapping.ts`)؛ هرچه از موتور لازم است از بارلِ همین پکیج عبور می‌کند.
- مختصاتِ بوم **هرگز آینه نمی‌شود** — RTL فقط برای متنِ داخلِ عناصر و لایه‌ی
  [`ui/`](src/ui/) است، نه هندسه (P6).

## دستورها

```bash
pnpm --filter @hamboom/canvas-core dev            # دموی لوکال روی 127.0.0.1:5180
pnpm --filter @hamboom/canvas-core test           # vitest یک‌بار
pnpm --filter @hamboom/canvas-core test:coverage  # پوشش + گیتِ ۶۰٪ روی elements/text/sync
pnpm --filter @hamboom/canvas-core typecheck
pnpm --filter @hamboom/canvas-core lint
```

## وضعیت

- **پله‌ی [ADR-003](../../ARCHITECTURE_DECISIONS.md#adr-003): A** (بسته‌ی npm، بدون patch/fork) —
  `ENGINE_STAGE = "npm"`. spikeِ فارسی ثابت کرد patch لازم نیست ([ADR-025](../../ARCHITECTURE_DECISIONS.md#adr-025)).
- فازهای ۰–۵ کامل (اسکلت، متنِ فارسی، مدلِ داده، عناصر، رابطِ RTL، تعامل و صیقل).
  فازِ ۶ (تحویل) در جریان. جزئیات در [PROGRESS.md](../../PROGRESS.md).
- **کارایی:** بومِ ۲۰۰۰ عنصری در استفاده‌ی واقعی ۱۴۴fps، صفر jank
  ([docs/perf-baseline.md](../../docs/perf-baseline.md)).

## مستندات

- [CLAUDE.md](CLAUDE.md) — قواعدِ کار روی این پکیج + تله‌های موتور
- [src/sync/README.md](src/sync/README.md) — قراردادِ تحویل به M2
- [../../PLAN.md](../../PLAN.md) بخشِ ۷ — مدلِ داده‌ی عناصر
- [../../ARCHITECTURE_DECISIONS.md](../../ARCHITECTURE_DECISIONS.md) — تصمیماتِ فنی
- [../../docs/dependencies.md](../../docs/dependencies.md) — وابستگی‌ها و لایسنس‌ها

## لایسنس

MIT — بخشی از پروژه‌ی هم‌بوم.
