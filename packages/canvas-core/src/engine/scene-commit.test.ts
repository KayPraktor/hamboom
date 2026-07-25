import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { describe, expect, it } from "vitest";

import { commitGesture, commitSystemUpdate } from "./scene-commit";

function fakeApi() {
  const calls: Array<Record<string, unknown>> = [];
  const api = {
    updateScene: (data: Record<string, unknown>) => calls.push(data),
  } as unknown as ExcalidrawImperativeAPI;
  return { api, calls };
}

describe("commitGesture / commitSystemUpdate", () => {
  it("★ commitGesture با captureUpdate: IMMEDIATELY می‌نویسد", () => {
    const f = fakeApi();
    commitGesture(f.api, [{ id: "a" }]);
    expect(f.calls[0]!.captureUpdate).toBe("IMMEDIATELY");
    expect(f.calls[0]!.elements).toEqual([{ id: "a" }]);
  });

  it("★ commitSystemUpdate با captureUpdate: NEVER می‌نویسد", () => {
    const f = fakeApi();
    commitSystemUpdate(f.api, [{ id: "a" }]);
    expect(f.calls[0]!.captureUpdate).toBe("NEVER");
  });

  it("select به selectedElementIds تبدیل می‌شود", () => {
    const f = fakeApi();
    commitGesture(f.api, [], { select: ["x", "y"] });
    expect((f.calls[0]!.appState as { selectedElementIds: unknown }).selectedElementIds).toEqual({
      x: true,
      y: true,
    });
  });

  it("بدون select، appState تعریف‌نشده می‌ماند (انتخاب دست‌نخورده)", () => {
    const f = fakeApi();
    commitSystemUpdate(f.api, []);
    expect(f.calls[0]!.appState).toBeUndefined();
  });
});
