/**
 * ابزارِ متنیِ مشترکِ گیت‌های سورس‌خوان — بدونِ هیچ اثرِ جانبی (قابلِ import از هر گیت).
 *
 * ⚠️ همان درسِ `sweep-orphans-core`: ماژولی که در بارگذاری `main()` را صدا می‌زند
 * import‌پذیر نیست. `stripComments` این‌جاست تا هم `check-workspace-deps` و هم
 * `check-p2` بدونِ اجراکردنِ همدیگر از آن استفاده کنند.
 */

/**
 * حذفِ کامنت‌های `//` و `/* *\/` — **آگاه به رشته‌ها**: یک `"https://…"` داخلِ رشته کامنت
 * نیست، و یک `//` داخلِ template literal هم. خودآزمونِ هر دو گیت این را می‌سنجد.
 */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const c = source[i] ?? "";
    const next = source[i + 1] ?? "";
    if (quote !== null) {
      out += c;
      if (c === "\\") {
        out += next;
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}
