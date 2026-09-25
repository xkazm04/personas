import { Zap, Gauge, ShieldAlert, ShieldCheck, Shield, type LucideIcon } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

interface EffortRiskFilterProps {
  effortRange: [number, number];
  riskRange: [number, number];
  onEffortChange: (range: [number, number]) => void;
  onRiskChange: (range: [number, number]) => void;
}

type PresetTone = 'success' | 'warning' | 'error';
interface Preset { label: string; range: [number, number]; tone: PresetTone; icon: LucideIcon }

// A band is a status: a quick or safe band is good news, a heavy or risky one is bad news.
const PRESETS: Record<'effort' | 'risk', Preset[]> = {
  effort: [
    { label: 'Quick Wins', range: [1, 3], tone: 'success', icon: Zap },
    { label: 'Moderate', range: [4, 6], tone: 'warning', icon: Gauge },
    { label: 'Heavy', range: [7, 10], tone: 'error', icon: ShieldAlert },
  ],
  risk: [
    { label: 'Safe', range: [1, 3], tone: 'success', icon: ShieldCheck },
    { label: 'Moderate', range: [4, 6], tone: 'warning', icon: Shield },
    { label: 'Risky', range: [7, 10], tone: 'error', icon: ShieldAlert },
  ],
};

const ACTIVE: Record<PresetTone, string> = {
  success: 'bg-status-success/20 text-status-success border-status-success/30',
  warning: 'bg-status-warning/20 text-status-warning border-status-warning/30',
  error: 'bg-status-error/20 text-status-error border-status-error/30',
};
const INACTIVE = 'bg-secondary/30 text-foreground border-border/20';
const ALL_RANGE: [number, number] = [1, 10];

function rangesEqual(a: [number, number], b: [number, number]) {
  return a[0] === b[0] && a[1] === b[1];
}

function PresetGroup({ heading, presets, range, onChange }: {
  heading: string;
  presets: Preset[];
  range: [number, number];
  onChange: (range: [number, number]) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        {/* style-deviation: at Gate 1 the operator read a head moved onto typo-eyebrow (one step smaller) as worse, so this one keeps its row size: typo-heading owns size and weight, the tracking stays a utility. */}
        <span className="typo-heading uppercase tracking-wider text-primary">{heading}</span>
        {!rangesEqual(range, ALL_RANGE) && (
          <Button variant="ghost" size="xs" onClick={() => onChange(ALL_RANGE)}>{t.common.clear}</Button>
        )}
      </div>
      <div className="flex gap-1.5">
        {presets.map((p) => {
          const isActive = rangesEqual(range, p.range);
          const Icon = p.icon;
          return (
            <Tooltip key={p.label} content={p.label}>
              {/* A preset tile, not a Button: a square icon toggle whose pressed state carries its band's status. */}
              <button
                type="button"
                aria-label={p.label}
                aria-pressed={isActive}
                onClick={() => onChange(isActive ? ALL_RANGE : p.range)}
                className={`flex-1 flex items-center justify-center p-2 rounded-card border transition-colors ${isActive ? `ring-2 ring-inset ring-current/40 ${ACTIVE[p.tone]}` : INACTIVE}`}
              >
                <Icon className="w-4.5 h-4.5" />
              </button>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

export function EffortRiskFilter({ effortRange, riskRange, onEffortChange, onRiskChange }: EffortRiskFilterProps) {
  return (
    <div className="space-y-3">
      <PresetGroup heading="Effort" presets={PRESETS.effort} range={effortRange} onChange={onEffortChange} />
      <PresetGroup heading="Risk" presets={PRESETS.risk} range={riskRange} onChange={onRiskChange} />
    </div>
  );
}
