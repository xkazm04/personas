import { useTranslation } from '@/i18n/useTranslation';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { Listbox } from '@/features/shared/components/forms/Listbox';

interface DiffHeaderProps {
  runs: [string, number][];
  runA: string;
  runB: string;
  onRunAChange: (id: string) => void;
  onRunBChange: (id: string) => void;
}

function shortId(id: string) {
  return id.length > 8 ? id.slice(0, 8) : id;
}

interface RunPickerProps {
  /** Which side of the comparison this picker fills — shown on the trigger so
   *  the role stays readable after the placeholder option is gone. */
  roleLabel: string;
  runs: [string, number][];
  value: string;
  /** The run picked on the other side; it cannot be picked here too. */
  excluded: string;
  onChange: (id: string) => void;
}

function RunPicker({ roleLabel, runs, value, excluded, onChange }: RunPickerProps) {
  const selectable = runs.filter(([id]) => id !== excluded);
  const selected = runs.find(([id]) => id === value);

  return (
    <Listbox
      ariaLabel={roleLabel}
      className="flex-1 min-w-0"
      itemCount={selectable.length}
      onSelectFocused={(i) => {
        const picked = selectable[i];
        if (picked) onChange(picked[0]);
      }}
      renderTrigger={({ isOpen, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          className="w-full inline-flex items-center justify-between gap-1 typo-caption bg-primary/5 border border-primary/10 rounded-card px-1.5 py-1 text-foreground hover:border-primary/20 focus-visible:outline-none focus-visible:border-violet-500/30 transition-colors"
        >
          <span className="truncate">
            <span className="text-foreground">{roleLabel}</span>{' '}
            {selected ? `${shortId(selected[0])} (${selected[1]})` : '—'}
          </span>
          <ChevronDown className={`w-3 h-3 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      )}
    >
      {({ close, focusIndex }) => (
        <div className="py-1 bg-secondary/95">
          {selectable.map(([id, count], i) => (
            <button
              key={id}
              type="button"
              role="option"
              aria-selected={id === value}
              onClick={() => {
                onChange(id);
                close();
              }}
              className={`w-full text-left px-2 py-1 typo-caption transition-colors ${
                i === focusIndex || id === value
                  ? 'bg-primary/10 text-foreground'
                  : 'text-foreground/80 hover:bg-primary/5'
              }`}
            >
              {shortId(id)} ({count})
            </button>
          ))}
        </div>
      )}
    </Listbox>
  );
}

export default function DiffHeader({ runs, runA, runB, onRunAChange, onRunBChange }: DiffHeaderProps) {
  const { t } = useTranslation();
  const pt = t.pipeline;
  return (
    <div className="flex items-center gap-1.5 px-1">
      <RunPicker roleLabel={pt.base_run} runs={runs} value={runA} excluded={runB} onChange={onRunAChange} />
      <ArrowRight className="w-3 h-3 text-foreground flex-shrink-0" />
      <RunPicker roleLabel={pt.compare_run} runs={runs} value={runB} excluded={runA} onChange={onRunBChange} />
    </div>
  );
}
