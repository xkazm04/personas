// VARIANT A — "Console". The baseline the other two are built on.
//
// 2×2 grid of neutral capability cards. Information design: PROSE FACTS —
// two labelled lines, "In the codebase" and "Bound connector", read top to
// bottom the way the Skills workbench reads. The state is one dot-and-word in
// the heading; nothing else is tinted.
//
// This is the plainest of the three on purpose: it is the control. B and C keep
// this exact card and grid and change only how the two facts are presented.
import { useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import { TechInk } from '../passportInk';
import {
  BoundConnector, CandidateList, CapabilityCard, CapabilityHead, CardAction, Fact, FactValue,
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
          <div className="relative flex-1 min-h-0 px-3 pb-2 space-y-2.5 overflow-y-auto">
            <Fact label={d.envslot_detected}>
              {row.detected ? <TechInk label={row.detected} muted /> : <FactValue value={null} />}
            </Fact>
            <Fact label={d.envslot_connector}>
              {row.bound
                ? <BoundConnector credential={row.bound} busy={busy} onUnbind={() => onAssign(null)} />
                : <FactValue value={null} />}
            </Fact>
          </div>
          <div className="relative px-3 py-2 border-t border-primary/10">
            <CardAction row={row} busy={busy} deploying={deploying} onPick={() => setPicking(true)} onDeploy={onDeploy} />
          </div>
        </>
      )}
    </CapabilityCard>
  );
}
