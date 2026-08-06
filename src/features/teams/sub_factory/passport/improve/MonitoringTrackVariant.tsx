// VARIANT C — "Track". Console's card and grid; a different information design.
//
// The state stops being a word and becomes a POSITION. Each card leads with a
// two-step track — "in the codebase" then "connector bound" — drawn with the
// passport's own segmented-level grammar (the LevelLadder vocabulary the wall
// already uses for ordinal rows), so a capability reads as progress along a path
// rather than as one of four labels you have to learn.
//
// The payoff is that the two OFF-DIAGONAL states stop looking alike. Unconfirmed
// (step 1 filled, step 2 empty) and not-implemented (step 1 empty, step 2
// filled) are visibly mirror images, which is exactly what they are — and which
// a coloured chip reading "Unconfirmed" vs "Not implemented" never conveys.
// Each step names its own subject underneath, so the track is self-describing.
import { useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import { TechInk } from '../passportInk';
import {
  BoundConnector, CandidateList, CapabilityCard, CardAction, StateMark,
} from './monitoringCard';
import { STATE_INK } from './monitoringModel';
import type { MonitoringRow, MonitoringVariantProps } from './monitoringTypes';

export function MonitoringTrackVariant({ rows, busyKey, deploying, onAssign, onDeploy }: MonitoringVariantProps) {
  return (
    <div className="flex-1 min-h-0 grid grid-cols-2 grid-rows-2 gap-3 p-4">
      {rows.map((row) => (
        <TrackCard
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

function TrackCard({ row, busy, deploying, onAssign, onDeploy }: {
  row: MonitoringRow;
  busy: boolean;
  deploying: boolean;
  onAssign: (credentialId: string | null) => void;
  onDeploy: () => void;
}) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const [picking, setPicking] = useState(false);
  const ink = STATE_INK[row.state];

  return (
    <CapabilityCard icon={row.def.icon} testId={`monitoring-card-${row.def.key}`}>
      {/* The head drops its state mark — the track below carries the reading. */}
      <div className="relative flex items-center gap-2 px-3 py-2.5">
        <row.def.icon className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
        <span className="typo-body font-semibold text-foreground truncate flex-1 min-w-0">
          {d[`monitoring_item_${row.def.labelKey}`]}
        </span>
      </div>

      {picking ? (
        <CandidateList
          row={row}
          busy={busy}
          onAssign={(id) => { onAssign(id); setPicking(false); }}
          onCancel={() => setPicking(false)}
        />
      ) : (
        <>
          <div className="relative flex-1 min-h-0 px-3 pb-2 space-y-2 overflow-y-auto">
            <div className="flex items-center gap-2">
              <Step filled={Boolean(row.detected)} ink={ink} />
              <Step filled={Boolean(row.bound)} ink={ink} />
              <span className="ml-auto shrink-0"><StateMark state={row.state} /></span>
            </div>

            <div className="grid grid-cols-2 gap-2 min-w-0">
              <StepFoot label={d.monitoring_track_step_code}>
                {row.detected ? <TechInk label={row.detected} muted /> : <Absent />}
              </StepFoot>
              <StepFoot label={d.monitoring_track_step_vault}>
                {row.bound
                  ? <BoundConnector credential={row.bound} busy={busy} onUnbind={() => onAssign(null)} />
                  : <Absent />}
              </StepFoot>
            </div>
          </div>
          <div className="relative px-3 py-2 border-t border-primary/10">
            <CardAction row={row} busy={busy} deploying={deploying} onPick={() => setPicking(true)} onDeploy={onDeploy} />
          </div>
        </>
      )}
    </CapabilityCard>
  );
}

/** One segment of the track. Same grammar as the passport's level bars: a
 *  filled segment is reached, an empty one is not. */
function Step({ filled, ink }: { filled: boolean; ink: string }) {
  return (
    <span
      className="h-1.5 flex-1 rounded-full"
      style={filled
        ? { background: ink }
        : { background: 'color-mix(in srgb, var(--foreground) 10%, transparent)' }}
      aria-hidden
    />
  );
}

function StepFoot({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="typo-label text-foreground/40 mb-0.5">{label}</p>
      {children}
    </div>
  );
}

function Absent() {
  const { t } = useTranslation();
  return <span className="typo-caption text-foreground/35" style={{ fontWeight: 400 }}>{t.plugins.dev_tools.monitoring_none_dash}</span>;
}
