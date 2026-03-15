/**
 * Spatial Question Modal -- full-screen modal for dimension Q&A.
 *
 * When the CLI needs user input during a matrix build, the relevant cell
 * shows a glowing border + question mark icon. Clicking it opens this modal.
 * The modal is styled to match the matrix grid quality.
 */
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { HelpCircle, Send, X } from "lucide-react";
import type { BuildQuestion } from "@/lib/types/buildTypes";

// ---------------------------------------------------------------------------
// Friendly dimension labels
// ---------------------------------------------------------------------------

const DIMENSION_LABELS: Record<string, string> = {
  "use-cases": "Tasks",
  connectors: "Apps & Services",
  triggers: "When It Runs",
  "human-review": "Human Review",
  messages: "Messages",
  memory: "Memory",
  "error-handling": "Error Handling",
  events: "Events",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SpatialQuestionPopoverProps {
  referenceElement: HTMLElement | null;
  question: BuildQuestion;
  onAnswer: (cellKey: string, answer: string) => void;
}

// ---------------------------------------------------------------------------
// QuestionModal -- replaces floating popover with a styled modal
// ---------------------------------------------------------------------------

function QuestionModal({
  question,
  onAnswer,
  onClose,
}: {
  question: BuildQuestion;
  onAnswer: (cellKey: string, answer: string) => void;
  onClose: () => void;
}) {
  const [freeText, setFreeText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const isMultipleChoice =
    Array.isArray(question.options) && question.options.length > 0;
  const dimensionLabel =
    DIMENSION_LABELS[question.cellKey] ?? question.cellKey;

  useEffect(() => {
    if (!isMultipleChoice && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isMultipleChoice]);

  // Close on backdrop click
  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose();
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleOptionClick(option: string) {
    onAnswer(question.cellKey, option);
  }

  function handleFreeTextSubmit() {
    const trimmed = freeText.trim();
    if (trimmed) {
      onAnswer(question.cellKey, trimmed);
    }
  }

  return createPortal(
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg max-h-[80vh] bg-background border border-primary/20 rounded-2xl shadow-2xl shadow-primary/10 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-primary/10 bg-primary/[0.03]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center">
              <HelpCircle className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground/90">
                {dimensionLabel}
              </h3>
              <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">
                Agent Configuration
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-foreground/[0.04] transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground/60" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          <p className="text-sm text-foreground/85 leading-relaxed mb-4">
            {question.question}
          </p>

          {/* Multiple choice options */}
          {isMultipleChoice && (
            <div
              className="flex flex-col gap-2"
              data-testid="options-container"
            >
              {question.options!.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => handleOptionClick(option)}
                  className="w-full rounded-xl border border-primary/15 bg-card-bg px-4 py-3 text-left text-sm text-foreground/80 transition-all hover:bg-primary/10 hover:border-primary/30 hover:shadow-md hover:shadow-primary/5"
                  data-testid="option-button"
                >
                  {option}
                </button>
              ))}
            </div>
          )}

          {/* Free text input */}
          {!isMultipleChoice && (
            <div
              className="flex flex-col gap-3"
              data-testid="freetext-container"
            >
              <textarea
                ref={textareaRef}
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleFreeTextSubmit();
                  }
                }}
                placeholder="Type your answer..."
                rows={3}
                className="w-full resize-none rounded-xl border border-primary/15 bg-card-bg p-3 text-sm text-foreground/90 placeholder:text-foreground/30 focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20 transition-colors"
                data-testid="freetext-input"
              />
              <button
                type="button"
                onClick={handleFreeTextSubmit}
                disabled={!freeText.trim()}
                className="self-end inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-4 py-2 text-sm font-medium transition-colors hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid="submit-button"
              >
                <Send className="w-3.5 h-3.5" />
                Submit
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// SpatialQuestionPopover -- now renders question mark on cell + modal on click
// ---------------------------------------------------------------------------

export function SpatialQuestionPopover({
  referenceElement,
  question,
  onAnswer,
}: SpatialQuestionPopoverProps) {
  // Auto-open modal when question appears — no trigger button needed
  if (!referenceElement) return null;

  return (
    <QuestionModal
      question={question}
      onAnswer={onAnswer}
      onClose={() => {
        // Closing without answering — do nothing, question stays pending
      }}
    />
  );
}
