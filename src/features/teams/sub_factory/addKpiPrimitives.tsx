// Shared bits for the Add-KPI modal — option lists, the theme-toned field
// label, the input class, and the dedicated "How it's measured" field block.
// Kept out of AddKpiModal so the modal stays focused on state + actions.
import { useMemo, type ReactNode } from 'react';
import { Hand } from 'lucide-react';

import { ThemedSelect, type ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';

import { useTranslation } from '@/i18n/useTranslation';

import { type KpiCategory, type MeasureKind } from './factoryModel';
import { useKpiSetupLabels } from './useKpiSetupLabels';

export type Measured = 'manual' | 'auto';

/** Localized option lists for the Add-KPI selects. */
export function useKpiSetupOptions() {
  const w = useKpiSetupLabels();
  return useMemo(() => {
    const opts = <K extends string>(keys: readonly K[], labels: Record<K, string>): ThemedSelectOption[] =>
      keys.map((key) => ({ value: key, label: labels[key] }));
    return {
      category: opts(['technical', 'quality', 'traffic', 'value'] as KpiCategory[], w.category),
      tier: opts(['north_star', 'primary', 'supporting'] as const, w.tier),
      direction: opts(['up', 'down'] as const, w.direction),
      measured: opts(['manual', 'auto'] as const, w.measured),
      autoKind: opts(['codebase', 'connector', 'derived'] as MeasureKind[], w.kind),
      cadence: opts(['manual', 'daily', 'weekly'] as const, w.cadence),
    };
  }, [w]);
}

export const INPUT = 'w-full px-3 py-2 typo-body bg-background/50 border border-primary/15 rounded-xl text-foreground focus-ring';

export function num(s: string): number | undefined {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

/** Theme-toned field label (differentiates labels from the inputs). */
export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="block typo-label text-primary/80 mb-1">
      {children}
    </label>
  );
}

/** The dedicated 3-column "How it's measured" block: Measured · Measurement ·
 *  Cadence, plus the Connector picker when an automatic connector source. */
export function MeasurementFields({
  measured, setMeasured, autoKind, setAutoKind, connector, setConnector,
  derivedMetric, setDerivedMetric, cadence, setCadence, connectorOpts, derivedOpts,
}: {
  measured: Measured;
  setMeasured: (v: Measured) => void;
  autoKind: MeasureKind;
  setAutoKind: (v: MeasureKind) => void;
  connector: string;
  setConnector: (v: string) => void;
  derivedMetric: string;
  setDerivedMetric: (v: string) => void;
  cadence: string;
  setCadence: (v: string) => void;
  connectorOpts: ThemedSelectOption[];
  derivedOpts: ThemedSelectOption[];
}) {
  const isManual = measured === 'manual';
  const { t } = useTranslation();
  const k = t.kpis;
  const o = useKpiSetupOptions();
  return (
    <div className="rounded-card border border-primary/15 bg-secondary/10 p-4">
      <p className="typo-label text-primary/80 mb-3">{k.setup_how_measured}</p>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label>{k.setup_measured}</Label>
          <ThemedSelect filterable hideSearch options={o.measured} value={measured} onValueChange={(v) => setMeasured(v as Measured)} aria-label={k.setup_measured} />
        </div>
        <div>
          <Label>{k.setup_measurement}</Label>
          {isManual ? (
            <div className={`${INPUT} flex items-center gap-1.5 text-foreground/70`}><Hand className="w-3.5 h-3.5" /> {k.setup_manual_entry}</div>
          ) : (
            <ThemedSelect filterable hideSearch options={o.autoKind} value={autoKind} onValueChange={(v) => setAutoKind(v as MeasureKind)} aria-label={k.setup_mechanism_aria} />
          )}
        </div>
        <div>
          <Label>{k.setup_cadence}</Label>
          <ThemedSelect filterable hideSearch options={o.cadence} value={cadence} onValueChange={setCadence} aria-label={k.setup_cadence} />
        </div>
        {!isManual && autoKind === 'connector' && (
          <div className="col-span-3">
            <Label>{k.setup_connector}</Label>
            <ThemedSelect
              filterable
              options={connectorOpts}
              value={connector}
              onValueChange={setConnector}
              placeholder={connectorOpts.length ? k.setup_connector_ph : k.setup_connector_none}
              aria-label={k.setup_connector}
            />
            <p className="typo-caption text-foreground/50 mt-1">{k.setup_connector_hint}</p>
          </div>
        )}
        {!isManual && autoKind === 'derived' && (
          <div className="col-span-3">
            <Label>{k.setup_metric}</Label>
            <ThemedSelect
              filterable
              hideSearch
              options={derivedOpts}
              value={derivedMetric}
              onValueChange={setDerivedMetric}
              placeholder={k.setup_metric_ph}
              aria-label={k.setup_derived_aria}
            />
          </div>
        )}
      </div>
      <p className="typo-caption text-foreground/60 mt-3">
        {isManual ? k.setup_manual_help : k.setup_auto_help}
      </p>
    </div>
  );
}
