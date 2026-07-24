import { describe, expect, it } from "vitest";

import {
  boxCenter,
  edgePoint,
  roundTo2,
  routeConnector,
  toRelativePoints,
  type Box,
  type Point,
} from "./connector-routing";

const box = (x: number, y: number, w = 100, h = 100): Box => ({ x, y, width: w, height: h });

/**
 * ★★ self-test با مقادیر pin‌شده — قلب ناوردای ADR-008.
 *
 * این مقادیر **با دست از هندسه حساب شده‌اند، نه از خروجی کد**. اگر از خروجی
 * کد pin می‌شدند، یک فرمول غلط هم «pass» می‌شد. چون مستقل حساب شده‌اند، هر
 * تغییری در فرمول اینجا می‌شکند.
 *
 * و چون routeConnector فقط از چهار عمل اصلی + Math.round استفاده می‌کند (که
 * در IEEE 754 کاملاً مشخص‌اند)، همین مقادیر باید روی هر موتور جاوااسکریپت
 * یکسان باشند. اگر روزی روی موتور دیگری فرق کردند، این تست فوراً لو می‌دهد —
 * که همان چیزی است که «بیت‌به‌بیت بین مرورگرها» را عملاً می‌بندد.
 */
describe("★★ مقادیر pin‌شده (ADR-008)", () => {
  const cases: { name: string; input: Parameters<typeof routeConnector>[0]; expected: Point[] }[] =
    [
      {
        // مرکزها (50,50) و (350,50). لبه‌ها: راست جعبه‌ی اول (100,50)، چپ دوم (300,50).
        name: "straight افقی",
        input: { start: box(0, 0), end: box(300, 0), style: "straight" },
        expected: [
          { x: 100, y: 50 },
          { x: 300, y: 50 },
        ],
      },
      {
        // مرکزها (50,50) و (350,350). لبه‌ها روی قطر: (100,100) و (300,300).
        // dx=dy=200 → افقی غالب. midX = 100 + 200/2 = 200.
        name: "elbow قطری (افقی غالب)",
        input: { start: box(0, 0), end: box(300, 300), style: "elbow" },
        expected: [
          { x: 100, y: 100 },
          { x: 200, y: 100 },
          { x: 200, y: 300 },
          { x: 300, y: 300 },
        ],
      },
      {
        // مرکزها (50,50) و (250,450). لبه‌ها: t=min(50/200,50/400)=0.125.
        // a=(50+200*0.125, 50+400*0.125)=(75,100). b=(250-25,450-50)=(225,400).
        // dx=150, dy=300 → عمودی غالب. midY = 100 + 300/2 = 250.
        name: "elbow عمودی غالب",
        input: { start: box(0, 0), end: box(200, 400), style: "elbow" },
        expected: [
          { x: 75, y: 100 },
          { x: 75, y: 250 },
          { x: 225, y: 250 },
          { x: 225, y: 400 },
        ],
      },
      {
        // همان قطر straight، با نقطه‌ی کنترل وسط.
        name: "curved قطری",
        input: { start: box(0, 0), end: box(300, 300), style: "curved" },
        expected: [
          { x: 100, y: 100 },
          { x: 200, y: 200 },
          { x: 300, y: 300 },
        ],
      },
      {
        // نقاط آزاد (بدون جعبه): straight مستقیم بین همان دو نقطه.
        name: "نقاط آزاد straight",
        input: { start: { x: 10, y: 20 }, end: { x: 110, y: 20 }, style: "straight" },
        expected: [
          { x: 10, y: 20 },
          { x: 110, y: 20 },
        ],
      },
    ];

  it.each(cases)("$name", ({ input, expected }) => {
    expect(routeConnector(input)).toEqual(expected);
  });
});

describe("roundTo2 — تنها راه مجاز گرد کردن", () => {
  it("به ۲ رقم گرد می‌کند", () => {
    expect(roundTo2(1.234)).toBe(1.23);
    expect(roundTo2(1.235)).toBe(1.24);
    expect(roundTo2(50.00000000000001)).toBe(50);
    expect(roundTo2(49.99999999999999)).toBe(50);
  });

  it("★ همان انحراف اعشاری که خروجی را بین موتورها واگرا می‌کند، خنثی می‌کند", () => {
    // 1/6 * 300 ممکن است 50 یا 50.00000000000001 شود؛ هر دو باید ۵۰ شوند.
    expect(roundTo2((1 / 6) * 300)).toBe(50);
    expect(roundTo2((1 / 3) * 300)).toBe(100);
  });
});

describe("edgePoint — نقطه روی لبه", () => {
  it("در راستای افقی، لبه‌ی راست را می‌دهد", () => {
    expect(edgePoint(box(0, 0), { x: 500, y: 50 })).toEqual({ x: 100, y: 50 });
  });

  it("در راستای عمودی، لبه‌ی پایین را می‌دهد", () => {
    expect(edgePoint(box(0, 0), { x: 50, y: 500 })).toEqual({ x: 50, y: 100 });
  });

  it("هدفِ روی مرکز، خودِ مرکز را می‌دهد (بدون تقسیم بر صفر)", () => {
    expect(edgePoint(box(0, 0), { x: 50, y: 50 })).toEqual({ x: 50, y: 50 });
  });

  it("boxCenter درست است", () => {
    expect(boxCenter(box(10, 20, 100, 60))).toEqual({ x: 60, y: 50 });
  });
});

describe("ناورداها", () => {
  it("★ قطعی است — همان ورودی همیشه همان خروجی (تابع خالص)", () => {
    const input = { start: box(13, 27), end: box(211, 389), style: "elbow" as const };
    const first = JSON.stringify(routeConnector(input));
    for (let i = 0; i < 100; i++) {
      expect(JSON.stringify(routeConnector(input))).toBe(first);
    }
  });

  it("★ همه‌ی مختصات خروجی به ۲ رقم گرد شده‌اند", () => {
    // ورودی‌ای که عمداً کسر تولید می‌کند.
    const points = routeConnector({ start: box(0, 0, 77, 33), end: box(313, 217), style: "elbow" });
    for (const p of points) {
      expect(roundTo2(p.x)).toBe(p.x);
      expect(roundTo2(p.y)).toBe(p.y);
    }
  });

  it("تقارن: جابه‌جایی start/end مسیر را برعکس می‌کند", () => {
    const ab = routeConnector({ start: box(0, 0), end: box(300, 0), style: "straight" });
    const ba = routeConnector({ start: box(300, 0), end: box(0, 0), style: "straight" });
    expect(ba).toEqual([...ab].reverse());
  });

  it("straight همیشه دو نقطه دارد", () => {
    expect(
      routeConnector({ start: box(0, 0), end: box(500, 500), style: "straight" }),
    ).toHaveLength(2);
  });

  it("elbow با یک بند، چهار نقطه دارد", () => {
    expect(routeConnector({ start: box(0, 0), end: box(500, 300), style: "elbow" })).toHaveLength(
      4,
    );
  });
});

describe("toRelativePoints", () => {
  it("نقطه‌ی اول را به مبدأ می‌برد", () => {
    const rel = toRelativePoints([
      { x: 100, y: 50 },
      { x: 300, y: 50 },
    ]);
    expect(rel).toEqual([
      [0, 0],
      [200, 0],
    ]);
  });

  it("خروجی به ۲ رقم گرد است", () => {
    const rel = toRelativePoints([
      { x: 10.111, y: 20.222 },
      { x: 30.333, y: 40.444 },
    ]);
    expect(rel).toEqual([
      [0, 0],
      [20.22, 20.22],
    ]);
  });

  it("آرایه‌ی خالی را دست نمی‌زند", () => {
    expect(toRelativePoints([])).toEqual([]);
  });
});
