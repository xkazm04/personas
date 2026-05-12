import { Check } from 'lucide-react';

/**
 * Subtle inline checkmark that fades in/out to confirm an auto-save.
 * 14px emerald check with a 300ms opacity transition.
 * Keeps its layout space when invisible to prevent shift.
 */
export function SaveFeedbackCheck({ visible }: { visible: boolean }) {
  return (
    <Check
      className={`w-3.5 h-3.5 text-emerald-400 transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      aria-hidden="true"
    />
  );
}
