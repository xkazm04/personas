import { ArrowRight, Star } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import { useDirector } from '@/features/director/useDirector';

/**
 * Slim Director teaser on the All Agents page. Since v2 the full management
 * surface lives in the dedicated Director command center; this strip is just a
 * status glance (scope + avg score + last review) and a deep-link in. All data
 * comes from the shared `useDirector` hook — no duplicated fetch, no drift.
 * Hidden until the Director persona has been seeded.
 */
export function DirectorPanel() {
  const { t, tx } = useTranslation();
  const d = useDirector();

  if (!d.ready || !d.director) return null;

  const inScope = d.portfolio?.inScope ?? 0;
  const avg = d.portfolio?.avgScore ?? null;
  const lastVerdictAt = d.verdicts[0]?.createdAt ?? null;

  return (
    <div className="mx-3 mt-2 flex items-center gap-3 rounded-card border border-violet-500/20 bg-violet-500/[0.04] px-4 py-2.5">
      <PersonaIcon icon={d.director.icon} color={d.director.color} size="w-4 h-4" />
      <div className="min-w-0 flex-1">
        <div className="typo-body font-medium text-foreground/90">{t.director.panel_title}</div>
        <div className="typo-caption text-foreground/60 flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1">
            <Star className="w-3 h-3 text-violet-400/70" />
            {inScope > 0 ? tx(t.director.scope_summary, { count: inScope }) : t.director.scope_empty}
          </span>
          {avg != null && (
            <>
              <span className="text-foreground/30">·</span>
              <span>
                {t.director.kpi_avg_score} <Numeric value={avg} precision={1} className="text-foreground/80" />
              </span>
            </>
          )}
          {lastVerdictAt && (
            <>
              <span className="text-foreground/30">·</span>
              <span className="text-foreground/55">{t.director.last_review}</span>
              <RelativeTime timestamp={lastVerdictAt} />
            </>
          )}
        </div>
      </div>
      <Button
        variant="accent"
        accentColor="violet"
        size="sm"
        icon={<ArrowRight className="w-3.5 h-3.5" />}
        onClick={() => d.openDirector()}
        data-testid="director-open"
      >
        {t.director.open_director}
      </Button>
    </div>
  );
}
