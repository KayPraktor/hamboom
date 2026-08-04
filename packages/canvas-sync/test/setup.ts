// ⚠️ stub از **خودِ canvas-core** قرض گرفته می‌شود، نه کپی (ADR-024 — یک منطق،
// یک منبع). آن فایل ۱۷۶ خط است و دو تله‌ی مستندشده دارد (زنجیره‌ی prototype، و
// نبودِ `CanvasRenderingContext2D` در jsdom)؛ نسخه‌ی دومش قطعاً واگرا می‌شد.
//
// چرا مسیرِ نسبی و نه نامِ پکیج: `test/` در `exports`ِ canvas-core نیست و نباید
// هم باشد — این زیرساختِ تست است، نه API عمومی.
//
// در محیطِ `node` بی‌اثر است (خودش `HTMLCanvasElement` را guard می‌کند)، پس روی
// تست‌های غیرِ DOM هزینه‌ای ندارد.
import { installCanvasStub } from "../../canvas-core/test/canvas-stub";

installCanvasStub();
