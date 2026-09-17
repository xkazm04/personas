import { describe, it, expect } from "vitest";

import { resolveFinderKey, type FinderKeyLike } from "../FinderKeymap";

function key(partial: Partial<FinderKeyLike> & { key: string }): FinderKeyLike {
  return { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...partial };
}

describe("resolveFinderKey", () => {
  it("maps the classic modifier shortcuts (Ctrl and ⌘ alike)", () => {
    expect(resolveFinderKey(key({ key: "a", ctrlKey: true }))).toBe("selectAll");
    expect(resolveFinderKey(key({ key: "A", metaKey: true }))).toBe("selectAll");
    expect(resolveFinderKey(key({ key: "l", ctrlKey: true }))).toBe("editPath");
    expect(resolveFinderKey(key({ key: "f", metaKey: true }))).toBe("focusSearch");
    expect(resolveFinderKey(key({ key: "c", ctrlKey: true }))).toBe("copy");
    expect(resolveFinderKey(key({ key: "x", metaKey: true }))).toBe("cut");
    expect(resolveFinderKey(key({ key: "v", ctrlKey: true }))).toBe("paste");
  });

  it("maps Mod+1..5 to the recent slots and nothing beyond", () => {
    expect(resolveFinderKey(key({ key: "1", ctrlKey: true }))).toBe("recent1");
    expect(resolveFinderKey(key({ key: "5", metaKey: true }))).toBe("recent5");
    expect(resolveFinderKey(key({ key: "6", ctrlKey: true }))).toBeNull();
    expect(resolveFinderKey(key({ key: "1" }))).toBeNull();
  });

  it("maps the bare keys", () => {
    expect(resolveFinderKey(key({ key: "Delete" }))).toBe("delete");
    expect(resolveFinderKey(key({ key: "Backspace" }))).toBe("delete");
    expect(resolveFinderKey(key({ key: "F2" }))).toBe("rename");
    expect(resolveFinderKey(key({ key: "Enter" }))).toBe("open");
    expect(resolveFinderKey(key({ key: "ArrowUp" }))).toBe("moveUp");
    expect(resolveFinderKey(key({ key: "ArrowDown" }))).toBe("moveDown");
    expect(resolveFinderKey(key({ key: "ArrowLeft" }))).toBe("goUp");
    expect(resolveFinderKey(key({ key: "Escape" }))).toBe("escape");
    expect(resolveFinderKey(key({ key: " " }))).toBe("quickLook");
  });

  it("keeps ArrowLeft as go-up only without a modifier", () => {
    expect(resolveFinderKey(key({ key: "ArrowLeft", ctrlKey: true }))).toBeNull();
  });

  it("maps the Finder-only bindings", () => {
    expect(resolveFinderKey(key({ key: "i", ctrlKey: true }))).toBe("inspector");
    expect(resolveFinderKey(key({ key: "d", metaKey: true }))).toBe("duplicate");
    expect(resolveFinderKey(key({ key: "N", ctrlKey: true, shiftKey: true }))).toBe("newFolder");
    expect(resolveFinderKey(key({ key: "E", metaKey: true, shiftKey: true }))).toBe("export");
    expect(resolveFinderKey(key({ key: "I", ctrlKey: true, shiftKey: true }))).toBe("import");
  });

  it("ignores Alt chords and unknown keys", () => {
    expect(resolveFinderKey(key({ key: "a", ctrlKey: true, altKey: true }))).toBeNull();
    expect(resolveFinderKey(key({ key: "q", ctrlKey: true }))).toBeNull();
    expect(resolveFinderKey(key({ key: "z" }))).toBeNull();
    expect(resolveFinderKey(key({ key: "Delete", shiftKey: true }))).toBeNull();
  });
});
