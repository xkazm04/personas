import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BuildQuestion } from "@/lib/types/buildTypes";

// ---------------------------------------------------------------------------
// Import under test
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
  let onRequestClose: ReturnType<typeof vi.fn>;
  let referenceElement: HTMLElement;

  beforeEach(() => {
    onAnswer = vi.fn();
    onRequestClose = vi.fn();
    referenceElement = makeReferenceElement();
  });

  // -- Rendering basics -----------------------------------------------------

  it("renders question text from BuildQuestion.question", () => {
    render(
      <SpatialQuestionPopover
        referenceElement={referenceElement}
        question={makeQuestion({ question: "Pick a connector" })}
        onAnswer={onAnswer}
        isOpen={true}
        onRequestClose={onRequestClose}
      />,
    );
    expect(screen.getByText("Pick a connector")).toBeTruthy();
  });

  it("renders via portal into document.body", () => {
    render(
      <SpatialQuestionPopover
        referenceElement={referenceElement}
        question={makeQuestion()}
        onAnswer={onAnswer}
        isOpen={true}
        onRequestClose={onRequestClose}
      />,
    );
    // The modal renders into document.body via createPortal
    expect(screen.getByTestId("freetext-input")).toBeTruthy();
  });

  it("does not render when referenceElement is null", () => {
    render(
      <SpatialQuestionPopover
        referenceElement={null}
        question={makeQuestion()}
        onAnswer={onAnswer}
        isOpen={true}
        onRequestClose={onRequestClose}
      />,
    );
    expect(screen.queryByTestId("freetext-input")).toBeNull();
  });

  it("does not render when isOpen is false", () => {
    render(
      <SpatialQuestionPopover
        referenceElement={referenceElement}
        question={makeQuestion()}
        onAnswer={onAnswer}
        isOpen={false}
        onRequestClose={onRequestClose}
      />,
    );
    expect(screen.queryByTestId("freetext-input")).toBeNull();
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
        isOpen={true}
        onRequestClose={onRequestClose}
      />,
    );
    expect(screen.getByTestId("option-button-0")).toBeTruthy();
    expect(screen.getByTestId("option-button-1")).toBeTruthy();
    expect(screen.getByTestId("option-button-2")).toBeTruthy();
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
        isOpen={true}
        onRequestClose={onRequestClose}
      />,
    );
    fireEvent.click(screen.getByTestId("option-button-1"));
    expect(onAnswer).toHaveBeenCalledWith("triggers", "Schedule");
  });

  it("always shows textarea (free text input is always available)", () => {
    render(
      <SpatialQuestionPopover
        referenceElement={referenceElement}
        question={makeQuestion({ options: ["A", "B"] })}
        onAnswer={onAnswer}
        isOpen={true}
        onRequestClose={onRequestClose}
      />,
    );
    // Free text input is always shown, even with options
    expect(screen.getByTestId("freetext-input")).toBeTruthy();
  });

  // -- Free text mode -------------------------------------------------------

  it("renders textarea and submit button when options is null", () => {
    render(
      <SpatialQuestionPopover
        referenceElement={referenceElement}
        question={makeQuestion({ options: null })}
        onAnswer={onAnswer}
        isOpen={true}
        onRequestClose={onRequestClose}
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
        isOpen={true}
        onRequestClose={onRequestClose}
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
        isOpen={true}
        onRequestClose={onRequestClose}
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
        isOpen={true}
        onRequestClose={onRequestClose}
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
        isOpen={true}
        onRequestClose={onRequestClose}
      />,
    );
    expect(screen.queryByTestId("option-button-0")).toBeNull();
  });

  // -- No skip button -------------------------------------------------------

  it("does not render a skip button", () => {
    render(
      <SpatialQuestionPopover
        referenceElement={referenceElement}
        question={makeQuestion()}
        onAnswer={onAnswer}
        isOpen={true}
        onRequestClose={onRequestClose}
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
