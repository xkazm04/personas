/**
 * Spatial Question Modal -- dimension Q&A during matrix build.
 *
 * Features:
 * - Numbered options (press 1-4 to select and submit instantly)
 * - Free-text input always available below options
 * - Wider modal with promoted question typography
 * - Keyboard shortcuts for fast interaction
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { HelpCircle, Send, X, Hash } from "lucide-react";
import type { BuildQuestion } from "@/lib/types/buildTypes";

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

const DIMENSION_COLORS: Record<string, string> = {
  "use-cases": "text-violet-400",
  connectors: "text-cyan-400",
  triggers: "text-amber-400",
  "human-review": "text-rose-400",
  messages: "text-blue-400",
  memory: "text-purple-400",
  "error-handling": "text-orange-400",
  events: "text-teal-400",
};

interface SpatialQuestionPopoverProps {
  referenceElement: HTMLElement | null;
  question: BuildQuestion;
  onAnswer: (cellKey: string, answer: string) => void;
  isOpen?: boolean;
  onRequestOpen?: () => void;
  onRequestClose?: () => void;
}

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

  const options = question.options ?? [];
  const hasOptions = options.length > 0;
  const dimensionLabel = DIMENSION_LABELS[question.cellKey] ?? question.cellKey;
  const dimensionColor = DIMENSION_COLORS[question.cellKey] ?? "text-primary";

  // Focus textarea when no options
  useEffect(() => {
    if (!hasOptions && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [hasOptions]);

  // Keyboard: Escape to close, 1-9 for numbered options
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return; }

      // Number keys 1-9 select options instantly
      if (hasOptions && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= options.length) {
          // Don't trigger if user is typing in textarea
          if (document.activeElement?.tagName === 'TEXTAREA') return;
          e.preventDefault();
          onAnswer(question.cellKey, options[num - 1]!);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onAnswer, question.cellKey, hasOptions, options]);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose();
  }

  function handleFreeTextSubmit() {
    const trimmed = freeText.trim();
    if (trimmed) onAnswer(question.cellKey, trimmed);
  }

  return createPortal(
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      {/* Modal — wider (max-w-xl → ~36rem ≈ 20% more than max-w-lg ~32rem) */}
      <div className="w-full max-w-xl max-h-[80vh] bg-background border border-primary/20 rounded-2xl shadow-elevation-4 shadow-primary/10 flex flex-col overflow-hidden">
        {/* Header with dimension color accent */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-primary/10 bg-primary/[0.03]">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center`}>
              <HelpCircle className={`w-5 h-5 ${dimensionColor}`} />
            </div>
            <div>
              <h3 className={`text-base font-bold ${dimensionColor}`}>
                {dimensionLabel}
              </h3>
              <p className="text-[10px] text-muted-foreground/40 uppercase tracking-wider">
                Agent Configuration
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-foreground/[0.06] transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground/50" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Question — promoted typography */}
          <p className="text-[15px] font-medium text-foreground leading-relaxed mb-5">
            {question.question}
          </p>

          {/* Numbered options */}
          {hasOptions && (
            <div className="flex flex-col gap-2 mb-5" data-testid="options-container">
              {options.map((option, idx) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onAnswer(question.cellKey, option)}
                  className="w-full flex items-start gap-3 rounded-xl border border-primary/12 bg-card-bg px-4 py-3 text-left transition-all hover:bg-primary/8 hover:border-primary/25 hover:shadow-elevation-2 hover:shadow-primary/5 group"
                  data-testid={`option-button-${idx}`}
                >
                  {/* Number badge */}
                  <span className="flex-shrink-0 w-6 h-6 rounded-md bg-primary/10 border border-primary/15 flex items-center justify-center text-[11px] font-bold text-primary/70 group-hover:bg-primary/20 group-hover:text-primary transition-colors mt-0.5">
                    {idx + 1}
                  </span>
                  <span className="text-sm text-foreground/80 leading-relaxed">{option}</span>
                </button>
              ))}
              <p className="text-[10px] text-muted-foreground/35 mt-1 flex items-center gap-1.5">
                <Hash className="w-3 h-3" />
                Press 1-{options.length} to select instantly
              </p>
            </div>
          )}

          {/* Free text input — always shown */}
          <div className="flex flex-col gap-2" data-testid="freetext-container">
            {hasOptions && (
              <div className="flex items-center gap-2 mb-1">
                <div className="flex-1 h-px bg-primary/8" />
                <span className="text-[10px] text-muted-foreground/40 uppercase tracking-wider font-medium">
                  Or type a custom answer
                </span>
                <div className="flex-1 h-px bg-primary/8" />
              </div>
            )}
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
              rows={2}
              className="w-full resize-none rounded-xl border border-primary/12 bg-card-bg p-3 text-sm text-foreground/90 placeholder:text-foreground/25 focus:border-primary/30 focus:outline-none focus:ring-1 focus:ring-primary/15 transition-colors"
              data-testid="freetext-input"
            />
            <button
              type="button"
              onClick={handleFreeTextSubmit}
              disabled={!freeText.trim()}
              className="self-end inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-4 py-2 text-sm font-medium transition-colors hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed"
              data-testid="submit-button"
            >
              <Send className="w-3.5 h-3.5" />
              Submit
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function SpatialQuestionPopover({
  referenceElement,
  question,
  onAnswer,
  isOpen: controlledOpen,
  onRequestOpen: _onRequestOpen,
  onRequestClose,
}: SpatialQuestionPopoverProps) {
  const handleAnswer = useCallback(
    (cellKey: string, answer: string) => {
      onAnswer(cellKey, answer);
    },
    [onAnswer],
  );

  if (!referenceElement || !controlledOpen) return null;

  return (
    <QuestionModal
      question={question}
      onAnswer={handleAnswer}
      onClose={() => onRequestClose?.()}
    />
  );
}
