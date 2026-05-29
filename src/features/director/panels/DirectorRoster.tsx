import { useMemo, useState } from 'react';
import { Play, Plus, Star, X, Users } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { DirectorSection } from '../DirectorSection';
import { ScoreSparkline } from '../ScoreSparkline';
import { scoreTone, toneFill } from '../directorScore';
import type { UseDirector } from '../useDirector';

// Shared column template so the header and every row line up exactly.
const ROW_GRID = 'grid grid-cols-[1.7fr_56px_64px_1fr_auto_auto] items-center gap-3';

/**
 * Coaching-scope roster — the first-class scope manager. Each starred persona
 * is a hover-lift row whose left signal line is tinted to its latest score
 * tone; shows latest score, trend sparkline, value rate, and last-review time,
 * with inline "Review now" + remove. Unstarred personas are one click from
 * scope.
 */
export function DirectorRoster({ d }: { d: UseDirector }) {
  const { t, tx } = useTranslation();
  const roster = d.portfolio?.roster ?? [];
  const [running, setRunning] = useState<Set<string>>(new Set());

  const unstarred = useMemo(
    () => d.personas.filter((p) => !p.starred && p.trust_origin !== 'system'),
    [d.personas],
  );

  const reviewOne = async (id: string) => {
    setRunning((s) => new Set(s).add(id));
    try {
      await d.runOnPersona(id);
    } finally {
      setRunning((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <div className="space-y-4 pb-6">
      <DirectorSection label={t.director.roster_title} icon={Users}>
        {roster.length === 0 ? (
          <p className="typo-caption text-foreground/45 py-2">{t.director.scope_empty}</p>
        ) : (
          <div>
            {/* header */}
            <div className={`${ROW_GRID} px-2.5 pb-2 typo-label uppercase tracking-wider text-foreground/45 border-b border-primary/10`}>
              <span>{t.director.roster_col_agent}</span>
              <span className="text-center">{t.director.roster_col_score}</span>
              <span>{t.director.roster_col_trend}</span>
              <span className="text-right">{t.director.roster_col_value}</span>
              <span className="text-right">{t.director.roster_col_last}</span>
              <span />
            </div>
            <div className="mt-1 space-y-0.5">
              {roster.map((r, i) => {
                const tone = r.latestScore != null ? scoreTone(r.latestScore) : null;
                const isRunning = running.has(r.personaId);
                return (
                  <div
                    key={r.personaId}
                    className={`${ROW_GRID} row-hover-lift animate-fade-slide-in pl-2.5 pr-1.5 py-2 rounded`}
                    style={{
                      ['--row-accent' as string]: tone?.color ?? 'var(--primary)',
                      animationDelay: `${Math.min(i, 12) * 30}ms`,
                    }}
                  >
                    {/* agent */}
                    <span className="flex items-center gap-2 min-w-0">
                      <PersonaIcon icon={r.icon} color={r.color} size="w-4 h-4" />
                      <span className="typo-caption text-foreground/85 truncate">{r.name}</span>
                    </span>
                    {/* score */}
                    <span className="text-center">
                      {r.latestScore != null && tone ? (
                        <span
                          className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded text-[11px] tabular-nums font-medium"
                          style={{ color: tone.color, backgroundColor: toneFill(tone.color, 14) }}
                        >
                          {r.latestScore}
                        </span>
                      ) : (
                        <span className="typo-caption text-foreground/35">—</span>
                      )}
                    </span>
                    {/* trend */}
                    <span>
                      {r.scoreTrend.length >= 2 ? (
                        <ScoreSparkline scores={r.scoreTrend} />
                      ) : (
                        <span className="typo-caption text-foreground/35">—</span>
                      )}
                    </span>
                    {/* value rate + micro-bar */}
                    <span className="flex items-center justify-end gap-2">
                      <span className="h-1.5 w-12 rounded-pill bg-secondary/50 overflow-hidden hidden sm:block">
                        <span
                          className="block h-full rounded-pill"
                          style={{ width: `${Math.round(r.valueDeliveredRate * 100)}%`, background: 'var(--status-success)' }}
                        />
                      </span>
                      <Numeric value={r.valueDeliveredRate} unit="ratio" precision={0} className="typo-caption text-foreground/70 tabular-nums" />
                    </span>
                    {/* last review */}
                    <span className="text-right">
                      {r.lastReviewedAt ? (
                        <RelativeTime timestamp={r.lastReviewedAt} className="typo-caption text-foreground/55" />
                      ) : (
                        <span className="typo-caption text-foreground/35">{t.director.roster_never}</span>
                      )}
                    </span>
                    {/* actions */}
                    <span className="flex items-center justify-end gap-1">
                      <Button
                        variant="secondary"
                        size="xs"
                        icon={<Play className="w-3 h-3" />}
                        disabled={isRunning}
                        onClick={() => reviewOne(r.personaId)}
                      >
                        {isRunning ? t.director.running : t.director.roster_review_now}
                      </Button>
                      <Tooltip content={t.director.roster_remove}>
                        <button
                          type="button"
                          onClick={() => d.setStarred(r.personaId, false)}
                          className="p-1 rounded text-foreground/40 hover:text-foreground/80 hover:bg-secondary/40 transition-colors"
                          aria-label={t.director.roster_remove}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </Tooltip>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </DirectorSection>

      {/* Add to scope */}
      <DirectorSection
        label={t.director.roster_add_title}
        icon={Plus}
        action={
          <span className="inline-flex items-center gap-1 typo-caption text-foreground/40">
            <Star className="w-3 h-3 text-violet-400/60" />
            {tx(t.director.scope_summary, { count: roster.length })}
          </span>
        }
      >
        {unstarred.length === 0 ? (
          <p className="typo-caption text-foreground/45 py-1">{t.director.roster_add_placeholder}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {unstarred.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => d.setStarred(p.id, true)}
                className="group inline-flex items-center gap-1.5 px-2 py-1 rounded-interactive border border-primary/10 bg-secondary/20 hover:bg-violet-500/10 hover:border-violet-500/30 hover:-translate-y-px transition-[transform,background-color,border-color] duration-150 will-change-transform motion-reduce:hover:translate-y-0 typo-caption text-foreground/80"
              >
                <PersonaIcon icon={p.icon} color={p.color} size="w-3.5 h-3.5" />
                <span className="truncate max-w-[140px]">{p.name}</span>
                <Plus className="w-3 h-3 text-violet-400/60 group-hover:text-violet-300 transition-colors" />
              </button>
            ))}
          </div>
        )}
      </DirectorSection>
    </div>
  );
}
