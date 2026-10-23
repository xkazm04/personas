// The Stewards plate's body, under the attention-loop
// switch that stays on top: Athena's CLI answerer as one line with the rail's
// switch (the Schedules plate's line: name, toggle - the switch IS its state,
// so no lamp repeats it; the existing autonomous-mode grant, unchanged), then one single-line row per charter,
// the ones asking the operator first. The plate shows at most SHOWN rows, so
// it never pushes the Schedules and Usage plates off the rail; the rest are a
// count that opens the register.
//
// Loading pattern v2: ghost rows until the first read lands; a failed read
// says so in place and keeps any rows it had.

import { useMemo } from 'react';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { setAutonomousMode } from '@/features/companions/athena/chat/athenaChatActions';
import { useLanesSnapshot } from '@/features/decision-center/lanes/useLanesSnapshot';
import { useTranslation } from '@/i18n/useTranslation';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import { useSystemStore } from '@/stores/systemStore';
import { StewardRow } from './StewardRow';
import { useAutopilotModes, useMandates } from './useMandates';

/** The Stewards plate's mandate doors. */
export interface StewardDoors {
  onOpenMandate: (charterId: string) => void;
  onOpenRegister: () => void;
}

const SHOWN = 4;

/** Asking first, then drafts, then by acts; suspended last. */
function rank(m: MandateSummary): number {
  if (m.status === 'suspended') return 0;
  return (m.load.openAsks ?? 0) * 100 + (m.status === 'draft' ? 50 : 0) + Math.min(49, m.load.actsCount ?? 0);
}

function AthenaLine() {
  const { t } = useTranslation();
  const m = t.monitor;
  const on = useSystemStore((s) => s.athenaAutonomousMode);
  return (
    <div className="flex items-center gap-2 px-1.5 py-1" data-testid="fleet-steward-athena">
      <Tooltip content={m.ml_stewards_athena_hint} placement="right">
        <span className="min-w-0 flex-1 truncate typo-caption text-foreground">{m.ml_stewards_athena}</span>
      </Tooltip>
      <AccessibleToggle
        size="sm"
        checked={on}
        onChange={() => setAutonomousMode(!on)}
        label={m.ml_stewards_athena_hint}
        data-testid="fleet-steward-athena-toggle"
      />
    </div>
  );
}

export function StewardsList({ doors }: { doors: StewardDoors }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const { onOpenMandate, onOpenRegister } = doors;
  const { mandates, failed } = useMandates();
  const lanes = useLanesSnapshot(true);
  const sorted = useMemo(() => [...(mandates ?? [])].sort((a, b) => rank(b) - rank(a)), [mandates]);
  // A mirrored mandate's project lives on its home device: its mode is read there, never here.
  const modes = useAutopilotModes(useMemo(() => sorted.filter((x) => !x.mirror).map((x) => x.projectId), [sorted]));
  const held = useMemo(() => {
    const out = new Map<string, number>();
    for (const c of lanes.snapshot?.charters ?? []) out.set(c.charterId, c.held);
    return out;
  }, [lanes.snapshot]);
  const shown = sorted.slice(0, SHOWN);

  return (
    <div className="flex flex-col" data-testid="fleet-stewards">
      <AthenaLine />
      <div className="mt-1 flex flex-col border-t border-foreground/10 pt-1">
        <p className="px-1.5 typo-caption text-status-error" role="status">{failed ? m.ml_stewards_failed : null}</p>
        {mandates === null && !failed ? (
          <div className="flex flex-col gap-1.5 px-1.5 py-1.5" aria-hidden>
            <span className="ae-ghost h-4 rounded-full" />
            <span className="ae-ghost h-4 rounded-full" />
          </div>
        ) : sorted.length === 0 && !failed ? (
          <p className="px-1.5 py-1 typo-caption">{m.ml_stewards_none}</p>
        ) : (
          shown.map((x) => (
            <StewardRow
              key={x.charterId}
              mandate={x}
              mode={modes.get(x.projectId) ?? null}
              modeKnown={modes.has(x.projectId)}
              held={lanes.snapshot ? held.get(x.charterId) ?? 0 : null}
              onOpen={onOpenMandate}
            />
          ))
        )}
        {sorted.length > SHOWN && (
          <Button variant="link" size="xs" onClick={onOpenRegister} className="mt-0.5 self-start px-1.5" data-testid="fleet-stewards-more">
            <span className="typo-caption">{tx(m.ml_stewards_more, { count: sorted.length - SHOWN })}</span>
          </Button>
        )}
      </div>
    </div>
  );
}
