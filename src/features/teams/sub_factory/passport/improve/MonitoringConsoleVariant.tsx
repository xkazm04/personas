// VARIANT A — "Console". The winner's shape: 2 × 2 capability tiles, each split
// into the two facts that define it.
//
// LEFT is the codebase, RIGHT is the vault, and both are drawn as tool marks —
// a brand glyph when we recognise it, a dashed tile when the side is empty. The
// divider between them is the question the card asks.
//
// When the two sides are the same tool the divider disappears and the card
// shows one mark with its name: there is nothing left to compare, and "the code
// and the vault agree" is exactly what a covered capability means.
//
// Pairs with the Upgrade lane, which carries the golden-standard actions.
// Console v2 folds that lane into this grid instead.
import { useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import {
  CandidateList, CapabilityCard, CapabilityHead, CardAction, DeployNote, MergedTool, sameTool, SideHalf, UnbindButton,
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

export function ConsoleCard({ row, busy, deploying, onAssign, onDeploy }: {
  row: MonitoringRow;
  busy: boolean;
  deploying: boolean;
  onAssign: (credentialId: string | null) => void;
  onDeploy: () => void;
}) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const [picking, setPicking] = useState(false);
  const merged = sameTool(row.detected, row.bound);

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
          <div className="relative flex-1 min-h-0 flex items-stretch overflow-y-auto">
            {merged && row.bound ? (
              <MergedTool label={row.bound.name} serviceType={row.bound.serviceType}>
                <UnbindButton busy={busy} onClick={() => onAssign(null)} />
              </MergedTool>
            ) : (
              <>
                <SideHalf side="code" toolLabel={row.detected} />
                <span className="w-px my-2 bg-primary/10 shrink-0" aria-hidden />
                <SideHalf side="vault" toolLabel={row.bound?.name ?? null} serviceType={row.bound?.serviceType}>
                  {row.bound && <UnbindButton busy={busy} onClick={() => onAssign(null)} />}
                </SideHalf>
              </>
            )}
          </div>

          {row.state === 'not_implemented' && (
            <div className="relative px-3 pb-2"><DeployNote /></div>
          )}
          <div className="relative px-3 py-2 border-t border-primary/10">
            <CardAction row={row} busy={busy} deploying={deploying} onPick={() => setPicking(true)} onDeploy={onDeploy} />
          </div>
        </>
      )}
    </CapabilityCard>
  );
}
