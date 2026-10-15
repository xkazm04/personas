// The register (M): every live mandate, one row each, the ones asking the
// operator first. Enter (or a press) opens the mandate page.

import { useMemo } from 'react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { ListRow, Rows } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import { statusLabel } from './mandateCopy';
import { stewardLamp } from './StewardRow';
import { useDrawerListKeys } from './useDrawerKeys';
import type { MandatesState } from './useMandates';

export function registerOrder(list: readonly MandateSummary[]): MandateSummary[] {
  return [...list].sort((a, b) =>
    (b.load.openAsks ?? 0) - (a.load.openAsks ?? 0)
    || (b.load.actsCount ?? 0) - (a.load.actsCount ?? 0)
    || (a.projectName ?? '').localeCompare(b.projectName ?? ''));
}

export function RegisterView({ state, selected, onSelect, onOpen }: {
  state: MandatesState;
  selected: number;
  onSelect: (i: number) => void;
  onOpen: (charterId: string) => void;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const rows = useMemo(() => registerOrder(state.mandates ?? []), [state.mandates]);
  const cur = rows[Math.min(selected, rows.length - 1)];
  useDrawerListKeys({ count: rows.length, selected, onSelect, onEnter: () => { if (cur) onOpen(cur.charterId); } });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto" data-testid="mandate-register">
      <p className="typo-caption text-status-error" role="status">{state.failed ? m.ml_stewards_failed : null}</p>
      <Rows
        loading={state.mandates === null && !state.failed}
        count={rows.length}
        label={m.ml_register}
        empty={{ title: m.ml_stewards_none, testId: 'mandate-register-empty' }}
      >
        {rows.map((x, i) => {
          const lamp = stewardLamp(x);
          const { spendUsedUsd: used, budgetUsd: cap, openAsks, actsCount } = x.load;
          return (
            <ListRow
              key={x.charterId}
              testId="mandate-register-row"
              name={x.projectName ?? m.ml_project_unknown}
              meta={[
                x.stewardName ?? m.ml_steward_unknown,
                statusLabel(m, x.status),
                tx(m.ml_steward_rung, { rung: x.scopeRung }),
                x.envelope.envelopeVersion === 0 ? m.ml_envelope_unsigned : tx(m.ml_act_version, { version: x.envelope.envelopeVersion }),
              ].join(' · ')}
              mark={{ tone: lamp.lit ? (lamp.tone === 'warn' ? 'warning' : 'info') : 'neutral', label: statusLabel(m, x.status) }}
              figures={
                <span className="flex items-center gap-3 tabular-nums">
                  <span>{cap === null ? m.ml_steward_no_cap : used === null ? m.ml_steward_spend_unknown : <><Numeric value={used} unit="usd" /> / <Numeric value={cap} unit="usd" /></>}</span>
                  <span>{actsCount === null ? m.ml_unknown : tx(m.ml_register_acts, { count: actsCount })}</span>
                  <span className={(openAsks ?? 0) > 0 ? 'text-status-warning' : ''}>
                    {openAsks === null ? m.ml_steward_asks_unknown : tx(m.ml_steward_asks, { count: openAsks })}
                  </span>
                </span>
              }
              state={i === selected ? 'selected' : undefined}
              onPress={() => onOpen(x.charterId)}
            />
          );
        })}
      </Rows>
    </div>
  );
}
