// VARIANT A — "Console". 2 × 2 tiles.
//
// Grid shape: four equal cards, each ~430 × 280 in the enlarged modal. Every
// capability gets identical weight and the whole set is visible at once — the
// layout for "which of these four is not okay".
//
// Cost of the shape: a tile is too small to hold the facts AND the candidate
// list, so binding flips the tile over. You cannot read what a capability
// currently has while choosing its replacement. B and C each spend their extra
// room buying that back, in different ways.
import { useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import { TechInk } from '../passportInk';
import {
  Absent, BoundConnector, CandidateList, CapabilityCard, CapabilityHead, CardAction, DeployNote, Fact,
} from './monitoringCard';
import type { MonitoringRow, MonitoringVariantProps } from './monitoringTypes';

export function MonitoringConsoleVariant({ rows, busyKey, deploying, onAssign, onDeploy }: MonitoringVariantProps) {
  return (
    <div className="flex-1 min-h-0 grid grid-cols-2 grid-rows-2 gap-3 p-4">
      {rows.map((row) => (
        <ConsoleCard
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

function ConsoleCard({ row, busy, deploying, onAssign, onDeploy }: {
  row: MonitoringRow;
  busy: boolean;
  deploying: boolean;
  onAssign: (credentialId: string | null) => void;
  onDeploy: () => void;
}) {
  const { t } = useTranslation();
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
          <div className="relative flex-1 min-h-0 px-3 pb-2 space-y-3 overflow-y-auto">
            <Fact label={d.envslot_detected}>
              {row.detected ? <TechInk label={row.detected} /> : <Absent />}
            </Fact>
            <Fact label={d.envslot_connector}>
              {row.bound
                ? <BoundConnector credential={row.bound} healthy={row.health[row.bound.id]} busy={busy} onUnbind={() => onAssign(null)} />
                : <Absent />}
            </Fact>
            {row.state === 'not_implemented' && <DeployNote />}
          </div>
          <div className="relative px-3 py-2 border-t border-primary/10">
            <CardAction row={row} busy={busy} deploying={deploying} onPick={() => setPicking(true)} onDeploy={onDeploy} />
          </div>
        </>
      )}
    </CapabilityCard>
  );
}
