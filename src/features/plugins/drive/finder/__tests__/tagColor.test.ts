import { describe, expect, it } from "vitest";

import { DRIVE_TAG_COLORS, type DriveTagColor } from "@/api/drive";
import { TAG_COLOR_CLASS, TAG_RING_CLASS, tagColorClass, tagRingClass } from "../tagColor";

describe("tagColor", () => {
  it("maps all seven vocabulary colours for fill and ring", () => {
    expect(Object.keys(TAG_COLOR_CLASS).sort()).toEqual([...DRIVE_TAG_COLORS].sort());
    expect(Object.keys(TAG_RING_CLASS).sort()).toEqual([...DRIVE_TAG_COLORS].sort());
    for (const color of DRIVE_TAG_COLORS) {
      expect(TAG_COLOR_CLASS[color]).toMatch(/^bg-/);
      expect(TAG_RING_CLASS[color]).toMatch(/^ring-/);
      // fill and ring name the same token
      expect(TAG_RING_CLASS[color].slice(5)).toBe(TAG_COLOR_CLASS[color].slice(3));
    }
  });

  it("uses design tokens only — no raw palette classes", () => {
    for (const cls of [...Object.values(TAG_COLOR_CLASS), ...Object.values(TAG_RING_CLASS)]) {
      expect(cls).not.toMatch(/-(?:\d{2,3})\b/);
      expect(cls).toMatch(/^(?:bg|ring)-(?:brand-|status-|muted-foreground)/);
    }
  });

  it("falls back to gray for an unknown colour", () => {
    expect(tagColorClass("magenta" as DriveTagColor)).toBe(TAG_COLOR_CLASS.gray);
    expect(tagRingClass("magenta" as DriveTagColor)).toBe(TAG_RING_CLASS.gray);
    expect(tagColorClass("red")).toBe("bg-brand-rose");
    expect(tagRingClass("blue")).toBe("ring-brand-cyan");
  });
});
