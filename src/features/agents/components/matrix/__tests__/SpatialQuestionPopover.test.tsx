import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BuildQuestion } from "@/lib/types/buildTypes";

// ---------------------------------------------------------------------------
// Mock @floating-ui/react -- we test rendering/interaction, not positioning
// ---------------------------------------------------------------------------

vi.mock("@floating-ui/react", () => {
  const setReference = vi.fn();
  const setFloating = vi.fn();

  return {
    useFloating: vi.fn(() => ({
      refs: {
        setReference,
        setFloating,
      },
      floatingStyles: { position: "absolute" as const, top: 0, left: 0 },
      placement: "right" as const,
    })),
    offset: vi.fn(() => ({})),
    flip: vi.fn(() => ({})),
    shift: vi.fn(() => ({})),
    autoUpdate: vi.fn(),
    FloatingPortal: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="floating-portal">{children}</div>
    ),
  };
});

// ---------------------------------------------------------------------------
// Import under test (AFTER mocks)
// ---------------------------------------------------------------------------

import { SpatialQuestionPopover } from "../SpatialQuestionPopover";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQuestion(overrides: Partial<BuildQuestion> = {}): BuildQuestion {
  return {
    cellKey: "connectors",
    question: "Which API should this agent use?",
    options: null,
    ...overrides,
  };
}

function makeReferenceElement(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SpatialQuestionPopover", () => {
  let onAnswer: ReturnType<typeof vi.fn>;
  let referenceElement: HTMLElement;

  beforeEach(() => {
    onAnswer = vi.fn();
    referenceElement = makeReferenceElement();
  });

  // -- Rendering basics -----------------------------------------------------

  it("renders question text from BuildQuestion.question", () => {
    render(
      <SpatialQuestionPopover
        referenceElement={referenceElement}
        question={makeQuestion({ question: "Pick a connector" })}
        onAnswer={onAnswer}
      />,
    );
    expect(screen.getByText("Pick a connector")).toBeTruthy();
  });

  it("renders inside a FloatingPortal", () => {
    render(
      <SpatialQuestionPopover
        referenceElement={referenceElement}
        question={makeQuestion()}
        onAnswer={onAnswer}
      />,
    );
    expect(screen.getByTestId("floating-portal")).toBeTruthy();
  });

  it("does not render when referenceElement is null", () => {
    render(
      <SpatialQuestionPopover
        referenceElement={null}
        question={makeQuestion()}
        onAnswer={onAnswer}
      />,
    );
    expect(screen.queryByTestId("spatial-question-popover")).toBeNull();
  });

  // -- Multiple choice mode -------------------------------------------------

  it("renders option buttons when options are provided", () => {
    render(
      <SpatialQuestionPopover
        referenceElement={referenceElement}
        question={makeQuestion({
          options: ["Slack API", "Discord API", "Email SMTP"],
        })}
        onAnswer={onAnswer}
      />,
    );
    const buttons = screen.getAllByTestId("option-button");
    expect(buttons).toHaveLength(3);
    expect(buttons[0].textContent).toBe("Slack API");
    expect(buttons[1].textContent).toBe("Discord API");
    expect(buttons[2].textContent).toBe("Email SMTP");
  });

  it("calls onAnswer with correct cellKey and option text when option is clicked", () => {
    render(
      <SpatialQuestionPopover
        referenceElement={referenceElement}
        question={makeQuestion({
          cellKey: "triggers",
          options: ["Webhook", "Schedule", "Manual"],
        })}
        onAnswer={onAnswer}
      />,
    );
    fireEvent.click(screen.getAllByTestId("option-button")[1]);
    expect(onAnswer).toHaveBeenCalledWith("triggers", "Schedule");
  });

  it("does not render textarea in multiple choice mode", () => {
    render(
      <SpatialQuestionPopover
        referenceElement={referenceElement}
        question={makeQuestion({ options: ["A", "B"] })}
        onAnswer={onAnswer}
      />,
    );
    expect(screen.queryByTestId("freetext-input")).toBeNull();
  });

  // -- Free text mode -------------------------------------------------------

  it("renders textarea and submit button when options is null", () => {
    render(
      <SpatialQuestionPopover
        referenceElement={referenceElement}
        question={makeQuestion({ options: null })}
        onAnswer={onAnswer}
      />,
    );
    expect(screen.getByTestId("freetext-input")).toBeTruthy();
    expect(screen.getByTestId("submit-button")).toBeTruthy();
  });

  it("renders textarea and submit button when options is empty array", () => {
    render(
      <SpatialQuestionPopover
        referenceElement={referenceElement}
        question={makeQuestion({ options: [] })}
        onAnswer={onAnswer}
      />,
    );
    expect(screen.getByTestId("freetext-input")).toBeTruthy();
    expect(screen.getByTestId("submit-button")).toBeTruthy();
  });

  it("calls onAnswer with cellKey and typed text when submit is clicked", async () => {
    const user = userEvent.setup();
    render(
      <SpatialQuestionPopover
        referenceElement={referenceElement}
        question={makeQuestion({
          cellKey: "memory",
          options: null,
        })}
        onAnswer={onAnswer}
      />,
    );

    const textarea = screen.getByTestId("freetext-input");
    await user.type(textarea, "Use Redis for caching");
    await user.click(screen.getByTestId("submit-button"));

    expect(onAnswer).toHaveBeenCalledWith("memory", "Use Redis for caching");
  });

  it("does not call onAnswer when submit is clicked with empty text", async () => {
    const user = userEvent.setup();
    render(
      <SpatialQuestionPopover
        referenceElement={referenceElement}
        question={makeQuestion({ options: null })}
        onAnswer={onAnswer}
      />,
    );

    await user.click(screen.getByTestId("submit-button"));
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("does not render option buttons in free text mode", () => {
    render(
      <SpatialQuestionPopover
        referenceElement={referenceElement}
        question={makeQuestion({ options: null })}
        onAnswer={onAnswer}
      />,
    );
    expect(screen.queryByTestId("option-button")).toBeNull();
  });

  // -- No skip button -------------------------------------------------------

  it("does not render a skip button", () => {
    render(
      <SpatialQuestionPopover
        referenceElement={referenceElement}
        question={makeQuestion()}
        onAnswer={onAnswer}
      />,
    );
    // No button containing "skip" text should exist
    const allButtons = screen.queryAllByRole("button");
    const skipButton = allButtons.find((btn) =>
      btn.textContent?.toLowerCase().includes("skip"),
    );
    expect(skipButton).toBeUndefined();
  });
});
