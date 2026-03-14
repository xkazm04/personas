/**
 * Spatial Q&A Popover -- anchored floating panel for in-grid questions.
 *
 * When the CLI needs user input during a matrix build, this popover appears
 * directly on the highlighted cell. Questions appear WHERE they matter in
 * the grid, not in a separate chat panel.
 *
 * Multiple popovers can be visible simultaneously (one per pending question).
 * Supports both multiple-choice (CLI provides options) and free-text input.
 *
 * Renders via FloatingPortal to escape the grid's overflow-hidden rounding,
 * preventing z-index clipping issues (Pitfall 5).
 */
import { useState, useEffect, useRef } from "react";
import {
  useFloating,
  offset,
  flip,
  shift,
  autoUpdate,
  FloatingPortal,
} from "@floating-ui/react";
import type { BuildQuestion } from "@/lib/types/buildTypes";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SpatialQuestionPopoverProps {
  /** The DOM element of the cell this popover anchors to */
  referenceElement: HTMLElement | null;
  /** The pending question data */
  question: BuildQuestion;
  /** Callback when user submits an answer */
  onAnswer: (cellKey: string, answer: string) => void;
  /** Whether multiple questions are active (affects visual priority) */
  isPrimaryQuestion?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SpatialQuestionPopover({
  referenceElement,
  question,
  onAnswer,
  isPrimaryQuestion = false,
}: SpatialQuestionPopoverProps) {
  const [freeText, setFreeText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // -- Floating UI positioning ------------------------------------------------

  const { refs, floatingStyles } = useFloating({
    placement: "right",
    middleware: [offset(12), flip(), shift({ padding: 16 })],
    whileElementsMounted: autoUpdate,
  });

  // Sync the external reference element to floating-ui's ref
  useEffect(() => {
    if (referenceElement) {
      refs.setReference(referenceElement);
    }
  }, [referenceElement, refs]);

  // Auto-focus textarea on mount for free-text mode
  useEffect(() => {
    if (!question.options?.length && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [question.options]);

  // -- Guard: don't render without a reference --------------------------------

  if (!referenceElement) return null;

  // -- Answer type detection --------------------------------------------------

  const isMultipleChoice =
    Array.isArray(question.options) && question.options.length > 0;

  // -- Handlers ---------------------------------------------------------------

  function handleOptionClick(option: string) {
    onAnswer(question.cellKey, option);
  }

  function handleFreeTextSubmit() {
    const trimmed = freeText.trim();
    if (trimmed) {
      onAnswer(question.cellKey, trimmed);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Submit on Enter (without Shift for newlines)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleFreeTextSubmit();
    }
  }

  // -- Render -----------------------------------------------------------------

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        className={`
          max-w-xs rounded-xl border bg-background/95 p-3 shadow-xl
          backdrop-blur-sm shadow-primary/10 z-[100]
          ${isPrimaryQuestion ? "border-primary/40 animate-pulse-subtle" : "border-primary/30"}
        `}
        data-testid="spatial-question-popover"
      >
        {/* Question text */}
        <p className="mb-2.5 text-sm text-foreground/90">{question.question}</p>

        {/* Multiple choice options */}
        {isMultipleChoice && (
          <div className="flex flex-col gap-1.5" data-testid="options-container">
            {question.options!.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => handleOptionClick(option)}
                className="rounded-lg border border-primary/20 px-3 py-2 text-left text-sm text-foreground/80 transition-colors hover:bg-primary/10"
                data-testid="option-button"
              >
                {option}
              </button>
            ))}
          </div>
        )}

        {/* Free text input */}
        {!isMultipleChoice && (
          <div className="flex flex-col gap-2" data-testid="freetext-container">
            <textarea
              ref={textareaRef}
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your answer..."
              rows={2}
              className="resize-none rounded-lg border border-primary/15 bg-transparent p-2 text-sm text-foreground/90 placeholder:text-foreground/30 focus:border-primary/40 focus:outline-none"
              data-testid="freetext-input"
            />
            <button
              type="button"
              onClick={handleFreeTextSubmit}
              disabled={!freeText.trim()}
              className="self-end rounded-lg bg-primary/20 px-3 py-1.5 text-sm text-primary transition-colors hover:bg-primary/30 disabled:opacity-40 disabled:cursor-not-allowed"
              data-testid="submit-button"
            >
              Submit
            </button>
          </div>
        )}
      </div>
    </FloatingPortal>
  );
}
