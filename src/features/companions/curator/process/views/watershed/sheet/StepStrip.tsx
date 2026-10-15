import { useTranslation } from '@/i18n/useTranslation';
import type { RawStep } from './detail';

const PHASES = ['brief', 'explore', 'edit', 'verify', 'ship', 'wait'] as const;

/**
 * A session's whole step sequence as one strip: a cell per step coloured by phase, errors marked
 * above and interrupts or compactions below. A drawing, so it scales to the sheet's width.
 */
export function StepStrip({ steps }: { steps: readonly RawStep[] }) {
  const { t } = useTranslation();
  const p = t.companions.process;
  const w = p.watershed;
  const n = Math.max(1, steps.length), cw = 1000 / n, gap = cw > 3 ? 1 : 0;
  const names: Record<(typeof PHASES)[number], string> = {
    brief: p.phase_brief, explore: p.phase_explore, edit: p.phase_edit, verify: p.phase_verify, ship: p.phase_ship, wait: w.legend_wait,
  };
  return (
    <>
      <svg className="ws-strip" viewBox="0 0 1000 86" preserveAspectRatio="none" aria-hidden="true">
        {steps.map((r, i) => {
          const ph = (PHASES as readonly string[]).includes(r.phase) ? r.phase : r.kind === 'interrupt' || r.kind === 'compact' ? 'warn' : 'wait';
          return (
            <g key={i}>
              <rect className={`ws-ph-${ph}`} x={i * cw} y={26} width={Math.max(0.6, cw - gap)} height={36} />
              {r.err > 0 && <rect className="ws-ph-err" x={i * cw} y={8} width={Math.max(1.5, cw - 1)} height={12} />}
              {(r.kind === 'interrupt' || r.kind === 'compact') && <rect className="ws-ph-warn" x={i * cw} y={66} width={Math.max(1.5, cw - 1)} height={12} />}
            </g>
          );
        })}
      </svg>
      <div className="ws-legend typo-caption">
        {PHASES.map((ph) => <span key={ph}><i className={`ws-ph-${ph}`} />{names[ph]}</span>)}
        <span><i className="ws-ph-err" />{w.legend_error}</span>
        <span><i className="ws-ph-warn" />{w.legend_interrupt}</span>
      </div>
    </>
  );
}
