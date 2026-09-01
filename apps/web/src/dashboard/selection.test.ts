import { describe, expect, it } from "vitest";

import {
  filterForSelection,
  headingForSelection,
  isTrashView,
  type Selection,
} from "./selection.ts";

describe("filterForSelection", () => {
  it("all → فیلترِ خالی (بوردهای زنده)", () => {
    expect(filterForSelection({ kind: "all" })).toEqual({});
  });

  it("favorites → favorite:true", () => {
    expect(filterForSelection({ kind: "favorites" })).toEqual({ favorite: true });
  });

  it("★ trash → trashed:true (بوردهای زنده را نمی‌خواهد)", () => {
    const f = filterForSelection({ kind: "trash" });
    expect(f).toEqual({ trashed: true });
    expect(f.favorite).toBeUndefined();
  });

  it("folder → folderId (نه teamId؛ api با folderId فیلتر می‌کند)", () => {
    const sel: Selection = { kind: "folder", folderId: "f1", folderName: "طرح‌ها", teamId: "t1" };
    expect(filterForSelection(sel)).toEqual({ folderId: "f1" });
  });
});

describe("headingForSelection", () => {
  it("عنوانِ فولدر = نامِ فولدر است", () => {
    const sel: Selection = { kind: "folder", folderId: "f1", folderName: "طرح‌ها", teamId: "t1" };
    expect(headingForSelection(sel)).toBe("طرح‌ها");
  });

  it("سطل عنوانِ ثابت دارد", () => {
    expect(headingForSelection({ kind: "trash" })).toBe("سطلِ بازیافت");
  });
});

describe("isTrashView", () => {
  it("فقط برای kind='trash' درست است", () => {
    expect(isTrashView({ kind: "trash" })).toBe(true);
    expect(isTrashView({ kind: "all" })).toBe(false);
    expect(isTrashView({ kind: "folder", folderId: "f", folderName: "n", teamId: "t" })).toBe(false);
  });
});
