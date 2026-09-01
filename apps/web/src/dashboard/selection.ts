import type { BoardsFilter } from "./boards-queries.ts";

/**
 * انتخابِ نویگیشنِ داشبورد — کدام دسته از بوردها نمایش داده می‌شود. عمداً یک نوعِ خالص
 * (بدونِ React) تا نگاشتش به فیلترِ api و عنوان قابلِ تستِ واحد باشد.
 */
export type Selection =
  | { kind: "all" }
  | { kind: "favorites" }
  | { kind: "trash" }
  | { kind: "folder"; folderId: string; folderName: string; teamId: string };

/** فیلترِ `GET /boards` برای این انتخاب (بدونِ عبارتِ جستجو — آن جدا merge می‌شود). */
export function filterForSelection(selection: Selection): BoardsFilter {
  switch (selection.kind) {
    case "all":
      return {};
    case "favorites":
      return { favorite: true };
    case "trash":
      return { trashed: true };
    case "folder":
      return { folderId: selection.folderId };
  }
}

/** عنوانِ فارسیِ سرِ فهرست برای این انتخاب. */
export function headingForSelection(selection: Selection): string {
  switch (selection.kind) {
    case "all":
      return "همه‌ی بوردها";
    case "favorites":
      return "نشان‌شده‌ها";
    case "trash":
      return "سطلِ بازیافت";
    case "folder":
      return selection.folderName;
  }
}

/** آیا نمای سطلِ بازیافت است (کارت‌ها «بازیابی» می‌شوند، نه منوی معمول). */
export function isTrashView(selection: Selection): boolean {
  return selection.kind === "trash";
}
