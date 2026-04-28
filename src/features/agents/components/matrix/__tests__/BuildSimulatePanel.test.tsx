import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  BuildSimulatePanel,
  extractUseCases,
} from "../BuildSimulatePanel";

// Mock the API surface — exercise the panel's wiring without touching IPC.
vi.mock("@/api/agents/buildSession", () => ({
  simulateBuildDraft: vi.fn(),
  getSimulationArtefacts: vi.fn(),
}));

import {
  simulateBuildDraft,
  getSimulationArtefacts,
} from "@/api/agents/buildSession";

const mockSimulate = simulateBuildDraft as ReturnType<typeof vi.fn>;
const mockArtefacts = getSimulationArtefacts as ReturnType<typeof vi.fn>;

const SAMPLE_DRAFT = {
  use_cases: [
    {
      id: "uc_morning_digest",
      title: "Morning Digest",
      description: "Daily 7am summary of overnight email",
      sample_input: { max: 5 },
    },
    {
      id: "uc_weekly_review",
      title: "Weekly Review",
      sample_input: { range_days: 7 },
    },
  ],
};

beforeEach(() => {
  mockSimulate.mockReset();
  mockArtefacts.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Pure helper
// ---------------------------------------------------------------------------

describe("extractUseCases", () => {
  it("returns empty array for null / non-object draft", () => {
    expect(extractUseCases(null)).toEqual([]);
    expect(extractUseCases(undefined)).toEqual([]);
    expect(extractUseCases("not an object")).toEqual([]);
    expect(extractUseCases(42)).toEqual([]);
  });

  it("extracts structured use_cases (snake_case key)", () => {
    const out = extractUseCases({
      use_cases: [{ id: "uc_a", title: "A", sample_input: { x: 1 } }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe("uc_a");
    expect(out[0]?.title).toBe("A");
    expect(out[0]?.sample_input).toEqual({ x: 1 });
  });

  it("extracts structured use_cases (camelCase key — promoted shape)", () => {
    const out = extractUseCases({
      useCases: [{ id: "uc_a", title: "A" }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe("uc_a");
  });

  it("fabricates id and title for entries missing them", () => {
    const out = extractUseCases({
      use_cases: [{ description: "no id no title" }],
    });
    expect(out[0]?.id).toBe("uc_idx_0");
    expect(out[0]?.title).toBe("Capability 1");
  });

  it("handles legacy simple-string use cases", () => {
    const out = extractUseCases({
      use_cases: ["Send daily email digest"],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe("uc_idx_0");
    expect(out[0]?.title).toContain("Send daily");
  });

  it("truncates long simple-string titles to ~60 chars with ellipsis", () => {
    const long = "x".repeat(120);
    const out = extractUseCases({ use_cases: [long] });
    expect(out[0]?.title.length).toBeLessThan(long.length);
    expect(out[0]?.title.endsWith("…")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

describe("BuildSimulatePanel", () => {
  it("renders a 'no capabilities' message when the draft has no use_cases", () => {
    render(
      <BuildSimulatePanel
        isOpen
        onClose={() => {}}
        sessionId="sess_1"
        draft={null}
      />,
    );
    expect(screen.getByText(/no capabilities available/i)).toBeTruthy();
  });

  it("populates the dropdown with use cases from the draft and defaults to the first", () => {
    render(
      <BuildSimulatePanel
        isOpen
        onClose={() => {}}
        sessionId="sess_1"
        draft={SAMPLE_DRAFT}
      />,
    );
    const select = screen.getByTestId(
      "build-simulate-uc-select",
    ) as HTMLSelectElement;
    expect(select.value).toBe("uc_morning_digest");
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(["uc_morning_digest", "uc_weekly_review"]);
  });

  it("calls simulateBuildDraft + getSimulationArtefacts on Run and renders artefacts", async () => {
    mockSimulate.mockResolvedValueOnce({
      id: "exec_abc12345",
      persona_id: "p1",
      status: "completed",
    });
    mockArtefacts.mockResolvedValueOnce({
      executionId: "exec_abc12345",
      reviews: [
        {
          id: "r1",
          execution_id: "exec_abc12345",
          persona_id: "p1",
          title: "Review draft email",
          description: "Outbound email to CFO needs review",
          severity: "medium",
          status: "pending",
          reviewer_notes: null,
          use_case_id: "uc_morning_digest",
          created_at: "2026-04-27T20:00:00Z",
          updated_at: "2026-04-27T20:00:00Z",
        },
      ],
      memories: [
        {
          id: "m1",
          persona_id: "p1",
          title: "User prefers brief summaries",
          content: "Cut digest length in half going forward.",
          category: "preference",
          importance: 4,
          created_at: "2026-04-27T20:00:01Z",
        },
      ],
    });

    render(
      <BuildSimulatePanel
        isOpen
        onClose={() => {}}
        sessionId="sess_1"
        draft={SAMPLE_DRAFT}
      />,
    );

    fireEvent.click(screen.getByTestId("build-simulate-run"));

    await waitFor(() => {
      expect(mockSimulate).toHaveBeenCalledWith(
        "sess_1",
        "uc_morning_digest",
        null,
      );
    });
    await waitFor(() => {
      expect(mockArtefacts).toHaveBeenCalledWith("exec_abc12345");
    });

    // Artefacts subview rendered with both review + memory
    expect(await screen.findByText(/Review draft email/i)).toBeTruthy();
    expect(screen.getByText(/User prefers brief summaries/i)).toBeTruthy();
  });

  it("passes the user-typed input override (trimmed) instead of null", async () => {
    mockSimulate.mockResolvedValueOnce({
      id: "exec_x",
      persona_id: "p1",
      status: "completed",
    });
    mockArtefacts.mockResolvedValueOnce({
      executionId: "exec_x",
      reviews: [],
      memories: [],
    });

    render(
      <BuildSimulatePanel
        isOpen
        onClose={() => {}}
        sessionId="sess_1"
        draft={SAMPLE_DRAFT}
      />,
    );

    fireEvent.change(screen.getByTestId("build-simulate-input"), {
      target: { value: "  {\"max\":1}  " },
    });
    fireEvent.click(screen.getByTestId("build-simulate-run"));

    await waitFor(() => {
      expect(mockSimulate).toHaveBeenCalledWith(
        "sess_1",
        "uc_morning_digest",
        '{"max":1}',
      );
    });
  });

  it("shows the error message in the alert region when simulate fails", async () => {
    mockSimulate.mockRejectedValueOnce(
      new Error("use_case_id 'uc_x' not found in draft agent_ir"),
    );

    render(
      <BuildSimulatePanel
        isOpen
        onClose={() => {}}
        sessionId="sess_1"
        draft={SAMPLE_DRAFT}
      />,
    );

    fireEvent.click(screen.getByTestId("build-simulate-run"));

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toMatch(/not found/i);
    });
    expect(mockArtefacts).not.toHaveBeenCalled();
  });

  it("disables the run button when no sessionId is available", () => {
    render(
      <BuildSimulatePanel
        isOpen
        onClose={() => {}}
        sessionId={null}
        draft={SAMPLE_DRAFT}
      />,
    );
    const btn = screen.getByTestId("build-simulate-run") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
