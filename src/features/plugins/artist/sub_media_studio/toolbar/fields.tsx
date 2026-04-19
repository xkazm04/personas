import type { LucideIcon } from 'lucide-react';

// ---------------------------------------------------------------------------
// Small reusable inputs shared by the toolbar's property popovers and the
// (still-available-on-request) InspectorPanel. Extracted so a future
// Inspector rewrite doesn't duplicate these shapes.
// ---------------------------------------------------------------------------

export function NumField({
  label,
  value,
  onChange,
  step = 0.1,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="typo-label text-foreground">{label}</span>
      <input
        type="number"
        className="w-full rounded-card bg-secondary/40 border border-primary/10 px-2 py-1 text-md text-foreground tabular-nums focus:outline-none focus:border-rose-500/40"
        value={Number(value.toFixed(3))}
        step={step}
        min={min}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
    </label>
  );
}

export function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="typo-label text-foreground">{label}</span>
        <span className="text-md font-mono text-foreground tabular-nums">
          {format ? format(value) : value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 accent-rose-400"
      />
    </label>
  );
}

export function ToggleRow({
  label,
  hint,
  value,
  onChange,
  icon: Icon,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  icon?: LucideIcon;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`w-full flex items-start gap-3 px-3 py-2 rounded-card border transition-colors text-left ${
        value
          ? 'bg-rose-500/10 border-rose-500/30'
          : 'bg-secondary/20 border-primary/10 hover:bg-secondary/30'
      }`}
    >
      {Icon && (
        <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${value ? 'text-rose-400' : 'text-foreground'}`} />
      )}
      <div className="flex-1 min-w-0">
        <div className={`text-md ${value ? 'text-rose-400' : 'text-foreground'}`}>{label}</div>
        {hint && <div className="text-md text-foreground mt-0.5">{hint}</div>}
      </div>
      <div
        className={`w-7 h-4 rounded-full relative flex-shrink-0 mt-1 transition-colors ${
          value ? 'bg-rose-500' : 'bg-secondary'
        }`}
      >
        <div
          className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${
            value ? 'left-3.5' : 'left-0.5'
          }`}
        />
      </div>
    </button>
  );
}
