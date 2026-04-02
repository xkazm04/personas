import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// ---------------------------------------------------------------------------
// Mock useMatrixBuild
// ---------------------------------------------------------------------------

const mockHandleGenerate = vi.fn().mockResolvedValue(undefined);
const mockHandleAnswer = vi.fn().mockResolvedValue(undefined);
const mockHandleCancel = vi.fn().mockResolvedValue(undefined);

let mockBuildReturn = {
  buildPhase: "initializing" as string,
  cellStates: {} as Record<string, string>,
  pendingQuestions: [] as Array<{ cellKey: string; question: string; options: string[] | null }>,
  completeness: 0,
  outputLines: [] as string[],
  buildError: null as string | null,
  isBuilding: false,
  isIdle: true,
  handleGenerate: mockHandleGenerate,
  handleAnswer: mockHandleAnswer,
  handleCancel: mockHandleCancel,
};

vi.mock("../useMatrixBuild", () => ({
  useMatrixBuild: vi.fn(() => mockBuildReturn),
}));

// ---------------------------------------------------------------------------
// Mock PersonaMatrix -- capture props for assertion
// ---------------------------------------------------------------------------

let capturedMatrixProps: Record<string, unknown> = {};

vi.mock(
  "@/features/templates/sub_generated/gallery/matrix/PersonaMatrix",
  () => ({
    PersonaMatrix: (props: Record<string, unknown>) => {
      capturedMatrixProps = props;
      return <div data-testid="persona-matrix" />;
    },
  }),
);

// ---------------------------------------------------------------------------
// Mock stores
// ---------------------------------------------------------------------------

const mockSetIsCreatingPersona = vi.fn();
const mockCreatePersona = vi.fn().mockResolvedValue({ id: "draft-123" });

vi.mock("@/stores/systemStore", () => ({
  useSystemStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      setIsCreatingPersona: mockSetIsCreatingPersona,
      resumeDraftId: null,
      setResumeDraftId: vi.fn(),
    }),
  ),
}));

vi.mock("@/stores/agentStore", () => ({
  useAgentStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      createPersona: mockCreatePersona,
    }),
  ),
}));

vi.mock("@/stores/pipelineStore", () => ({
  usePipelineStore: Object.assign(
    vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        groups: [],
        movePersonaToGroup: vi.fn(),
        createGroup: vi.fn(),
      }),
    ),
    {
      getState: () => ({
        groups: [],
        movePersonaToGroup: vi.fn(),
        createGroup: vi.fn(),
      }),
    },
  ),
}));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { UnifiedMatrixEntry } from "../UnifiedMatrixEntry";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("UnifiedMatrixEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedMatrixProps = {};
    mockBuildReturn = {
      buildPhase: "initializing",
      cellStates: {},
      pendingQuestions: [],
      completeness: 0,
      outputLines: [],
      buildError: null,
      isBuilding: false,
      isIdle: true,
      handleGenerate: mockHandleGenerate,
      handleAnswer: mockHandleAnswer,
      handleCancel: mockHandleCancel,
    };
  });

  // -- Rendering -----------------------------------------------------------

  it("renders PersonaMatrix with variant='creation'", () => {
    render(<UnifiedMatrixEntry />);
    expect(screen.getByTestId("persona-matrix")).toBeDefined();
    expect(capturedMatrixProps.variant).toBe("creation");
  });

  it("renders PersonaMatrix with hideHeader", () => {
    render(<UnifiedMatrixEntry />);
    expect(capturedMatrixProps.hideHeader).toBe(true);
  });

  it("does NOT render mode tabs (build/chat/matrix)", () => {
    render(<UnifiedMatrixEntry />);
    // No mode tabs should exist in the component's DOM
    expect(screen.queryByText("Build")).toBeNull();
    expect(screen.queryByText("Chat")).toBeNull();
    expect(screen.queryByText("Matrix")).toBeNull();
  });

  it("does NOT render wizard step navigation", () => {
    render(<UnifiedMatrixEntry />);
    // No step indicators or navigation
    expect(screen.queryByText("Step 1")).toBeNull();
    expect(screen.queryByText("Step 2")).toBeNull();
    expect(screen.queryByText("Next")).toBeNull();
    expect(screen.queryByText("Back")).toBeNull();
  });

  // -- Intent text --------------------------------------------------------

  it("passes intentText to PersonaMatrix", () => {
    render(<UnifiedMatrixEntry />);
    // Initial state should be empty string
    expect(capturedMatrixProps.intentText).toBe("");
  });

  it("provides onIntentChange handler to PersonaMatrix", () => {
    render(<UnifiedMatrixEntry />);
    expect(typeof capturedMatrixProps.onIntentChange).toBe("function");
  });

  // -- Build state passthrough --------------------------------------------

  it("passes isRunning reflecting build.isBuilding", () => {
    mockBuildReturn = { ...mockBuildReturn, isBuilding: true };
    render(<UnifiedMatrixEntry />);
    expect(capturedMatrixProps.isRunning).toBe(true);
  });

  it("passes completeness reflecting build.completeness", () => {
    mockBuildReturn = { ...mockBuildReturn, completeness: 75 };
    render(<UnifiedMatrixEntry />);
    expect(capturedMatrixProps.completeness).toBe(75);
  });

  it("passes cliOutputLines reflecting build.outputLines", () => {
    mockBuildReturn = { ...mockBuildReturn, outputLines: ["line1", "line2"] };
    render(<UnifiedMatrixEntry />);
    expect(capturedMatrixProps.cliOutputLines).toEqual(["line1", "line2"]);
  });

  it("passes buildLocked reflecting build.isBuilding", () => {
    mockBuildReturn = { ...mockBuildReturn, isBuilding: true };
    render(<UnifiedMatrixEntry />);
    expect(capturedMatrixProps.buildLocked).toBe(true);
  });

  // -- Launch disabled ----------------------------------------------------

  it("sets launchDisabled true when intent is empty", () => {
    render(<UnifiedMatrixEntry />);
    // Intent starts empty, so launch should be disabled
    expect(capturedMatrixProps.launchDisabled).toBe(true);
  });

  it("sets launchDisabled true when build is running", () => {
    mockBuildReturn = { ...mockBuildReturn, isBuilding: true };
    render(<UnifiedMatrixEntry />);
    expect(capturedMatrixProps.launchDisabled).toBe(true);
  });

});
