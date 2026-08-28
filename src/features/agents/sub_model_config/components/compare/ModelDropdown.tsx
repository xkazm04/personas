import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { ALL_COMPARE_MODELS, FREE_COST, type ModelOption } from '../../libs/compareHelpers';

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
  const { t } = useTranslation();
  const mc = t.agents.model_config;
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
      <label className={`typo-label font-medium ${accentColor} `}>{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full px-2.5 py-2 typo-body rounded-modal bg-secondary/40 border border-primary/20
                   text-foreground focus-visible:outline-none focus-visible:border-indigo-500/40
                   disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {groups.map(([group, models]) => (
          <optgroup key={group} label={group}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {/* `cost` is an input/output pair per MILLION tokens; without
                    the unit the figure is unreadable, and the priced/free
                    split is why the suffix is conditional. */}
                {m.label} ({m.cost === FREE_COST ? m.cost : `${m.cost} ${mc.price_unit_short}`})
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
