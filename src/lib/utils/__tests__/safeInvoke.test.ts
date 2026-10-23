import { describe, it, expect } from "vitest";
import { isCommandNotFound } from "../tauri/safeInvoke";

describe("isCommandNotFound", () => {
  it("matches Tauri's canonical command-not-found shape", () => {
    expect(isCommandNotFound('Command "list_projects" not found')).toBe(true);
    expect(isCommandNotFound('command "dev_tools_list_contexts" not found.')).toBe(true);
    expect(isCommandNotFound(new Error('Command "foo_bar" not found'))).toBe(true);
  });

  // The string Tauri itself rejects with, copied from tauri-2.11.2
  // src/webview/mod.rs:1905 and :1911 (Cargo.lock pins 2.11.2; 2.12.x is the
  // same): `resolver.reject(format!("Command {command} not found"))`. The name
  // is NOT quoted. The regex used to require quotes, so it matched only the
  // hand-written shape above and never the real rejection: every safeInvoke
  // fallback was dead and Drive's KB probe reported an expected absence.
  it("matches the unquoted string tauri 2.x actually rejects with", () => {
    expect(isCommandNotFound("Command list_knowledge_bases not found")).toBe(true);
    expect(isCommandNotFound("Command dev_tools_list_contexts not found")).toBe(true);
    expect(
      isCommandNotFound({ kind: "internal", error: "Command list_projects not found" }),
    ).toBe(true);
  });

  it("does not match a sentence that merely starts with 'Command'", () => {
    expect(isCommandNotFound("Command output file not found")).toBe(false);
    expect(isCommandNotFound("Command failed: project not found")).toBe(false);
  });

  it("does NOT match AppError-shaped objects with kind === 'not_found'", () => {
    // `kind: 'not_found'` is AppError::NotFound — a real backend
    // resource-not-found, never Tauri's unregistered-command failure (which is
    // a plain string). Treating it as command-not-found swallowed genuine
    // errors into an empty fallback.
    expect(isCommandNotFound({ kind: "not_found" })).toBe(false);
    expect(
      isCommandNotFound({ kind: "not_found", error: "Platform definition 'n8n'" }),
    ).toBe(false);
  });

  it("still matches an AppError-shaped object whose `error` carries the Tauri string", () => {
    expect(
      isCommandNotFound({ kind: "internal", error: 'Command "list_projects" not found' }),
    ).toBe(true);
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
