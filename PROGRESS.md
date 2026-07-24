# PROGRESS — canvas-core

تاریخ آخرین به‌روزرسانی: ۱۴۰۵/۰۵/۰۲ (2026-07-24)
**گام فعلی: ۳٫۵ تمام و کامیت شد → بعدی ۳٫۶ (تصویر) — هنوز شروع نشده**
پله‌ی [ADR-003](ARCHITECTURE_DECISIONS.md#adr-003): **A** (بسته npm، بدون patch)

**۳۳۸ تست سبز** (۴۴ shared-types، ۲۹۴ canvas-core). `typecheck` · `lint` ·
`format:check` · `license:check` (self-test ۱۷/۱۷ + ۵۸۱ پکیج) — همه سبز.
درخت git تمیز، همه‌چیز کامیت شده.

---

## گام‌های تمام‌شده

| گام | چه شد | commit |
|---|---|---|
| ۰٫۱ | اسکلت مونوریپو، گیت لایسنس سه‌سطحی با self-test | `d697903` |
| — | `.gitattributes` (eol=lf) | `767b15c` |
| ۰٫۲ | پکیج canvas-core + دموی Vite + Vitest | `b83f821` |
| ۱٫۱–۱٫۳ | نصب موتور، spike متن فارسی | `f8aba4f` |
| ۱٫۳ب | تکمیل spike: ویرایش inline، کلیپ‌بورد، اعداد | `b32151f` |
| ۱٫۴ | لایه‌ی متن فارسی — جهت، نرمال‌سازی، wrapper `fillText` (بدون patch) | `60e5bbf`, `085938f` |
| ۲٫۱–۲٫۲ | `shared-types` (انواع عنصر + zod)، قرارداد `CanvasSyncAdapter` | `77e988c` |
| ۲٫۳ | نگاشت دوطرفه `toExcalidraw`/`fromExcalidraw`/`getKind` + قاعده‌ی ADR-010 | `38af038` |
| — | تک‌منبعی کردن واقعی `direction` (فیکس باگ round-trip) | `eafc07a` |
| ۳٫۱ | پالت استیکی، توکن‌ها، گیت کنتراست WCAG خودآزموده | `e6be078` |
| ۳٫۲ | استیکی‌نوت — سازنده، autoFit، تغییر رنگ، ابزار، میانبر | `592f1a6` |
| ۳٫۳ | شکل، متن آزاد، پنل استایل RTL، `factory.ts` مشترک | `7f924e7` |
| ۳٫۴ | کانکتور — مسیریابی قطعی (ADR-008)، reroute هنگام حرکت | `1a8b0f2` |
| ۳٫۵ | فریم — عضویت، حرکت یک‌ژستی، undo یک‌باره (ADR-026)، `bumpVersion` | `f43cfba` |

---

## ⚠️ تاییدهای معلق (تعامل واقعی مرورگر لازم است)

این‌ها منطقاً درست‌اند و تست واحد دارند، ولی با **تعامل واقعی کاربر در مرورگر**
هنوز تایید نشده‌اند. jsdom هیچ‌کدام را نمی‌گیرد.

- [ ] ★ **سناریوی «تغییر رنگ استیکی → Ctrl+Z → رنگ برمی‌گردد».** فقط سناریوی
      فریم/حرکت با undo واقعی تایید شده (گام ۳٫۵). چون فیکس `bumpVersion` در
      همان گام همه‌ی جهش‌دهنده‌ها را پوشش داد (`applyStickyPalette`,
      `applyStyle` هم)، **انتظار می‌رود** تغییر رنگ هم درست undo شود — ولی
      مسیر رنگ **مستقیماً** با Ctrl+Z واقعی آزموده نشده. باید در گام ۶٫۱ (یا
      هر وقت مرورگر در دسترس بود) بسته شود.
- [ ] تایید بصری ترتیب bidi روی `#spike` (از گام ۱٫۳) — تنها موردی که عددی
      اثبات شد ولی چشمی نه.
- [ ] تایید بصری هماهنگی رنگ‌های پالت (زیبایی‌شناختی، گام ۳٫۱).

**گپ‌های ثبت‌شده برای M2/6٫۱** (در `sync/README.md` و TODO گام ۶٫۱):
G-1 تست دو-نمونه‌ای با binder واقعی · G-2 تست رگرسیون هش پیکسلی جهت متن.

---

## تصمیم‌های کلیدی که باید یادت بماند

- **`type` رندر ≠ `kind` محصولی** (ADR-010). استیکی و شکل هر دو `rectangle` اند.
  هیچ‌جا بیرون از `elements/mapping.ts` روی `element.type` شرط نگذار — قاعده‌ی
  ESLint می‌گیرد. همیشه `getKind(element)`.
- **`direction` تک‌منبعی است** — فقط در `customData.hb`، نه سطح بالای عنصر موتور.
- **هر جهش عنصر باید `bumpVersion()` بزند** (هم `version` هم `versionNonce`)،
  وگرنه موتور تغییر را برای undo ثبت نمی‌کند (ADR-026). باگ خاموش.
- **یک ژست = یک `updateScene({ captureUpdate: "IMMEDIATELY" })`** (ADR-026).
  `applyRemoteChanges` در M2 باید `"NEVER"` بدهد (مکمل نگهبان echo).
- **مسیر کانکتور حالت مشتق‌شده است** (ADR-008) — قطعی، فقط `+−×÷` و `Math.round`،
  بدون `Math.hypot`/`atan2`/`toFixed`.
- **پنج تله‌ی موتوری** در جدول `packages/canvas-core/CLAUDE.md` — همه فقط در
  مرورگر قابل کشف، نه jsdom.
- **`normalizePersian` در `shared-types` است**، نه canvas-core — قرارداد
  بین‌ماژولی. `normalizePersianPreservingLength` برای زمان تایپ (حفظ طول مکان‌نما).

---

## قدم بعدی — گام ۳٫۶ (تصویر)

هنوز **شروع نشده**. طبق TODO:
- افزودن تصویر با drag&drop و paste
- `outbound.requestAssetUpload(file)` + نمایش placeholder تا آماده شدن
- `resolveAssetUrl(fileId)` + کش در حافظه
- محدودیت سمت کلاینت: حداکثر ۲۰MB، فقط `image/png|jpeg|webp|gif|svg+xml`
- در `local-adapter` با `URL.createObjectURL` شبیه‌سازی

بعد از ۳٫۶: گام ۳٫۷ (قلم آزاد با کانال ephemeral، ADR-022) → پایان فاز ۳.
