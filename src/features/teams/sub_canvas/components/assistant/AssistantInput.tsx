import { useRef, useEffect } from 'react';
import { Send } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useTranslation } from '@/i18n/useTranslation';

const EXAMPLE_QUERIES = [
  'Code review pipeline with testing',
  'Content writing and editing team',
  'Research and analysis workflow',
  'Data processing pipeline',
];

interface AssistantInputProps {
  query: string;
  loading: boolean;
  showExamples: boolean;
  onQueryChange: (q: string) => void;
  onSubmit: () => void;
  onExampleClick: (example: string) => void;
  autoFocus: boolean;
}

export default function AssistantInput({
  query,
  loading,
  showExamples,
  onQueryChange,
  onSubmit,
  onExampleClick,
  autoFocus,
}: AssistantInputProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  return (
    <div className="p-3">
      <div className="flex gap-2">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
          placeholder={t.pipeline.describe_pipeline}
          className="flex-1 px-3 py-2 rounded-modal bg-secondary/60 border border-primary/15 typo-body text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:border-indigo-500/40 transition-colors"
        />
        <button
          onClick={onSubmit}
          disabled={!query.trim() || loading}
          className="p-2 rounded-card bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {loading ? (
            <LoadingSpinner size="sm" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {/* Example queries */}
      {showExamples && (
        <div className="mt-2 flex flex-wrap gap-1">
          {EXAMPLE_QUERIES.map((ex) => (
            <button
              key={ex}
              onClick={() => onExampleClick(ex)}
              className="px-2 py-0.5 rounded-card bg-secondary/50 border border-primary/10 typo-body text-foreground hover:text-foreground/95 hover:bg-secondary/70 transition-colors"
            >
              {ex}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
