import { SdkError } from "@hamboom/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * ★★ ادعای این فایل یک چیز است و آن یک چیز در اولین استقرارِ واقعی گران تمام شد (M6 ردیفِ ۸٫۶):
 * **وقتی بایتِ تصویر خوانده نمی‌شود، باید معلوم شود چرا.**
 *
 * `resolve` عمداً هرگز reject نمی‌کند (مسیرِ رندر است؛ رشته‌ی خالی یعنی «الان نمی‌شود» و
 * placeholder می‌مانَد). ولی نگارشِ اولش `catch {}`ِ **کاملاً خاموش** بود، و نتیجه‌اش باگی شد که
 * نه در لاگِ api دیده می‌شد نه در کنسولِ مرورگر — یعنی از بیرون اصلاً قابلِ تشخیص نبود.
 */

const resolveBlob = vi.fn();

vi.mock("../api/client.ts", () => ({
  api: { assets: { resolveBlob: (...a: unknown[]) => resolveBlob(...a) } },
}));

const { createApiAssetTransport } = await import("./asset-transport.ts");

const transport = () => createApiAssetTransport({ boardId: "b1", uploadedBy: "u1" });

afterEach(() => {
  vi.restoreAllMocks();
  resolveBlob.mockReset();
});

describe("resolveِ دارایی — شکست باید صدا داشته باشد", () => {
  it("۴۰۴ی api (ردیفِ files هنوز ready نیست) ⇒ رشته‌ی خالی، و کد و وضعیت در کنسول", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    resolveBlob.mockRejectedValue(new SdkError(404, "NOT_FOUND", "فایل یافت نشد."));

    await expect(transport().resolve("f-404")).resolves.toBe("");

    expect(spy).toHaveBeenCalledTimes(1);
    const msg = String(spy.mock.calls[0]?.[0]);
    expect(msg).toContain("f-404");
    expect(msg).toContain("404");
    expect(msg).toContain("NOT_FOUND");
  });

  it("خطای شبکه/CORSِ انبار ⇒ نامِ خطا و پیامش می‌آید، نه سکوت", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // ⊕ همان چیزی که مرورگر روی یک ری‌دایرکتِ بین‌مبدأ بدونِ `Access-Control-Allow-Origin`
    //   می‌دهد — اندازه‌گیری‌شده در ۸٫۶.
    resolveBlob.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(transport().resolve("f-cors")).resolves.toBe("");

    const msg = String(spy.mock.calls[0]?.[0]);
    expect(msg).toContain("TypeError");
    expect(msg).toContain("Failed to fetch");
  });

  it("مسیرِ موفق ساکت است — لاگ فقط برای شکست", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    resolveBlob.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));

    await expect(transport().resolve("f-ok")).resolves.toMatch(/^data:/);
    expect(spy).not.toHaveBeenCalled();
  });
});
