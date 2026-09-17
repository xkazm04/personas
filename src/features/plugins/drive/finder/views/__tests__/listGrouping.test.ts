import { describe, expect, it } from "vitest";

import type { DriveEntry } from "@/api/drive";
import {
  GROUP_H,
  ROW_H,
  activeHeaderIndex,
  buildListItems,
  headerIndexes,
  itemSize,
} from "../listGrouping";

function entry(name: string, overrides: Partial<DriveEntry> = {}): DriveEntry {
  return {
    name,
    path: name,
    kind: "file",
    size: 1,
    modified: "2026-09-17T00:00:00Z",
    mime: "text/plain",
    extension: "txt",
    ...overrides,
  };
}

// Already in the engine's kind order: folders, images, documents.
const SORTED = [
  entry("a", { kind: "folder", mime: null, extension: null }),
  entry("b", { kind: "folder", mime: null, extension: null }),
  entry("c.png", { mime: "image/png", extension: "png" }),
  entry("d.txt"),
  entry("e.txt"),
  entry("f.txt"),
];

describe("buildListItems", () => {
  it("is a plain row list when not grouped", () => {
    const items = buildListItems(SORTED, false);
    expect(items).toHaveLength(6);
    expect(items.every((i) => i.type === "entry")).toBe(true);
    expect(items.map((i) => i.key)).toEqual(SORTED.map((e) => e.path));
  });

  it("leads every bucket run with a header carrying the bucket count", () => {
    const items = buildListItems(SORTED, true);
    const headers = items.filter((i) => i.type === "header");
    expect(headers.map((h) => (h.type === "header" ? [h.bucket, h.count] : null))).toEqual([
      ["kind_folder", 2],
      ["kind_image", 1],
      ["kind_text", 3],
    ]);
    expect(items).toHaveLength(9);
    expect(headerIndexes(items)).toEqual([0, 3, 5]);
  });

  it("sizes headers and rows from the shared constants", () => {
    const items = buildListItems(SORTED, true);
    expect(itemSize(items[0])).toBe(GROUP_H);
    expect(itemSize(items[1])).toBe(ROW_H);
    expect(itemSize(undefined)).toBe(ROW_H);
  });

  it("keeps entry indexes pointing into the source array", () => {
    const items = buildListItems(SORTED, true);
    for (const item of items) {
      if (item.type === "entry") expect(SORTED[item.index]).toBe(item.entry);
    }
  });
});

describe("activeHeaderIndex", () => {
  it("picks the last header at or before the first visible row", () => {
    const headers = [0, 3, 5];
    expect(activeHeaderIndex(headers, 0)).toBe(0);
    expect(activeHeaderIndex(headers, 2)).toBe(0);
    expect(activeHeaderIndex(headers, 3)).toBe(3);
    expect(activeHeaderIndex(headers, 4)).toBe(3);
    expect(activeHeaderIndex(headers, 9)).toBe(5);
  });

  it("is null when there are no headers", () => {
    expect(activeHeaderIndex([], 4)).toBeNull();
  });
});
