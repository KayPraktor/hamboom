/**
 * کاتالوگِ رشته‌های فارسی.
 *
 * فارسی **native** است، نه ترجمه (P6). ساختار برای چند-زبانه بودن آماده است
 * ولی طبق Q7 در PLAN فقط `fa` پر می‌شود. کلیدها با نقطه فضا‌بندی می‌شوند
 * (`tool.sticky`) تا گروه‌بندی خوانا بماند.
 */
export const fa = {
  "app.name": "هم‌بوم",

  // ابزارها (نوار ابزارِ گام ۴٫۲)
  "tool.select": "انتخاب",
  "tool.hand": "دست",
  "tool.sticky": "استیکی",
  "tool.text": "متن",
  "tool.shape": "شکل",
  "tool.connector": "کانکتور",
  "tool.pen": "قلم",
  "tool.image": "تصویر",
  "tool.frame": "فریم",
  "tool.comment": "کامنت",
  "tool.eraser": "پاک‌کن",
  "tool.laser": "لیزر",

  // کنش‌ها
  "action.undo": "برگردان",
  "action.redo": "دوباره",
  "action.copy": "کپی",
  "action.paste": "چسباندن",
  "action.delete": "حذف",
  "action.duplicate": "تکثیر",
  "action.group": "گروه‌بندی",
  "action.lock": "قفل",
  "action.unlock": "باز کردن قفل",
  "action.bringToFront": "بردن به جلو",
  "action.sendToBack": "بردن به عقب",
  "action.copyAsImage": "کپی به‌عنوان تصویر",
  "action.fitToScreen": "برازش با صفحه",

  // وضعیتِ ذخیره و اتصال (نوار وضعیتِ گام ۴٫۳)
  "status.saved": "ذخیره شد",
  "status.saving": "در حال ذخیره…",
  "status.unsaved": "ذخیره‌نشده",
  "connection.connecting": "در حال اتصال…",
  "connection.connected": "متصل — {count} نفر آنلاین",
  "connection.reconnecting": "اتصال مجدد… (تلاش {attempt})",
  "connection.offline": "آفلاین — {pending} تغییرِ معلق",

  // عناصر
  "element.untitledFrame": "فریم بدون عنوان",
  "element.imageTooLarge": "حجم فایل بیش از حد مجاز است (بیشینه {max} مگابایت)",
  "element.imageBadType": "این فرمت پشتیبانی نمی‌شود: {type}",
} as const;

export type FaKey = keyof typeof fa;
