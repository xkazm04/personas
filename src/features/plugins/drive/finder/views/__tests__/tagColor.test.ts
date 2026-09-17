import { describe, expect, it } from "vitest";

import { DRIVE_TAG_COLORS, type DriveTagColor } from "@/api/drive";
import { TAG_COLOR_CLASS, tagColorClass } from "../tagColor";

describe("tagColor", () => {
  it("maps all seven vocabulary colours", () => {
    expect(Object.keys(TAG_COLOR_CLASS).sort()).toEqual([...DRIVE_TAG_COLORS].sort());
    for (const color of DRIVE_TAG_COLORS) {
      expect(TAG_COLOR_CLASS[color]).toMatch(/^bg-/);
    }
  });

  it("uses design tokens only — no raw palette classes", () => {
    for (const cls of Object.values(TAG_COLOR_CLASS)) {
      expect(cls).not.toMatch(/-(?:\d{2,3})\b/);
      expect(cls).toMatch(/^bg-(?:brand-|status-|muted-foreground)/);
    }
  });

  it("falls back to gray for an unknown colour", () => {
    expect(tagColorClass("magenta" as DriveTagColor)).toBe(TAG_COLOR_CLASS.gray);
    expect(tagColorClass("red")).toBe("bg-brand-rose");
  });
});
