// Shared bits for the Add-KPI modal — option lists, the theme-toned field
// label, the input class, and the dedicated "How it's measured" field block.
// Kept out of AddKpiModal so the modal stays focused on state + actions.
import { type ReactNode } from 'react';
import { Hand } from 'lucide-react';

import { ThemedSelect, type ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';

import { CATEGORY_LABEL, KIND_LABEL, CADENCE_LABEL, type KpiCategory, type MeasureKind } from './factoryMock';

export type Measured = 'manual' | 'auto';

export const CATEGORY_OPTS: ThemedSelectOption[] = (['technical', 'quality', 'traffic', 'value'] as KpiCategory[]).map((c) => ({ value: c, label: CATEGORY_LABEL[c] }));
export const TIER_OPTS: ThemedSelectOption[] = [
  { value: 'north_star', label: 'North star' },
  { value: 'primary', label: 'Primary' },
  { value: 'supporting', label: 'Supporting' },
];
export const DIRECTION_OPTS: ThemedSelectOption[] = [
  { value: 'up', label: 'Higher is better' },
  { value: 'down', label: 'Lower is better' },
];
export const MEASURED_OPTS: ThemedSelectOption[] = [
  { value: 'manual', label: 'Manually' },
  { value: 'auto', label: 'Automatically' },
];
export const AUTO_KIND_OPTS: ThemedSelectOption[] = (['codebase', 'connector', 'derived'] as MeasureKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }));
export const CADENCE_OPTS: ThemedSelectOption[] = (['manual', 'daily', 'weekly'] as const).map((c) => ({ value: c, label: CADENCE_LABEL[c] }));

export const INPUT = 'w-full px-3 py-2 typo-body bg-background/50 border border-primary/15 rounded-xl text-foreground focus-ring';

export function num(s: string): number | undefined {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

/** Theme-toned field label (differentiates labels from the inputs). */
export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="block typo-label text-primary/80 mb-1 tracking-wide">
      {children}
    </label>
  );
}

/** The dedicated 3-column "How it's measured" block: Measured · Measurement ·
 *  Cadence, plus the Connector picker when an automatic connector source. */
export function MeasurementFields({
  measured, setMeasured, autoKind, setAutoKind, connector, setConnector, cadence, setCadence, connectorOpts,
}: {
  measured: Measured;
  setMeasured: (v: Measured) => void;
  autoKind: MeasureKind;
  setAutoKind: (v: MeasureKind) => void;
  connector: string;
  setConnector: (v: string) => void;
  cadence: string;
  setCadence: (v: string) => void;
  connectorOpts: ThemedSelectOption[];
}) {
  const isManual = measured === 'manual';
  return (
    <div className="rounded-card border border-primary/15 bg-secondary/10 p-4">
      <p className="typo-label text-primary/80 mb-3 tracking-wide">How it&apos;s measured</p>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label>Measured</Label>
          <ThemedSelect filterable hideSearch options={MEASURED_OPTS} value={measured} onValueChange={(v) => setMeasured(v as Measured)} aria-label="Measured" />
        </div>
        <div>
          <Label>Measurement</Label>
          {isManual ? (
            <div className={`${INPUT} flex items-center gap-1.5 text-foreground/70`}><Hand className="w-3.5 h-3.5" /> Manual entry</div>
          ) : (
            <ThemedSelect filterable hideSearch options={AUTO_KIND_OPTS} value={autoKind} onValueChange={(v) => setAutoKind(v as MeasureKind)} aria-label="Measurement mechanism" />
          )}
        </div>
        <div>
          <Label>Cadence</Label>
          <ThemedSelect filterable hideSearch options={CADENCE_OPTS} value={cadence} onValueChange={setCadence} aria-label="Cadence" />
        </div>
        {!isManual && autoKind === 'connector' && (
          <div className="col-span-3">
            <Label>Connector</Label>
            <ThemedSelect
              filterable
              options={connectorOpts}
              value={connector}
              onValueChange={setConnector}
              placeholder={connectorOpts.length ? 'Pick a connector from your vault' : 'No connectors in the vault yet'}
              aria-label="Connector"
            />
          </div>
        )}
      </div>
      <p className="typo-caption text-foreground/60 mt-3">
        {isManual
          ? "You'll record the value by hand. Unit, baseline and target are required."
          : 'An AI sets up the measurement (and can fill unit/baseline). The KPI lands in Teams › KPIs as a proposal to review.'}
      </p>
    </div>
  );
}
