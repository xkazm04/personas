import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Play } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { listDirectorVerdicts, type DirectorRosterEntry, type DirectorVerdictRow } from '@/api/director';
import { silentCatch } from '@/lib/silentCatch';
import { ScoreSparkline } from '../ScoreSparkline';
import { scoreTone, toneFill } from '../directorScore';
import { attentionFlags, FLAG_TONE, type AttentionFlag } from '../attention';

const SEVERITY_LINE: Record<string, string> = {
  error: 'var(--status-error)',
  warning: 'var(--status-warning)',
  info: 'var(--status-info)',
};
const SEVERITY_CHIP: Record<string, string> = {
  error: 'bg-red-500/15 text-red-400',
  warning: 'bg-amber-500/15 text-amber-400',
  info: 'bg-blue-500/15 text-blue-400',
};

const FLAG_LABEL = (t: ReturnType<typeof useTranslation>['t']): Record<AttentionFlag, { label: string; hint: string }> => ({
  needs_review: { label: t.director.flag_new, hint: t.director.group_needs_review_hint },
  low: { label: t.director.flag_low, hint: t.director.group_low_scores_hint },
  declining: { label: t.director.flag_declining, hint: t.director.group_declining_hint },
  stale: { label: t.director.flag_stale, hint: t.director.group_stale_hint },
});

/**
 * Per-persona coaching detail — the consolidated "Reviews" surface, scoped to
 * one agent. Opened by clicking a row in the coaching table. Shows the agent's
 * score trend, value signal, active attention flags, and full verdict history
 * (expandable to rationale + suggested actions), plus a Review-now action.
 */
export function PersonaDetailModal({
  entry,
  onClose,
  onRunReview,
}: {
  entry: DirectorRosterEntry | null;
  onClose: () => void;
  onRunReview: (personaId: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [verdicts, setVerdicts] = useState<DirectorVerdictRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!entry) return;
    setLoading(true);
    setExpanded(null);
    listDirectorVerdicts(entry.personaId)
      .then(setVerdicts)
      .catch(silentCatch('PersonaDetailModal:verdicts'))
      .finally(() => setLoading(false));
  }, [entry]);

  if (!entry) return null;

  const tone = entry.latestScore != null ? scoreTone(entry.latestScore) : null;
  const flags = attentionFlags(entry, Date.now());
  const flagMeta = FLAG_LABEL(t);

  const runReview = async () => {
    setRunning(true);
    try {
      await onRunReview(entry.personaId);
    } finally {
      setRunning(false);
    }
  };

  return (
    <BaseModal
      isOpen={!!entry}
      onClose={onClose}
      titleId="director-persona-detail-title"
      size="lg"
      portal
      staggerChildren={false}
      panelClassName="relative bg-gradient-to-b from-background to-[color-mix(in_srgb,var(--color-background),var(--color-primary)_3%)] border border-primary/15 rounded-2xl shadow-elevation-4 overflow-hidden flex flex-col w-full max-h-[82vh]"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-primary/10 bg-secondary/20">
        <PersonaIcon icon={entry.icon} color={entry.color} size="w-5 h-5" />
        <h3 id="director-persona-detail-title" className="typo-body-lg font-semibold text-foreground flex-1 truncate">
          {entry.name}
        </h3>
        {entry.latestScore != null && tone && (
          <span
            className="inline-flex items-center justify-center min-w-[1.75rem] px-2 py-0.5 rounded typo-body tabular-nums font-semibold"
            style={{ color: tone.color, backgroundColor: toneFill(tone.color, 16) }}
          >
            {entry.latestScore}
          </span>
        )}
        <AsyncButton
          variant="accent"
          accentColor="violet"
          size="sm"
          isLoading={running}
          loadingText={t.director.running}
          icon={<Play className="w-3.5 h-3.5" />}
          onClick={runReview}
        >
          {t.director.roster_review_now}
        </AsyncButton>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
        {/* signal row: trend + value + flags */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {entry.scoreTrend.length >= 2 && (
            <div className="flex items-center gap-2">
              <span className="typo-caption uppercase tracking-wider text-foreground/60">{t.director.col_verdict}</span>
              <ScoreSparkline scores={entry.scoreTrend} width={72} height={20} />
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="typo-caption uppercase tracking-wider text-foreground/60">{t.director.detail_value_rate}</span>
            <Numeric value={entry.valueDeliveredRate} unit="ratio" precision={0} className="typo-body font-medium text-foreground tabular-nums" />
          </div>
          <div className="flex items-center gap-2">
            <span className="typo-caption uppercase tracking-wider text-foreground/60">{t.director.last_review}</span>
            {entry.lastReviewedAt ? (
              <RelativeTime timestamp={entry.lastReviewedAt} className="typo-body text-foreground/80" />
            ) : (
              <span className="typo-body text-foreground/55">{t.director.roster_never}</span>
            )}
          </div>
        </div>

        {/* attention flags */}
        {flags.length > 0 && (
          <div className="space-y-1.5">
            <span className="typo-caption uppercase tracking-wider text-foreground/60">{t.director.detail_attention}</span>
            <div className="flex flex-col gap-1.5">
              {flags.map((f) => (
                <div key={f} className="flex items-center gap-2">
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide font-medium shrink-0"
                    style={{ color: FLAG_TONE[f], backgroundColor: toneFill(FLAG_TONE[f], 14) }}
                  >
                    {flagMeta[f].label}
                  </span>
                  <span className="typo-caption text-foreground/70">{flagMeta[f].hint}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* verdict history */}
        <div className="space-y-1.5">
          <span className="typo-caption uppercase tracking-wider text-foreground/60">{t.director.detail_history}</span>
          {loading ? (
            <p className="typo-body text-foreground/55 py-2">…</p>
          ) : verdicts.length === 0 ? (
            <p className="typo-body text-foreground/55 py-2">{t.director.no_verdicts}</p>
          ) : (
            <ul className="space-y-1.5">
              {verdicts.map((v) => {
                const open = expanded === v.reviewId;
                const Chevron = open ? ChevronDown : ChevronRight;
                return (
                  <li
                    key={v.reviewId}
                    className="relative overflow-hidden rounded-card border border-primary/10 bg-secondary/15"
                  >
                    <span aria-hidden className="absolute inset-y-0 left-0 w-0.5" style={{ background: SEVERITY_LINE[v.severity] ?? SEVERITY_LINE.info }} />
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : v.reviewId)}
                      className="w-full flex items-center gap-2 pl-3 pr-2.5 py-2 text-left hover:bg-secondary/30 transition-colors"
                    >
                      <Chevron className="w-3.5 h-3.5 text-foreground/50 shrink-0" />
                      <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide shrink-0 ${SEVERITY_CHIP[v.severity] ?? SEVERITY_CHIP.info}`}>
                        {tokenLabel(t, 'severity', v.severity)}
                      </span>
                      <span className="typo-body text-foreground truncate flex-1">{v.title}</span>
                      <RelativeTime timestamp={v.createdAt} className="typo-caption text-foreground/50 shrink-0" />
                    </button>
                    {open && (
                      <div className="pl-8 pr-4 pb-3 pt-0.5 space-y-2 animate-fade-slide-in">
                        {v.description && <p className="typo-body text-foreground/90">{v.description}</p>}
                        {v.rationale && (
                          <p className="typo-caption text-foreground/70 italic border-l-2 border-primary/15 pl-2">{v.rationale}</p>
                        )}
                        {v.suggestedActions.length > 0 && (
                          <ul className="space-y-1">
                            {v.suggestedActions.map((a, j) => (
                              <li key={j} className="flex items-start gap-1.5 typo-caption text-foreground/85">
                                <span className="mt-1 w-1 h-1 rounded-full bg-violet-400 shrink-0" />
                                {a}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </BaseModal>
  );
}
