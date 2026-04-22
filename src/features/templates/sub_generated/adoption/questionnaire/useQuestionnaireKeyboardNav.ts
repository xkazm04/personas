import { useEffect } from 'react';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import type { QuestionnaireNormalizedOption } from './types';

interface KeyboardNavArgs {
  currentQuestion: TransformQuestionResponse | undefined;
  currentOptions: QuestionnaireNormalizedOption[];
  currentIsStackable: boolean;
  isCurrentBlocked: boolean;
  currentAnswered: boolean;
  isAtEnd: boolean;
  canSubmit: boolean;
  next: () => void;
  prev: () => void;
  onSubmit: () => void;
  onAnswerUpdated: (questionId: string, answer: string) => void;
}

/**
 * Wires three keyboard shortcuts with consistent "don't interfere with
 * typing" semantics:
 *
 *   1. Digit 1-9 → select the nth stacked option (when the current question
 *      is stackable and the user isn't typing in an input/textarea).
 *   2. Enter → submit (last step + fully answered) OR advance one step.
 *      Shift+Enter in a textarea keeps the native newline.
 *   3. ArrowLeft / ArrowRight → navigate between questions (not while typing,
 *      so textareas can still use arrow keys for caret motion).
 */
export function useQuestionnaireKeyboardNav({
  currentQuestion,
  currentOptions,
  currentIsStackable,
  isCurrentBlocked,
  currentAnswered,
  isAtEnd,
  canSubmit,
  next,
  prev,
  onSubmit,
  onAnswerUpdated,
}: KeyboardNavArgs): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      const isInput = tag === 'INPUT';
      const isTextarea = tag === 'TEXTAREA';
      const isTyping = isInput || isTextarea || target.isContentEditable;

      if (
        !isTyping &&
        currentQuestion &&
        currentIsStackable &&
        !isCurrentBlocked &&
        e.key >= '1' &&
        e.key <= '9'
      ) {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < currentOptions.length) {
          e.preventDefault();
          const opt = currentOptions[idx]!;
          onAnswerUpdated(currentQuestion.id, opt.value);
          return;
        }
      }

      if (e.key === 'Enter') {
        if (isTextarea && e.shiftKey) return;
        if (isInput) {
          const inputType = (target as HTMLInputElement).type;
          if (inputType && inputType !== 'text' && inputType !== '' && inputType !== 'search') return;
        }
        if (isAtEnd && canSubmit) {
          e.preventDefault();
          onSubmit();
          return;
        }
        if (currentAnswered) {
          e.preventDefault();
          next();
        }
        return;
      }
      if (isTyping) return;
      if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    currentQuestion,
    currentOptions,
    currentIsStackable,
    isCurrentBlocked,
    currentAnswered,
    isAtEnd,
    canSubmit,
    next,
    prev,
    onSubmit,
    onAnswerUpdated,
  ]);
}
