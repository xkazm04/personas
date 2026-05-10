import { useState } from 'react';
import { useOverviewData } from './useOverviewData';
import { ProjectOverviewBaseline } from './ProjectOverviewBaseline';
import { ProjectOverviewVariantPulse } from './ProjectOverviewVariantPulse';
import { ProjectOverviewVariantBriefing } from './ProjectOverviewVariantBriefing';

// Re-export shared helpers so existing call sites and tests keep resolving.
export { formatErr } from './overviewHelpers';

type Variant = 'baseline' | 'pulse' | 'briefing';

const VARIANTS: { id: Variant; label: string; subtitle: string }[] = [
  { id: 'baseline', label: 'Baseline', subtitle: 'two-column codebase + monitoring' },
  { id: 'pulse', label: 'Pulse', subtitle: 'glance-first vital-signs strip' },
  { id: 'briefing', label: 'Briefing', subtitle: 'narrative report-cards' },
];

/**
 * Tab-switcher wrapper for the prototype phase. The actually-rendered
 * Overview is one of three siblings; the user picks which via the strip
 * at the top. Data loading happens once in the wrapper and is passed to
 * the active variant.
 *
 * After a winner is picked, this scaffold collapses into the winning
 * variant directly (Phase 5 of the /prototype skill).
 */
export default function ProjectOverviewPage() {
  const [variant, setVariant] = useState<Variant>('baseline');
  const data = useOverviewData();

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-3 pb-2 border-b border-card-border bg-card-bg/60 flex items-center gap-2 flex-wrap">
        <span className="typo-caption text-foreground/40 mr-1">PROTOTYPE</span>
        {VARIANTS.map((v) => {
          const isActive = variant === v.id;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => setVariant(v.id)}
              className={`px-3 py-1 rounded-interactive transition-colors text-left ${
                isActive
                  ? 'bg-primary/15 border border-primary/30 text-foreground'
                  : 'border border-transparent hover:bg-primary/5 text-foreground/70 hover:text-foreground'
              }`}
            >
              <div className="typo-caption font-semibold leading-tight">{v.label}</div>
              <div className="text-[10px] text-foreground/50 leading-tight mt-0.5">{v.subtitle}</div>
            </button>
          );
        })}
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        {variant === 'baseline' && <ProjectOverviewBaseline data={data} />}
        {variant === 'pulse' && <ProjectOverviewVariantPulse data={data} />}
        {variant === 'briefing' && <ProjectOverviewVariantBriefing data={data} />}
      </div>
    </div>
  );
}
