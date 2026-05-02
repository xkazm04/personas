import { describe, it, expect } from "vitest";
import { isCommandNotFound } from "../tauri/safeInvoke";

describe("isCommandNotFound", () => {
  it("matches Tauri's canonical command-not-found shape", () => {
    expect(isCommandNotFound('Command "list_projects" not found')).toBe(true);
    expect(isCommandNotFound('command "dev_tools_list_contexts" not found.')).toBe(true);
    expect(isCommandNotFound(new Error('Command "foo_bar" not found'))).toBe(true);
  });

  it("matches AppError-shaped objects with kind === 'not_found'", () => {
    expect(isCommandNotFound({ kind: "not_found" })).toBe(true);
  });

  it("does NOT match arbitrary errors that just contain the substring 'not found'", () => {
    // Regression: the old `msg.includes("not found")` check returned `true`
    // for these cases, silently swallowing real backend errors.
    expect(isCommandNotFound("invocation failed: not found in registry")).toBe(false);
    expect(isCommandNotFound("project not found")).toBe(false);
    expect(isCommandNotFound("context not found")).toBe(false);
    expect(isCommandNotFound("vault path not found")).toBe(false);
    expect(isCommandNotFound(new Error("host not found"))).toBe(false);
  });

  it("returns false for unrelated errors", () => {
    expect(isCommandNotFound(new Error("timeout"))).toBe(false);
    expect(isCommandNotFound("network error")).toBe(false);
    expect(isCommandNotFound(null)).toBe(false);
    expect(isCommandNotFound(undefined)).toBe(false);
  });
});
