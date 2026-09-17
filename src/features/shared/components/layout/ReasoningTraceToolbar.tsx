import { AlertCircle } from 'lucide-react';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { useTranslation } from '@/i18n/useTranslation';
import type { TraceFilter } from './reasoningTraceModel';

/**
 * @catalog ReasoningTraceToolbar — type filter chips, copy-as-markdown and jump-to-error for a live reasoning log. Rendered for you by `ReasoningTrace`.
 */
interface ReasoningTraceToolbarProps {
  filter: TraceFilter;
  onFilterChange: (next: TraceFilter) => void;
  /** Markdown of the currently visible slice; empty disables the copy button. */
  markdown: string;
  /** Present only when the trace holds an error entry. */
  onJumpToError?: () => void;
}

/**
 * The reasoning pane's compact toolbar: type chips, a copy of the visible
 * slice as markdown, and a jump to the latest error row. Split out of
 * `ReasoningTrace` to keep both files well under the 200-line limit.
 */
export function ReasoningTraceToolbar({
  filter,
  onFilterChange,
  markdown,
  onJumpToError,
}: ReasoningTraceToolbarProps) {
  const { t } = useTranslation();

  const chips: { id: TraceFilter; label: string }[] = [
    { id: 'all', label: t.common.all },
    { id: 'tools', label: t.shared.reasoning_trace.filter_tools },
    { id: 'errors', label: t.shared.reasoning_trace.filter_errors },
  ];

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-primary/10">
      <div className="flex items-center gap-1" role="group" aria-label={t.shared.reasoning_trace.filter_label}>
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            aria-pressed={filter === chip.id}
            onClick={() => onFilterChange(chip.id)}
            className={`typo-caption px-2 py-0.5 rounded-interactive transition-colors cursor-pointer ${
              filter === chip.id
                ? 'bg-primary/20 text-foreground'
                : 'text-foreground hover:bg-secondary/40'
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-1">
        {onJumpToError && (
          <button
            type="button"
            onClick={onJumpToError}
            className="flex items-center gap-1 typo-caption px-2 py-0.5 rounded-interactive text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
          >
            <AlertCircle className="w-3 h-3" />
            {t.shared.reasoning_trace.jump_to_error}
          </button>
        )}
        <CopyButton
          text={markdown}
          disabled={markdown.length === 0}
          tooltip={t.shared.reasoning_trace.copy_trace}
        />
      </div>
    </div>
  );
}
