import { useMemo, useState } from 'react';
import { Play, Plus, Star, X } from 'lucide-react';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { Button } from '@/features/shared/components/buttons';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { ScoreSparkline } from '../ScoreSparkline';
import { scoreTone, toneFill } from '../directorScore';
import type { UseDirector } from '../useDirector';

/**
 * Coaching-scope roster — the first-class scope manager. Each starred persona
 * shows its latest score, trend sparkline, value rate, and last-review time,
 * with inline "Review now" + "remove from scope". Unstarred personas are one
 * click from being added to scope.
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
      <SectionCard title={t.director.roster_title} size="sm">
        {roster.length === 0 ? (
          <p className="typo-caption text-foreground/45 py-2">{t.director.scope_empty}</p>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="typo-caption text-foreground/50 border-b border-primary/10">
                <th className="py-1.5 font-normal">{t.director.roster_col_agent}</th>
                <th className="py-1.5 font-normal text-center">{t.director.roster_col_score}</th>
                <th className="py-1.5 font-normal">{t.director.roster_col_trend}</th>
                <th className="py-1.5 font-normal text-right">{t.director.roster_col_value}</th>
                <th className="py-1.5 font-normal text-right">{t.director.roster_col_last}</th>
                <th className="py-1.5 font-normal" />
              </tr>
            </thead>
            <tbody>
              {roster.map((r) => {
                const tone = r.latestScore != null ? scoreTone(r.latestScore) : null;
                const isRunning = running.has(r.personaId);
                return (
                  <tr key={r.personaId} className="border-b border-primary/5 last:border-0 hover:bg-secondary/20">
                    <td className="py-2">
                      <span className="flex items-center gap-2 min-w-0">
                        <PersonaIcon icon={r.icon} color={r.color} size="w-4 h-4" />
                        <span className="typo-caption text-foreground/85 truncate max-w-[180px]">{r.name}</span>
                      </span>
                    </td>
                    <td className="py-2 text-center">
                      {r.latestScore != null && tone ? (
                        <span
                          className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded text-[11px] tabular-nums"
                          style={{ color: tone.color, backgroundColor: toneFill(tone.color) }}
                        >
                          {r.latestScore}
                        </span>
                      ) : (
                        <span className="typo-caption text-foreground/35">—</span>
                      )}
                    </td>
                    <td className="py-2">
                      {r.scoreTrend.length >= 2 ? (
                        <ScoreSparkline scores={r.scoreTrend} />
                      ) : (
                        <span className="typo-caption text-foreground/35">—</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <Numeric value={r.valueDeliveredRate} unit="ratio" precision={0} className="typo-caption text-foreground/70" />
                    </td>
                    <td className="py-2 text-right">
                      {r.lastReviewedAt ? (
                        <RelativeTime timestamp={r.lastReviewedAt} className="typo-caption text-foreground/55" />
                      ) : (
                        <span className="typo-caption text-foreground/35">{t.director.roster_never}</span>
                      )}
                    </td>
                    <td className="py-2">
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </SectionCard>

      {/* Add to scope */}
      <SectionCard title={t.director.roster_add_title} size="sm">
        {unstarred.length === 0 ? (
          <p className="typo-caption text-foreground/45 py-1">{t.director.roster_add_placeholder}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {unstarred.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => d.setStarred(p.id, true)}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-interactive border border-primary/10 bg-secondary/20 hover:bg-secondary/40 hover:border-violet-500/30 transition-colors typo-caption text-foreground/80"
              >
                <PersonaIcon icon={p.icon} color={p.color} size="w-3.5 h-3.5" />
                <span className="truncate max-w-[140px]">{p.name}</span>
                <Plus className="w-3 h-3 text-violet-400/70" />
              </button>
            ))}
          </div>
        )}
        <p className="typo-caption text-foreground/40 mt-2 flex items-center gap-1">
          <Star className="w-3 h-3" />
          {tx(t.director.scope_summary, { count: roster.length })}
        </p>
      </SectionCard>
    </div>
  );
}
