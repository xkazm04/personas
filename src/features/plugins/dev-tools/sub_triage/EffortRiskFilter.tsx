import { Zap, Gauge, ShieldAlert, ShieldCheck, Shield } from 'lucide-react';

interface EffortRiskFilterProps {
  effortRange: [number, number];
  riskRange: [number, number];
  onEffortChange: (range: [number, number]) => void;
  onRiskChange: (range: [number, number]) => void;
}

const PRESETS = {
  effort: [
    { label: 'Quick Wins', range: [1, 3] as [number, number], color: 'emerald', icon: Zap },
    { label: 'Moderate', range: [4, 6] as [number, number], color: 'amber', icon: Gauge },
    { label: 'Heavy', range: [7, 10] as [number, number], color: 'red', icon: ShieldAlert },
  ],
  risk: [
    { label: 'Safe', range: [1, 3] as [number, number], color: 'emerald', icon: ShieldCheck },
    { label: 'Moderate', range: [4, 6] as [number, number], color: 'amber', icon: Shield },
    { label: 'Risky', range: [7, 10] as [number, number], color: 'red', icon: ShieldAlert },
  ],
};

const PRESET_COLORS: Record<string, { active: string; inactive: string }> = {
  emerald: { active: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', inactive: 'bg-secondary/30 text-muted-foreground/50 border-border/20' },
  amber: { active: 'bg-amber-500/20 text-amber-400 border-amber-500/30', inactive: 'bg-secondary/30 text-muted-foreground/50 border-border/20' },
  red: { active: 'bg-red-500/20 text-red-400 border-red-500/30', inactive: 'bg-secondary/30 text-muted-foreground/50 border-border/20' },
};

function rangesEqual(a: [number, number], b: [number, number]) {
  return a[0] === b[0] && a[1] === b[1];
}

export function EffortRiskFilter({ effortRange, riskRange, onEffortChange, onRiskChange }: EffortRiskFilterProps) {
  const allRange: [number, number] = [1, 10];

  return (
    <div className="space-y-3">
      {/* Effort */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-md font-semibold text-muted-foreground/60 uppercase tracking-wider">Effort</span>
          {!rangesEqual(effortRange, allRange) && (
            <button onClick={() => onEffortChange(allRange)} className="text-md text-primary/50 hover:text-primary">Clear</button>
          )}
        </div>
        <div className="flex gap-1.5">
          {PRESETS.effort.map(p => {
            const isActive = rangesEqual(effortRange, p.range);
            const colors = PRESET_COLORS[p.color]!;
            const Icon = p.icon;
            return (
              <button
                key={p.label}
                title={p.label}
                onClick={() => onEffortChange(isActive ? allRange : p.range)}
                className={`flex-1 flex items-center justify-center p-2 rounded-lg border transition-colors ${isActive ? colors.active : colors.inactive}`}
              >
                <Icon className="w-4.5 h-4.5" />
              </button>
            );
          })}
        </div>
      </div>

      {/* Risk */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-md font-semibold text-muted-foreground/60 uppercase tracking-wider">Risk</span>
          {!rangesEqual(riskRange, allRange) && (
            <button onClick={() => onRiskChange(allRange)} className="text-md text-primary/50 hover:text-primary">Clear</button>
          )}
        </div>
        <div className="flex gap-1.5">
          {PRESETS.risk.map(p => {
            const isActive = rangesEqual(riskRange, p.range);
            const colors = PRESET_COLORS[p.color]!;
            const Icon = p.icon;
            return (
              <button
                key={p.label}
                title={p.label}
                onClick={() => onRiskChange(isActive ? allRange : p.range)}
                className={`flex-1 flex items-center justify-center p-2 rounded-lg border transition-colors ${isActive ? colors.active : colors.inactive}`}
              >
                <Icon className="w-4.5 h-4.5" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
