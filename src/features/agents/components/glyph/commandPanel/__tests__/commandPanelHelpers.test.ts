import { describe, it, expect } from "vitest";
import {
  EMPTY_DRAFT,
  mergeRecipeIntoDraft,
  parseRecipeTools,
  type IntentDraft,
} from "../commandPanelHelpers";

describe("parseRecipeTools", () => {
  it("returns empty string for null/undefined/empty inputs", () => {
    expect(parseRecipeTools(null)).toBe("");
    expect(parseRecipeTools(undefined)).toBe("");
    expect(parseRecipeTools("")).toBe("");
  });

  it("joins string-array tool requirements with commas", () => {
    expect(parseRecipeTools(JSON.stringify(["http_request", "file_read"]))).toBe(
      "http_request, file_read",
    );
  });

  it("extracts the `name` field from object-shape entries", () => {
    expect(
      parseRecipeTools(
        JSON.stringify([{ name: "gmail" }, { name: "slack" }]),
      ),
    ).toBe("gmail, slack");
  });

  it("drops malformed entries instead of rejecting the whole field", () => {
    const mixed = JSON.stringify(["http_request", { name: "gmail" }, 42, null, { type: "no_name" }]);
    expect(parseRecipeTools(mixed)).toBe("http_request, gmail");
  });

  it("returns empty string for malformed JSON (parse failure)", () => {
    expect(parseRecipeTools("not valid {{")).toBe("");
  });

  it("returns empty string when JSON parses to a non-array", () => {
    expect(parseRecipeTools(JSON.stringify({ tools: ["a"] }))).toBe("");
  });
});

describe("mergeRecipeIntoDraft", () => {
  const baseDraft: IntentDraft = { ...EMPTY_DRAFT };

  it("replaces task with the recipe description on apply", () => {
    const out = mergeRecipeIntoDraft(
      { ...baseDraft, task: "summarize email" },
      {
        name: "Email Triage Manager",
        description: "Classify incoming support emails into urgent / normal / spam",
        tool_requirements: null,
      },
    );
    expect(out.task).toBe(
      "Classify incoming support emails into urgent / normal / spam",
    );
  });

  it("falls back to the recipe name when description is null/empty", () => {
    expect(
      mergeRecipeIntoDraft(baseDraft, {
        name: "Email Triage Manager",
        description: null,
        tool_requirements: null,
      }).task,
    ).toBe("Email Triage Manager");
    expect(
      mergeRecipeIntoDraft(baseDraft, {
        name: "Email Triage Manager",
        description: "   ",
        tool_requirements: null,
      }).task,
    ).toBe("Email Triage Manager");
  });

  it("pre-fills tools when the user hasn't already typed any", () => {
    const out = mergeRecipeIntoDraft(baseDraft, {
      name: "X",
      description: "do thing",
      tool_requirements: JSON.stringify(["gmail", "slack"]),
    });
    expect(out.tools).toBe("gmail, slack");
  });

  it("does NOT clobber tools the user has already typed", () => {
    const out = mergeRecipeIntoDraft(
      { ...baseDraft, tools: "Notion only" },
      {
        name: "X",
        description: "do thing",
        tool_requirements: JSON.stringify(["gmail", "slack"]),
      },
    );
    expect(out.tools).toBe("Notion only");
  });

  it("leaves when/output/review untouched", () => {
    const filled: IntentDraft = {
      task: "old",
      when: "every weekday",
      output: "JSON list",
      tools: "",
      review: "manager",
      messaging: "",
    };
    const out = mergeRecipeIntoDraft(filled, {
      name: "Recipe",
      description: "new task description",
      tool_requirements: JSON.stringify(["gmail"]),
    });
    expect(out.when).toBe("every weekday");
    expect(out.output).toBe("JSON list");
    expect(out.review).toBe("manager");
    expect(out.task).toBe("new task description");
    expect(out.tools).toBe("gmail");
  });
});
