import { describe, it, expect } from "vitest";
import { classifyLine, parseSummaryLine } from "../terminalColors";

describe("classifyLine", () => {
  it("classifies error lines", () => {
    expect(classifyLine("[ERROR] something broke")).toBe("error");
    expect(classifyLine("[TIMEOUT] exceeded 30s")).toBe("error");
    expect(classifyLine("[WARN] low memory")).toBe("error");
  });

  it("classifies summary lines", () => {
    expect(classifyLine("[SUMMARY] some data")).toBe("summary");
  });

  it("classifies tool lines", () => {
    expect(classifyLine("> Using tool: Read")).toBe("tool");
    expect(classifyLine("  Tool result: success")).toBe("tool");
  });

  it("classifies status lines", () => {
    expect(classifyLine("Session started (claude-3)")).toBe("status");
    expect(classifyLine("Completed in 5.2s")).toBe("status");
    expect(classifyLine("Cost: $0.05")).toBe("status");
    expect(classifyLine("=== Execution Log ===")).toBe("status");
  });

  it("classifies meta lines", () => {
    expect(classifyLine("Process exited with code 0")).toBe("meta");
  });

  // Regression guard: `> Cancelled` used to be tested AFTER the generic `> `
  // branch, so it was unreachable and a cancellation rendered as 'code'.
  // Pins the fixed expression and forbids the old one.
  it("classifies a cancellation as meta, not as code", () => {
    expect(classifyLine("> Cancelled by user")).toBe("meta");
    expect(classifyLine("> Cancelled")).toBe("meta");
    expect(classifyLine("> Cancelled by user")).not.toBe("code");
  });

  it("still classifies other angle-bracket lines as code", () => {
    expect(classifyLine("> const x = 1")).toBe("code");
    expect(classifyLine("> Analyzing repository")).toBe("info");
  });

  it("defaults to text for unrecognized lines", () => {
    expect(classifyLine("Hello, world!")).toBe("text");
    expect(classifyLine("")).toBe("text");
    expect(classifyLine("Just some output")).toBe("text");
  });
});

describe("parseSummaryLine", () => {
  it("parses a valid summary line", () => {
    const line = '[SUMMARY]{"status":"completed","duration_ms":5200,"cost_usd":0.05}';
    const result = parseSummaryLine(line);
    expect(result).toEqual({
      status: "completed",
      duration_ms: 5200,
      cost_usd: 0.05,
    });
  });

  it("returns null for non-summary lines", () => {
    expect(parseSummaryLine("Hello, world!")).toBeNull();
    expect(parseSummaryLine("[ERROR] something")).toBeNull();
    expect(parseSummaryLine("")).toBeNull();
  });

  it("returns null for invalid JSON in summary", () => {
    expect(parseSummaryLine("[SUMMARY]{broken json")).toBeNull();
  });

  it("handles summary with null fields", () => {
    const line = '[SUMMARY]{"status":"failed","duration_ms":null,"cost_usd":null}';
    const result = parseSummaryLine(line);
    expect(result).toEqual({
      status: "failed",
      duration_ms: null,
      cost_usd: null,
    });
  });
});

describe('parseSummaryLine shape guard', () => {
  // Regression guard: the payload used to be cast straight to ExecutionSummary,
  // so a parseable non-object arrived as a "summary" whose every field was
  // undefined. Pins the fixed expression (null) and forbids the old (a value).
  it('rejects a payload that parses but is not a summary object', () => {
    expect(parseSummaryLine('[SUMMARY]"done"')).toBeNull();
    expect(parseSummaryLine('[SUMMARY]null')).toBeNull();
    expect(parseSummaryLine('[SUMMARY][]')).toBeNull();
    expect(parseSummaryLine('[SUMMARY]42')).toBeNull();
    expect(parseSummaryLine('[SUMMARY]{"duration_ms":10}')).toBeNull();
  });

  it('stays tolerant of a summary missing its optional numerics', () => {
    expect(parseSummaryLine('[SUMMARY]{"status":"completed"}')).toEqual({
      status: 'completed',
    });
  });
});
