import { describe, expect, it } from "vitest";
import { framerReducedMotion } from "./framerReducedMotion";

describe("framerReducedMotion", () => {
  it("in-app Reduce motion ON forces always", () => {
    expect(framerReducedMotion(true, true)).toBe("always");
  });
  it("setting OFF keeps OS-following user", () => {
    expect(framerReducedMotion(true, false)).toBe("user");
  });
  it("hidden document is always reduced", () => {
    expect(framerReducedMotion(false, false)).toBe("always");
  });
});
