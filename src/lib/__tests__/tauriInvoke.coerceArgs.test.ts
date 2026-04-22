import { describe, it, expect } from "vitest";
import { coerceArgs } from "../tauriInvoke";

describe("coerceArgs", () => {
  it("coerces undefined inside array-of-objects to null", () => {
    const input = { rows: [{ a: undefined, b: 1 }] };
    expect(coerceArgs(input as never)).toEqual({ rows: [{ a: null, b: 1 }] });
  });

  it("coerces undefined in deeply nested array inside nested object", () => {
    const input = { nested: { list: [{ x: undefined }] } };
    expect(coerceArgs(input as never)).toEqual({ nested: { list: [{ x: null }] } });
  });

  it("leaves primitive arrays unchanged", () => {
    const input = { primitive: [1, 2, 3] };
    expect(coerceArgs(input as never)).toEqual({ primitive: [1, 2, 3] });
  });

  it("preserves Date instances without mutation", () => {
    const d = new Date(0);
    const input = { d };
    const result = coerceArgs(input as never) as { d: Date };
    expect(result.d).toBeInstanceOf(Date);
    expect(result.d.getTime()).toBe(0);
  });

  it("coerces top-level undefined property to null (regression guard)", () => {
    const input = { top: undefined };
    expect(coerceArgs(input as never)).toEqual({ top: null });
  });

  it("recurses into nested arrays of arrays", () => {
    const input = { matrix: [[{ v: undefined }]] };
    expect(coerceArgs(input as never)).toEqual({ matrix: [[{ v: null }]] });
  });

  it("leaves null values untouched", () => {
    const input = { a: null, b: 1 };
    expect(coerceArgs(input as never)).toEqual({ a: null, b: 1 });
  });

  it("preserves class instances (Tauri Channel-style) without recursing into them", () => {
    // Regression: coerceArgs used to recurse into any non-Date object. Tauri
    // `Channel` is a class instance with `toJSON(): string` — walking its own
    // keys produces a map and the Rust side rejects it with
    // "invalid type: map, expected a string".
    class FakeChannel {
      id = 42;
      toJSON() { return "__CHANNEL__:42"; }
    }
    const ch = new FakeChannel();
    const result = coerceArgs({ channel: ch } as never) as { channel: FakeChannel };
    // Same reference: not walked, not cloned.
    expect(result.channel).toBe(ch);
    // toJSON still produces the IPC-compatible string form.
    expect(JSON.stringify(result)).toBe('{"channel":"__CHANNEL__:42"}');
  });

  it("leaves null-prototype objects intact but still coerces their undefined keys", () => {
    const obj = Object.assign(Object.create(null), { a: undefined, b: 2 });
    expect(coerceArgs({ obj } as never)).toEqual({ obj: { a: null, b: 2 } });
  });
});
