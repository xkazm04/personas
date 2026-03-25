import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryResultTable } from "../QueryResultTable";
import type { QueryResult } from "@/api/vault/database/dbSchema";

// Mock the virtualizer so rows render without real DOM dimensions
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        key: i,
        start: i * 32,
        size: 32,
      })),
    getTotalSize: () => count * 32,
    measureElement: () => {},
  }),
}));

function makeResult(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    columns: ["id", "name"],
    rows: [
      [1, "alice"],
      [2, "bob"],
      [3, "charlie"],
    ],
    row_count: 3,
    duration_ms: 42,
    truncated: false,
    ...overrides,
  };
}

describe("QueryResultTable", () => {
  it("renders column headers", () => {
    render(<QueryResultTable result={makeResult()} />);
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
  });

  it("renders rows", () => {
    render(<QueryResultTable result={makeResult()} />);
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.getByText("charlie")).toBeInTheDocument();
  });

  it("renders null cells as NULL", () => {
    render(
      <QueryResultTable
        result={makeResult({
          rows: [[1, null]],
          row_count: 1,
        })}
      />,
    );
    expect(screen.getByText("NULL")).toBeInTheDocument();
  });

  it("renders object cells as JSON", () => {
    const obj = { foo: "bar" };
    render(
      <QueryResultTable
        result={makeResult({
          columns: ["data"],
          rows: [[obj]],
          row_count: 1,
        })}
      />,
    );
    expect(screen.getByText(JSON.stringify(obj))).toBeInTheDocument();
  });

  it("shows truncation warning when truncated", () => {
    render(
      <QueryResultTable result={makeResult({ truncated: true })} />,
    );
    expect(screen.getByText(/truncated/i)).toBeInTheDocument();
  });

  it("shows row count and duration in status bar", () => {
    render(<QueryResultTable result={makeResult()} />);
    expect(screen.getByText("3 rows")).toBeInTheDocument();
    expect(screen.getByText("42ms")).toBeInTheDocument();
  });

  it("shows singular 'row' for single result", () => {
    render(
      <QueryResultTable
        result={makeResult({ rows: [[1, "only"]], row_count: 1 })}
      />,
    );
    expect(screen.getByText("1 row")).toBeInTheDocument();
  });

  it("renders empty state for no rows", () => {
    render(
      <QueryResultTable
        result={makeResult({ columns: [], rows: [], row_count: 0 })}
      />,
    );
    expect(screen.getByText(/no rows returned/i)).toBeInTheDocument();
  });

  it("does not show truncation warning when not truncated", () => {
    render(<QueryResultTable result={makeResult()} />);
    expect(screen.queryByText(/truncated/i)).not.toBeInTheDocument();
  });
});
