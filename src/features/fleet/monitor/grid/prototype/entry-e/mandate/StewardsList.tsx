// The Stewards plate's body (setting `lanes`), under the attention-loop
// switch that stays on top: Athena's CLI answerer as its own row with its own
// grant (the existing autonomous-mode toggle, unchanged), then one row per
// charter, the ones asking the operator first. The plate shows a handful;
// the rest are a count that opens the register.
//
// Loading pattern v2: ghost rows until the first read lands; a failed read
// says so in place and keeps any rows it had.

import { Bot } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { setAutonomousMode } from '@/features/companions/athena/chat/athenaChatActions';
import { useLanesSnapshot } from '@/features/decision-center/lanes/useLanesSnapshot';
import { useTranslation } from '@/i18n/useTranslation';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import { useSystemStore } from '@/stores/systemStore';
import { Lamp } from '../parts';
import { StewardRow } from './StewardRow';
import { useAutopilotModes, useMandates } from './useMandates';

/** The Stewards plate's mandate doors (setting `lanes`). */
export interface StewardDoors {
  onOpenMandate: (charterId: string) => void;
  onOpenRegister: () => void;
}

const SHOWN = 6;

/** Asking first, then drafts, then by acts; suspended last. */
function rank(m: MandateSummary): number {
  if (m.status === 'suspended') return 0;
  return (m.load.openAsks ?? 0) * 100 + (m.status === 'draft' ? 50 : 0) + Math.min(49, m.load.actsCount ?? 0);
}

function AthenaRow() {
  const { t } = useTranslation();
  const m = t.monitor;
  const on = useSystemStore((s) => s.athenaAutonomousMode);
  return (
    <div className="flex items-center gap-2 px-2 py-1" data-testid="fleet-steward-athena">
      <Lamp lamp={{ tone: 'run', lit: on }} />
      <Tooltip content={m.ml_stewards_athena_hint} placement="right">
        <span className="min-w-0 flex-1 typo-body text-foreground">{m.ml_stewards_athena}</span>
      </Tooltip>
      <Button
        variant={on ? 'accent' : 'secondary'}
        tone={on ? 'success' : undefined}
        size="xs"
        aria-pressed={on}
        aria-label={m.ml_stewards_athena_hint}
        onClick={() => setAutonomousMode(!on)}
        icon={<Bot className="h-3.5 w-3.5" aria-hidden />}
        data-testid="fleet-steward-athena-toggle"
      >
        {on ? t.common.active : t.common.off}
      </Button>
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
  const modes = useAutopilotModes(useMemo(() => sorted.map((x) => x.projectId), [sorted]));
  const held = useMemo(() => {
    const out = new Map<string, number>();
    for (const c of lanes.snapshot?.charters ?? []) out.set(c.charterId, c.held);
    return out;
  }, [lanes.snapshot]);
  const shown = sorted.slice(0, SHOWN);

  return (
    <div className="flex flex-col gap-0.5 border-t border-foreground/10 pt-1.5" data-testid="fleet-stewards">
      <AthenaRow />
      <p className="px-2 typo-caption text-status-error" role="status">{failed ? m.ml_stewards_failed : null}</p>
      {mandates === null && !failed ? (
        <div className="flex flex-col gap-1 px-2 py-1" aria-hidden>
          <span className="h-9 rounded-input bg-foreground/5" />
          <span className="h-9 rounded-input bg-foreground/5" />
        </div>
      ) : sorted.length === 0 && !failed ? (
        <p className="px-2 py-1 typo-caption">{m.ml_stewards_none}</p>
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
        <Button variant="link" size="xs" onClick={onOpenRegister} className="self-start px-2" data-testid="fleet-stewards-more">
          {tx(m.ml_stewards_more, { count: sorted.length - SHOWN })}
        </Button>
      )}
    </div>
  );
}
