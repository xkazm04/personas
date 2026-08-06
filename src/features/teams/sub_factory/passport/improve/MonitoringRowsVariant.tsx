// VARIANT B — "Rows". 1 × 4 full-width bands.
//
// Grid shape: the modal's whole width per capability (~900 × 90), spent on the
// HORIZONTAL axis — identity, what the code has, what the vault has, how many
// candidates exist, and the action, all on one line. Four lines, one column.
//
// What the extra width buys, which the 2 × 2 tile cannot afford:
//   · both facts and the action are visible SIMULTANEOUSLY — nothing flips;
//   · the candidate list expands the band DOWNWARD, so you keep reading the
//     current binding while you pick its replacement;
//   · room for the count of usable vault credentials, which is the difference
//     between "nothing is wired" and "nothing COULD be wired" — two problems
//     with different fixes that every other layout renders identically.
//
// Cost of the shape: vertical rhythm is uniform, so scanning for the one broken
// capability is a left-edge colour hunt rather than a shape difference.
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { TechInk } from '../passportInk';
import {
  Absent, BoundConnector, CandidateRow, CapabilityCard, CardAction, DeployNote, StateMark,
} from './monitoringCard';
import type { MonitoringRow, MonitoringVariantProps } from './monitoringTypes';

export function MonitoringRowsVariant({ rows, busyKey, deploying, onAssign, onDeploy }: MonitoringVariantProps) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2.5">
      {rows.map((row) => (
        <Band
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

function Band({ row, busy, deploying, onAssign, onDeploy }: {
  row: MonitoringRow;
  busy: boolean;
  deploying: boolean;
  onAssign: (credentialId: string | null) => void;
  onDeploy: () => void;
}) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const [open, setOpen] = useState(false);
  const Icon = row.def.icon;

  return (
    <CapabilityCard icon={Icon} watermark={false} testId={`monitoring-card-${row.def.key}`}>
      <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.15fr)_auto] items-center gap-4 px-3.5 py-3">
        {/* identity + state */}
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="typo-body font-semibold text-foreground truncate">{d[`monitoring_item_${row.def.labelKey}`]}</p>
            <span className="inline-flex"><StateMark state={row.state} /></span>
          </div>
        </div>

        <Column label={d.envslot_detected}>
          {row.detected ? <TechInk label={row.detected} /> : <Absent />}
        </Column>

        <Column label={d.envslot_connector}>
          {row.bound
            ? <BoundConnector credential={row.bound} healthy={row.health[row.bound.id]} busy={busy} onUnbind={() => onAssign(null)} />
            : (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="inline-flex items-center gap-1 typo-caption text-foreground/45 hover:text-foreground transition-colors"
                style={{ fontWeight: 400 }}
              >
                {open ? <ChevronDown className="w-3 h-3" aria-hidden /> : <ChevronRight className="w-3 h-3" aria-hidden />}
                {tx(d.monitoring_vault_count, { count: row.candidates.length })}
              </button>
            )}
        </Column>

        <div className="flex items-center gap-2 shrink-0">
          {row.bound && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="typo-caption text-foreground/45 hover:text-foreground transition-colors"
              style={{ fontWeight: 400 }}
            >
              {tx(d.monitoring_vault_count, { count: row.candidates.length })}
            </button>
          )}
          <CardAction
            row={row}
            busy={busy}
            deploying={deploying}
            onPick={() => setOpen((v) => !v)}
            onDeploy={onDeploy}
            compact
          />
        </div>
      </div>

      {row.state === 'not_implemented' && (
        <div className="px-3.5 pb-2.5 -mt-1"><DeployNote /></div>
      )}

      {/* The band grows DOWNWARD — the facts above stay on screen while you pick. */}
      {open && (
        <div className="border-t border-primary/10 px-3 py-2 space-y-0.5 max-h-40 overflow-y-auto">
          {row.candidates.length === 0 && (
            <p className="typo-caption text-foreground/45 px-1 py-1" style={{ fontWeight: 400 }}>{d.envslot_no_candidates}</p>
          )}
          {row.candidates.map((c) => (
            <CandidateRow
              key={c.id}
              credential={c}
              healthy={row.health[c.id]}
              selected={row.bound?.id === c.id}
              busy={busy}
              onClick={() => { onAssign(c.id); setOpen(false); }}
            />
          ))}
        </div>
      )}
    </CapabilityCard>
  );
}

function Column({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="typo-caption text-foreground/45 mb-0.5" style={{ fontWeight: 400 }}>{label}</p>
      {children}
    </div>
  );
}
