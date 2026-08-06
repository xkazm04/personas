// VARIANT B — "Ledger". Console's card and grid; a different information design.
//
// The two facts stop being prose lines and become a two-column ledger: a
// left-aligned label, a right-aligned value, hairline between rows. Same three
// text tiers, arranged for SCANNING rather than reading — your eye runs down the
// right edge and sees four values, not four sentences.
//
// It also carries one fact Console has no room for: the number of vault
// candidates that could back the capability. On an EMPTY card that is the
// difference between "nothing exists" and "you have three, none are bound",
// which is the actual next step.
import { useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import { TechInk } from '../passportInk';
import {
  CandidateList, CapabilityCard, CapabilityHead, CardAction, ConnectorGlyph,
} from './monitoringCard';
import type { MonitoringRow, MonitoringVariantProps } from './monitoringTypes';

export function MonitoringLedgerVariant({ rows, busyKey, deploying, onAssign, onDeploy }: MonitoringVariantProps) {
  return (
    <div className="flex-1 min-h-0 grid grid-cols-2 grid-rows-2 gap-3 p-4">
      {rows.map((row) => (
        <LedgerCard
          key={row.def.key}
          row={row}
          busy={busyKey === row.def.key}
          deploying={deploying === row.def.key}
          onAssign={(id) => onAssign(row.def.key, id)}
          onDeploy={() => onDeploy(row)}
        />
      ))}
    </div>
  );
}

function LedgerCard({ row, busy, deploying, onAssign, onDeploy }: {
  row: MonitoringRow;
  busy: boolean;
  deploying: boolean;
  onAssign: (credentialId: string | null) => void;
  onDeploy: () => void;
}) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const [picking, setPicking] = useState(false);

  return (
    <CapabilityCard icon={row.def.icon} testId={`monitoring-card-${row.def.key}`}>
      <CapabilityHead icon={row.def.icon} label={d[`monitoring_item_${row.def.labelKey}`]} state={row.state} />

      {picking ? (
        <CandidateList
          row={row}
          busy={busy}
          onAssign={(id) => { onAssign(id); setPicking(false); }}
          onCancel={() => setPicking(false)}
        />
      ) : (
        <>
          <div className="relative flex-1 min-h-0 px-3 pb-2 overflow-y-auto">
            <LedgerRow label={d.envslot_detected}>
              {row.detected ? <TechInk label={row.detected} muted /> : <Dash />}
            </LedgerRow>
            <LedgerRow label={d.envslot_connector}>
              {row.bound ? (
                <span className="inline-flex items-center gap-1.5 min-w-0">
                  <ConnectorGlyph serviceType={row.bound.serviceType} size="w-3.5 h-3.5" />
                  <span className="typo-caption text-foreground/60 truncate" style={{ fontWeight: 400 }}>{row.bound.name}</span>
                </span>
              ) : <Dash />}
            </LedgerRow>
            {/* The fact Console cannot show: "nothing is bound" and "nothing
                COULD be bound" are different problems with different fixes. */}
            <LedgerRow label={d.monitoring_ledger_available}>
              <span className="typo-caption text-foreground/60 tabular-nums" style={{ fontWeight: 400 }}>
                {tx(d.monitoring_ledger_count, { count: row.candidates.length })}
              </span>
            </LedgerRow>
          </div>
          <div className="relative px-3 py-2 border-t border-primary/10 flex items-center gap-2">
            {row.bound && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onAssign(null)}
                className="typo-label text-foreground/40 hover:text-foreground transition-colors disabled:opacity-40 shrink-0"
              >
                {d.envslot_unassign}
              </button>
            )}
            <span className="flex-1 min-w-0">
              <CardAction row={row} busy={busy} deploying={deploying} onPick={() => setPicking(true)} onDeploy={onDeploy} />
            </span>
          </div>
        </>
      )}
    </CapabilityCard>
  );
}

/** Label left, value right, hairline under — the ledger's whole grammar. */
function LedgerRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1.5 border-b border-primary/[0.07] last:border-b-0 min-w-0">
      <span className="typo-label text-foreground/40 shrink-0">{label}</span>
      <span className="flex-1 min-w-0 flex justify-end text-right">{children}</span>
    </div>
  );
}

function Dash() {
  const { t } = useTranslation();
  return <span className="typo-caption text-foreground/35" style={{ fontWeight: 400 }}>{t.plugins.dev_tools.monitoring_none_dash}</span>;
}
