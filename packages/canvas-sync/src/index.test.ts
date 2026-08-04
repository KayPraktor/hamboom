import { describe, expect, it } from "vitest";

import { assertEmittable, EchoLoopError, SUPPORTED_SCHEMA_VERSION } from "./index.ts";

/**
 * تستِ دودِ اسکلت (گام ۰٫۲).
 *
 * ادعای اصلی‌اش یک ادعای **معماری** است، نه منطقی: این پکیج می‌تواند همزمان
 * `canvas-core` و `ydoc-schema` را ببیند — همان چیزی که ADR-029 برایش ساخته
 * شد — و نگهبانِ echo را از M1 **قرض می‌گیرد** نه اینکه دوباره بنویسد.
 *
 * اگر روزی کسی سعی کند binder را به `ydoc-schema` برگرداند، همین import
 * می‌شکند (قاعده‌ی `ydocSchemaBoundaries`).
 */
describe("اسکلتِ canvas-sync", () => {
  it("نگهبانِ echo از canvas-core می‌آید و واقعاً کار می‌کند", () => {
    // منشأ محلی → مجاز
    expect(() =>
      assertEmittable({ upserted: [], deleted: [], origin: "local-user" }),
    ).not.toThrow();

    // منشأ remote → همان حلقه‌ای که کلِ معماری از آن می‌ترسد
    expect(() =>
      assertEmittable({ upserted: [], deleted: [], origin: "remote", gestureId: "g_1" }),
    ).toThrow(EchoLoopError);
  });

  it("نسخه‌ی schema از ydoc-schema می‌آید، نه از یک ثابتِ محلی", () => {
    expect(SUPPORTED_SCHEMA_VERSION).toBe(1);
  });
});
