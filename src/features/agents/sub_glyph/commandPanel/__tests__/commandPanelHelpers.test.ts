// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseRecipeNameList } from "../commandPanelHelpers";

describe("parseRecipeNameList", () => {
  it("returns [] for null/undefined/empty inputs", () => {
    expect(parseRecipeNameList(null)).toEqual([]);
    expect(parseRecipeNameList(undefined)).toEqual([]);
    expect(parseRecipeNameList("")).toEqual([]);
  });

  it("keeps a string-array requirement in order", () => {
    expect(parseRecipeNameList(JSON.stringify(["http_request", "file_read"]))).toEqual([
      "http_request",
      "file_read",
    ]);
  });

  it("extracts name / service_type / connector from object-shape entries", () => {
    expect(
      parseRecipeNameList(
        JSON.stringify([{ name: "gmail" }, { service_type: "slack" }, { connector: "notion" }]),
      ),
    ).toEqual(["gmail", "slack", "notion"]);
  });

  it("reads an object with a connectors array", () => {
    expect(parseRecipeNameList(JSON.stringify({ connectors: ["github"] }))).toEqual(["github"]);
  });

  it("drops malformed entries instead of rejecting the whole field", () => {
    const mixed = JSON.stringify(["http_request", { name: "gmail" }, 42, null, { type: "no_name" }]);
    expect(parseRecipeNameList(mixed)).toEqual(["http_request", "gmail"]);
  });

  it("returns [] for malformed JSON or an unrecognised object", () => {
    expect(parseRecipeNameList("not valid {{")).toEqual([]);
    expect(parseRecipeNameList(JSON.stringify({ tools: ["a"] }))).toEqual([]);
  });
});
