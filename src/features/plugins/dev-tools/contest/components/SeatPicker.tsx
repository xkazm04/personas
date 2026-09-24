// The click grid for building a panel of seats: engine rows × model chips,
// a free-text model per engine, and the current panel as removable seat
// chips, each with its effort row and an optional label. Line-ups inject a
// whole panel in one click (see LineupBar).
import { useState } from 'react';
import { Plus, X } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestEngine } from '@/lib/bindings/ContestEngine';
import type { ContestEnvironment } from '@/lib/bindings/ContestEnvironment';
import type { ContestSeatSpec } from '@/lib/bindings/ContestSeatSpec';

import { effortLabel, engineLabel } from '../model/labels';
import {
  addSeat,
  CONTEST_EFFORTS,
  CONTEST_ENGINES,
  CONTEST_MODEL_CATALOG,
  DEFAULT_SEAT_EFFORT,
  formatSeatSpec,
  isSpecToken,
  modelDisplayName,
  seatId,
} from '../model/seatCatalog';
import { SeatLabel } from '../arena/SeatLabel';
import { LineupBar } from './LineupBar';

export interface SeatPickerProps {
  value: ContestSeatSpec[];
  onChange: (next: ContestSeatSpec[]) => void;
  /** Engine availability; engines whose CLI is missing render disabled. */
  environment?: ContestEnvironment | null;
  /** Heading for the panel (Seats / Judges). */
  label: string;
  /** Show the saved line-ups row. Default true. */
  showLineups?: boolean;
  /** `data-testid` prefix, e.g. `contest-seats` / `contest-judges`. */
  testIdPrefix: string;
}

export function SeatPicker({
  value,
  onChange,
  environment,
  label,
  showLineups = true,
  testIdPrefix,
}: SeatPickerProps) {
  const { t, tx } = useTranslation();
  const s = t.plugins.contest;

  const available = (engine: ContestEngine) => environment?.engines[engine] ?? true;
  const replaceAt = (i: number, next: ContestSeatSpec) => onChange(value.map((v, j) => (j === i ? next : v)));

  return (
    <div className="space-y-3" data-testid={testIdPrefix}>
      <p className="typo-caption text-foreground">{s.picker_hint}</p>
      <div className="space-y-2">
        {CONTEST_ENGINES.map((engine) => (
          <EngineRow
            key={engine}
            engine={engine}
            available={available(engine)}
            onAdd={(model) => onChange(addSeat(value, { engine, model, effort: DEFAULT_SEAT_EFFORT, label: null }))}
            testIdPrefix={testIdPrefix}
          />
        ))}
      </div>

      <div>
        <p className="typo-label text-foreground mb-1.5">{label}</p>
        {value.length === 0 ? (
          <p className="typo-caption text-foreground" data-testid={`${testIdPrefix}-empty`}>
            {s.picker_empty}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {value.map((spec, i) => {
              const text = formatSeatSpec(spec);
              return (
                <li
                  key={`${seatId(spec)}-${i}`}
                  className="rounded-card border border-primary/15 bg-secondary/30 px-2.5 py-2 space-y-1.5"
                  data-testid={`${testIdPrefix}-seat-${seatId(spec)}`}
                >
                  <div className="flex items-center gap-2">
                    <SeatLabel spec={text} hideEffort />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={tx(s.seat_remove, { spec: text })}
                      onClick={() => onChange(value.filter((_, j) => j !== i))}
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <div role="group" aria-label={tx(s.seat_effort_aria, { spec: text })} className="flex flex-wrap gap-1">
                    {CONTEST_EFFORTS.map((effort) => (
                      <Button
                        key={effort}
                        size="xs"
                        variant={spec.effort === effort ? 'primary' : 'ghost'}
                        aria-pressed={spec.effort === effort}
                        onClick={() => replaceAt(i, { ...spec, effort })}
                      >
                        {effortLabel(s, effort)}
                      </Button>
                    ))}
                  </div>
                  <input
                    value={spec.label ?? ''}
                    onChange={(e) => replaceAt(i, { ...spec, label: e.target.value.trim() || null })}
                    placeholder={s.seat_label_placeholder}
                    aria-label={tx(s.seat_label_aria, { spec: text })}
                    aria-invalid={spec.label !== null && !isSpecToken(spec.label)}
                    className="w-28 px-2 py-1 rounded-input border border-primary/12 bg-background/50 typo-code text-foreground focus-ring"
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {showLineups && <LineupBar panel={value} onApply={onChange} testIdPrefix={`${testIdPrefix}-lineups`} />}
    </div>
  );
}

interface EngineRowProps {
  engine: ContestEngine;
  available: boolean;
  onAdd: (model: string) => void;
  testIdPrefix: string;
}

function EngineRow({ engine, available, onAdd, testIdPrefix }: EngineRowProps) {
  const { t, tx } = useTranslation();
  const s = t.plugins.contest;
  const [custom, setCustom] = useState('');
  const name = engineLabel(s, engine);
  const reason = available ? undefined : tx(s.picker_engine_unavailable, { engine: name });
  const customOk = custom.trim() !== '' && isSpecToken(custom.trim());
  const addCustom = () => {
    if (!customOk) return;
    onAdd(custom.trim());
    setCustom('');
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid={`${testIdPrefix}-engine-${engine}`}>
      <span className="typo-label text-foreground w-16 shrink-0">{name}</span>
      {CONTEST_MODEL_CATALOG[engine].map((model) => (
        <Button
          key={model}
          size="xs"
          variant="secondary"
          disabled={!available}
          disabledReason={reason}
          onClick={() => onAdd(model)}
          data-testid={`${testIdPrefix}-model-${model}`}
        >
          {modelDisplayName(model)}
        </Button>
      ))}
      {/* Not a <form>: the picker sits inside SetupForm, and forms do not nest. */}
      <div className="flex items-center gap-1">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustom();
            }
          }}
          disabled={!available}
          placeholder={s.picker_custom_model_placeholder}
          aria-label={tx(s.picker_custom_model_aria, { engine: name })}
          className="w-36 px-2 py-1 rounded-input border border-primary/12 bg-background/50 typo-code text-foreground focus-ring disabled:is-disabled"
        />
        <Button
          size="xs"
          onClick={addCustom}
          variant="ghost"
          icon={<Plus className="w-3 h-3" />}
          disabled={!available || !customOk}
        >
          {s.picker_add_custom}
        </Button>
      </div>
    </div>
  );
}
