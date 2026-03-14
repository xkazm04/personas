import { describe, it, expect } from "vitest";
import {
  computeCredentialCoverage,
  type CoverageResult,
} from "../credentialCoverage";
import type { PersonaToolDefinition } from "@/lib/bindings/PersonaToolDefinition";

/** Minimal tool fixture -- only fields used by computeCredentialCoverage matter. */
function makeTool(
  overrides: Partial<PersonaToolDefinition> = {},
): PersonaToolDefinition {
  return {
    id: "t-1",
    name: "test-tool",
    category: "general",
    description: "",
    script_path: "",
    input_schema: null,
    output_schema: null,
    requires_credential_type: null,
    implementation_guide: null,
    is_builtin: false,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("computeCredentialCoverage", () => {
  it("returns covered=true when no tools require credentials", () => {
    const tools = [makeTool({ name: "tool-a" }), makeTool({ name: "tool-b" })];
    const result: CoverageResult = computeCredentialCoverage(tools, {});

    expect(result.covered).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.linked).toBe(0);
  });

  it("returns covered=true when all required credential types are linked", () => {
    const tools = [
      makeTool({ name: "github-tool", requires_credential_type: "github" }),
      makeTool({ name: "slack-tool", requires_credential_type: "slack" }),
    ];
    const result = computeCredentialCoverage(tools, {
      github: "cred-1",
      slack: "cred-2",
    });

    expect(result.covered).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.total).toBe(2);
    expect(result.linked).toBe(2);
  });

  it("returns covered=false with missing types when credential link is absent", () => {
    const tools = [
      makeTool({ name: "github-tool", requires_credential_type: "github" }),
    ];
    const result = computeCredentialCoverage(tools, {});

    expect(result.covered).toBe(false);
    expect(result.missing).toEqual(["github"]);
    expect(result.total).toBe(1);
    expect(result.linked).toBe(0);
  });

  it("handles mix of covered and uncovered tools correctly", () => {
    const tools = [
      makeTool({ name: "github-tool", requires_credential_type: "github" }),
      makeTool({ name: "slack-tool", requires_credential_type: "slack" }),
      makeTool({ name: "jira-tool", requires_credential_type: "jira" }),
      makeTool({ name: "simple-tool" }), // no credential needed
    ];
    const result = computeCredentialCoverage(tools, {
      github: "cred-1",
      // slack and jira missing
    });

    expect(result.covered).toBe(false);
    expect(result.missing).toContain("slack");
    expect(result.missing).toContain("jira");
    expect(result.missing).not.toContain("github");
    expect(result.total).toBe(3);
    expect(result.linked).toBe(1);
  });

  it("treats null credentialLinks as empty (all required types missing)", () => {
    const tools = [
      makeTool({ name: "github-tool", requires_credential_type: "github" }),
    ];
    const result = computeCredentialCoverage(tools, null);

    expect(result.covered).toBe(false);
    expect(result.missing).toEqual(["github"]);
    expect(result.total).toBe(1);
    expect(result.linked).toBe(0);
  });

  it("deduplicates requires_credential_type across tools", () => {
    const tools = [
      makeTool({ name: "github-pr", requires_credential_type: "github" }),
      makeTool({ name: "github-issue", requires_credential_type: "github" }),
      makeTool({ name: "github-review", requires_credential_type: "github" }),
    ];
    const result = computeCredentialCoverage(tools, {});

    expect(result.covered).toBe(false);
    expect(result.missing).toEqual(["github"]);
    // Only 1 unique type even though 3 tools require it
    expect(result.total).toBe(1);
    expect(result.linked).toBe(0);
  });

  it("ignores built-in tools with no requires_credential_type", () => {
    const tools = [
      makeTool({ name: "builtin-tool", is_builtin: true }),
      makeTool({ name: "github-tool", requires_credential_type: "github" }),
    ];
    const result = computeCredentialCoverage(tools, {
      github: "cred-1",
    });

    expect(result.covered).toBe(true);
    expect(result.total).toBe(1);
    expect(result.linked).toBe(1);
  });
});
