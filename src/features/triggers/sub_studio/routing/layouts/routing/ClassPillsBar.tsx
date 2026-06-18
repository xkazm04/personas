/**
 * ClassPillsBar — USR / SYS / EXT toggleable count pills.
 *
 * Lifted out of the Toolbar so it can render inside the page-level
 * ContentHeader (via the headerExtra callback in TriggersPage).
 */
type ClassKey = 'persona' | 'common' | 'external';

const CLASS_PILLS: ReadonlyArray<{ key: ClassKey; label: string; className: string }> = [
  { key: 'persona',  label: 'USR', className: 'text-violet-400 bg-violet-500/10 border-violet-500/30' },
  { key: 'common',   label: 'SYS', className: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30' },
  { key: 'external', label: 'EXT', className: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
];

interface Props {
  visibleClasses: Set<ClassKey>;
  classCounts: Record<ClassKey, number>;
  onToggle: (c: ClassKey) => void;
}

export function ClassPillsBar({ visibleClasses, classCounts, onToggle }: Props) {
  return (
    <div className="flex items-center gap-1.5 mt-3">
      {CLASS_PILLS.map(({ key, label, className }) => {
        const active = visibleClasses.has(key);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onToggle(key)}
            title={`${active ? 'Hide' : 'Show'} ${label} events (${classCounts[key]})`}
            className={`px-2 py-0.5 rounded-pill typo-label font-semibold uppercase tracking-wider border transition-colors ${
              active ? className : 'text-foreground border-border/40 hover:border-border opacity-60 hover:opacity-100'
            }`}
          >
            {label}
            <span className="ml-1 opacity-70 tabular-nums">{classCounts[key]}</span>
          </button>
        );
      })}
    </div>
  );
}
