import { useMemo, useState } from 'react';
import { AlertTriangle, EyeOff, TrendingDown, Clock, Play, ShieldCheck, type LucideIcon } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { Button } from '@/features/shared/components/buttons';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import { DirectorSection } from '../DirectorSection';
import { scoreTone, toneFill } from '../directorScore';
import type { DirectorRosterEntry } from '@/api/director';
import type { UseDirector } from '../useDirector';

const STALE_MS = 14 * 24 * 60 * 60 * 1000;

type GroupKey = 'needs_review' | 'low_scores' | 'declining' | 'stale';

interface GroupDef {
  key: GroupKey;
  icon: LucideIcon;
  tone: string; // CSS color var
  label: string;
  hint: string;
}

/**
 * Attention — the triage surface. Derived entirely client-side from the
 * portfolio roster: each in-scope agent is bucketed into its single
 * highest-priority concern (never-reviewed → low score → declining trend →
 * stale review) so the user sees exactly what to act on, with one-click review.
 * When nothing needs attention, it says so.
 */
export function DirectorAttention({ d }: { d: UseDirector }) {
  const { t } = useTranslation();
  const roster = d.portfolio?.roster ?? [];
  const [running, setRunning] = useState<Set<string>>(new Set());

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

  const groups = useMemo(() => {
    const now = Date.now();
    const buckets: Record<GroupKey, DirectorRosterEntry[]> = {
      needs_review: [],
      low_scores: [],
      declining: [],
      stale: [],
    };
    for (const r of roster) {
      if (r.latestScore == null) {
        buckets.needs_review.push(r);
      } else if (r.latestScore <= 2) {
        buckets.low_scores.push(r);
      } else if (r.scoreTrend.length >= 2 && r.scoreTrend[r.scoreTrend.length - 1]! < r.scoreTrend[r.scoreTrend.length - 2]!) {
        buckets.declining.push(r);
      } else if (r.lastReviewedAt && now - new Date(r.lastReviewedAt).getTime() > STALE_MS) {
        buckets.stale.push(r);
      }
    }
    return buckets;
  }, [roster]);

  const defs: GroupDef[] = [
    { key: 'needs_review', icon: EyeOff, tone: 'var(--status-info)', label: t.director.group_needs_review, hint: t.director.group_needs_review_hint },
    { key: 'low_scores', icon: AlertTriangle, tone: 'var(--status-error)', label: t.director.group_low_scores, hint: t.director.group_low_scores_hint },
    { key: 'declining', icon: TrendingDown, tone: 'var(--status-warning)', label: t.director.group_declining, hint: t.director.group_declining_hint },
    { key: 'stale', icon: Clock, tone: 'var(--muted-foreground)', label: t.director.group_stale, hint: t.director.group_stale_hint },
  ];

  const totalFlagged = defs.reduce((n, g) => n + groups[g.key].length, 0);

  if (roster.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title={t.director.empty_title}
        subtitle={t.director.empty_subtitle}
        iconColor="text-violet-400/80"
        iconContainerClassName="bg-violet-500/10 border-violet-500/20"
        action={{ label: t.director.empty_cta, onClick: () => d.openDirector() }}
      />
    );
  }

  if (totalFlagged === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title={t.director.attention_all_clear_title}
        subtitle={t.director.attention_all_clear_subtitle}
        iconColor="text-[var(--status-success)]"
        iconContainerClassName="bg-[color-mix(in_oklab,var(--status-success)_12%,transparent)] border-[color-mix(in_oklab,var(--status-success)_25%,transparent)]"
      />
    );
  }

  return (
    <div className="space-y-4 pb-6">
      {defs.map((g, gi) => {
        const entries = groups[g.key];
        if (entries.length === 0) return null;
        return (
          <DirectorSection
            key={g.key}
            label={g.label}
            icon={g.icon}
            style={{ animationDelay: `${gi * 40}ms` }}
            className="animate-fade-slide-in"
            action={
              <span
                className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded-pill typo-caption tabular-nums font-medium"
                style={{ color: g.tone, backgroundColor: toneFill(g.tone, 14) }}
              >
                {entries.length}
              </span>
            }
          >
            <p className="typo-caption text-foreground/45 -mt-1 mb-2">{g.hint}</p>
            <div className="space-y-0.5">
              {entries.map((r) => {
                const tone = r.latestScore != null ? scoreTone(r.latestScore) : null;
                const isRunning = running.has(r.personaId);
                return (
                  <div
                    key={r.personaId}
                    className="row-hover-lift flex items-center gap-2.5 pl-2.5 pr-1.5 py-2 rounded"
                    style={{ ['--row-accent' as string]: g.tone }}
                  >
                    <PersonaIcon icon={r.icon} color={r.color} size="w-4 h-4" />
                    <span className="typo-caption text-foreground/85 truncate flex-1">{r.name}</span>
                    {r.latestScore != null && tone && (
                      <span
                        className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded text-[11px] tabular-nums font-medium"
                        style={{ color: tone.color, backgroundColor: toneFill(tone.color, 14) }}
                      >
                        {r.latestScore}
                      </span>
                    )}
                    {r.lastReviewedAt ? (
                      <RelativeTime timestamp={r.lastReviewedAt} className="typo-caption text-foreground/45 shrink-0 hidden sm:inline" />
                    ) : (
                      <span className="typo-caption text-foreground/35 shrink-0 hidden sm:inline">{t.director.roster_never}</span>
                    )}
                    <Button
                      variant="secondary"
                      size="xs"
                      icon={<Play className="w-3 h-3" />}
                      disabled={isRunning}
                      onClick={() => reviewOne(r.personaId)}
                    >
                      {isRunning ? t.director.running : t.director.roster_review_now}
                    </Button>
                  </div>
                );
              })}
            </div>
          </DirectorSection>
        );
      })}
    </div>
  );
}
