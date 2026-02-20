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
