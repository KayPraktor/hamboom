import { afterEach, describe, expect, it } from "vitest";

import { guardEditorDirection } from "./editor-direction";

/**
 * ویرایشگر inline توسط موتور به‌صورت پویا ساخته می‌شود، پس این تست‌ها همان
 * شکل را شبیه‌سازی می‌کنند: یک `<textarea class="excalidraw-wysiwyg">` که
 * بعد از نصب نگهبان به DOM اضافه می‌شود.
 */

let stop: (() => void) | null = null;

afterEach(() => {
  stop?.();
  stop = null;
  document.body.innerHTML = "";
});

function addEditor(value: string): HTMLTextAreaElement {
  const editor = document.createElement("textarea");
  editor.className = "excalidraw-wysiwyg";
  editor.setAttribute("dir", "auto");
  editor.value = value;
  document.body.appendChild(editor);
  return editor;
}

/** MutationObserver در microtask اجرا می‌شود. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("guardEditorDirection", () => {
  it("ویرایشگری که از قبل وجود دارد را می‌گیرد", () => {
    const editor = addEditor("سلام دنیا");
    stop = guardEditorDirection();
    expect(editor.getAttribute("dir")).toBe("rtl");
  });

  it("ویرایشگری که بعداً اضافه می‌شود را هم می‌گیرد", async () => {
    stop = guardEditorDirection();
    const editor = addEditor("سلام دنیا");
    await flush();
    expect(editor.getAttribute("dir")).toBe("rtl");
  });

  it('`dir="auto"` را با مقدار صریح جایگزین می‌کند', () => {
    const editor = addEditor("سلام دنیا");
    expect(editor.getAttribute("dir")).toBe("auto");
    stop = guardEditorDirection();
    expect(editor.getAttribute("dir")).not.toBe("auto");
  });

  it("★ رشته‌ای که با کلمه‌ی لاتین شروع می‌شود rtl می‌گیرد، برخلاف dir=auto", () => {
    // این دقیقاً موردی است که الگوریتم استاندارد اشتباه می‌کند (ADR-024).
    const editor = addEditor("board برای تیم ماست");
    stop = guardEditorDirection();
    expect(editor.getAttribute("dir")).toBe("rtl");
  });

  it("متن لاتین ltr می‌گیرد", () => {
    const editor = addEditor("The quick brown fox");
    stop = guardEditorDirection();
    expect(editor.getAttribute("dir")).toBe("ltr");
  });

  it("با تایپ کاربر جهت به‌روز می‌شود", () => {
    const editor = addEditor("");
    stop = guardEditorDirection();
    expect(editor.getAttribute("dir")).toBe("rtl"); // fallback

    editor.value = "The quick brown fox";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    expect(editor.getAttribute("dir")).toBe("ltr");

    editor.value = "حالا فارسی شد";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    expect(editor.getAttribute("dir")).toBe("rtl");
  });

  it("text-align را دست نمی‌زند", () => {
    // عمدی — از element.textAlign می‌آید و بوم هم از همان استفاده می‌کند.
    // override کردنش ویرایشگر و بوم را از هم جدا می‌کند.
    const editor = addEditor("سلام دنیا");
    editor.style.textAlign = "left";
    stop = guardEditorDirection();
    expect(editor.style.textAlign).toBe("left");
  });

  it("چند ویرایشگر همزمان را جدا مدیریت می‌کند", async () => {
    stop = guardEditorDirection();
    const fa = addEditor("سلام دنیا");
    const en = addEditor("The quick brown fox");
    await flush();
    expect(fa.getAttribute("dir")).toBe("rtl");
    expect(en.getAttribute("dir")).toBe("ltr");
  });

  it("بعد از توقف، دیگر ویرایشگر جدید را نمی‌گیرد", async () => {
    const off = guardEditorDirection();
    off();
    const editor = addEditor("سلام دنیا");
    await flush();
    expect(editor.getAttribute("dir")).toBe("auto");
  });

  it("عنصر غیرمرتبط را دست نمی‌زند", async () => {
    stop = guardEditorDirection();
    const other = document.createElement("textarea");
    other.setAttribute("dir", "auto");
    other.value = "سلام دنیا";
    document.body.appendChild(other);
    await flush();
    expect(other.getAttribute("dir")).toBe("auto");
  });
});
