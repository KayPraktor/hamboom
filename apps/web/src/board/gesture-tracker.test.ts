import { describe, expect, it } from "vitest";

import { createGestureTracker } from "./gesture-tracker.ts";

describe("createGestureTracker", () => {
  it("اولین تغییر یک ژستِ نو است", () => {
    const t = createGestureTracker("u1", 140);
    expect(t.idFor(1000)).toBe("g_u1_1");
  });

  it("★ تغییراتِ ظرفِ idleMs همان gestureId می‌مانند (یک درگ = یک ژست)", () => {
    const t = createGestureTracker("u1", 140);
    const first = t.idFor(1000);
    // نرخِ فریم ~۱۶ms: همه در یک درگ
    expect(t.idFor(1016)).toBe(first);
    expect(t.idFor(1032)).toBe(first);
    expect(t.idFor(1140)).toBe(first); // دقیقاً روی مرز (۱۴۰ فاصله) هنوز همان
  });

  it("★ فاصله‌ی بیش از idleMs ژستِ نو می‌سازد (کنشِ مجزا)", () => {
    const t = createGestureTracker("u1", 140);
    expect(t.idFor(1000)).toBe("g_u1_1");
    expect(t.idFor(1000 + 141)).toBe("g_u1_2"); // فاصله‌ی ۱۴۱ > ۱۴۰
  });

  it("idـها با کاربرِ متفاوت پیشوندِ متفاوت دارند", () => {
    expect(createGestureTracker("alice", 140).idFor(0)).toBe("g_alice_1");
    expect(createGestureTracker("bob", 140).idFor(0)).toBe("g_bob_1");
  });

  it("دنباله‌ی درگ‌های مجزا شماره‌ی صعودی می‌گیرد", () => {
    const t = createGestureTracker("u1", 100);
    expect(t.idFor(0)).toBe("g_u1_1");
    expect(t.idFor(50)).toBe("g_u1_1"); // ادامه‌ی همان
    expect(t.idFor(400)).toBe("g_u1_2"); // ژستِ دوم
    expect(t.idFor(450)).toBe("g_u1_2");
    expect(t.idFor(1000)).toBe("g_u1_3"); // ژستِ سوم
  });
});
