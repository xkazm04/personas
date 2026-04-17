import { useMemo } from 'react';
import { ALL_COMPARE_MODELS, type ModelOption } from '../../libs/compareHelpers';

export function ModelDropdown({
  label,
  value,
  onChange,
  disabled,
  accentColor,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  accentColor: string;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, ModelOption[]>();
    for (const m of ALL_COMPARE_MODELS) {
      const arr = map.get(m.group) ?? [];
      arr.push(m);
      map.set(m.group, arr);
    }
    return [...map.entries()];
  }, []);

  return (
    <div className="space-y-1">
      <label className={`text-xs font-medium ${accentColor} uppercase tracking-wider`}>{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full px-2.5 py-2 text-sm rounded-modal bg-secondary/40 border border-primary/20
                   text-foreground focus-visible:outline-none focus-visible:border-indigo-500/40
                   disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {groups.map(([group, models]) => (
          <optgroup key={group} label={group}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} ({m.cost})
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
