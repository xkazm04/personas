// Compact time controls used inside the Power Rail (edit mode). Lets
// the user pick an hourly / daily / weekly preset and fine-tune the
// weekday + hour.

import {
  TIME_PRESETS,
  WEEKDAYS,
  clampHour,
  selectionForTimePreset,
  updateTime,
  type TriggerSelection,
} from '../useCasePickerShared';

export function TimeControls({
  selection,
  onChange,
}: {
  selection: TriggerSelection;
  onChange: (next: TriggerSelection) => void;
}) {
  const time = selection.time;
  const sub = time?.preset ?? 'daily';
  const hourOfDay = time?.hourOfDay ?? 9;
  const weekday = time?.weekday ?? 1;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1">
        {TIME_PRESETS.map((p) => {
          const Icon = p.icon;
          const on = sub === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onChange(selectionForTimePreset(p.key, selection))}
              className={`focus-ring inline-flex items-center gap-1 rounded px-2 py-0.5 typo-caption font-medium transition-colors ${
                on
                  ? 'bg-primary/20 text-primary ring-1 ring-primary/40'
                  : 'bg-foreground/[0.04] text-foreground/65 hover:bg-foreground/[0.08]'
              }`}
            >
              <Icon className="w-3 h-3" />
              {p.label}
            </button>
          );
        })}
      </div>
      {sub !== 'hourly' && (
        <div className="flex items-center gap-1.5 typo-caption">
          {sub === 'weekly' && (
            <div className="flex gap-0.5">
              {WEEKDAYS.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => onChange(updateTime(selection, { weekday: i }))}
                  className={`rounded px-1.5 py-0.5 font-mono transition-colors ${
                    weekday === i ? 'bg-primary/25 text-primary' : 'text-foreground/55 hover:text-foreground hover:bg-foreground/[0.05]'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
          <span className="text-foreground/55 font-mono ml-auto">@</span>
          <input
            type="number"
            min={0}
            max={23}
            value={hourOfDay}
            onChange={(e) => onChange(updateTime(selection, { hourOfDay: clampHour(e.target.value) }))}
            className="focus-ring w-12 rounded ring-1 ring-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-foreground text-center tabular-nums"
          />
          <span className="text-foreground/55 font-mono tabular-nums">:00</span>
        </div>
      )}
    </div>
  );
}

export function LED({ on, accent }: { on: boolean; accent: 'primary' | 'info' | 'warning' }) {
  const bg = on
    ? accent === 'primary'
      ? 'bg-primary'
      : accent === 'info'
      ? 'bg-status-info'
      : 'bg-status-warning'
    : 'bg-foreground/20';
  const glow = on
    ? accent === 'primary'
      ? 'shadow-[0_0_6px_var(--color-primary)]'
      : accent === 'info'
      ? 'shadow-[0_0_6px_var(--color-status-info)]'
      : 'shadow-[0_0_6px_var(--color-status-warning)]'
    : '';
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${bg} ${glow}`} />;
}
