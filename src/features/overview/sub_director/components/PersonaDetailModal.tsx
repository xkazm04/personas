import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Play, Eraser, Brain } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Button } from '@/features/shared/components/buttons';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { listDirectorVerdicts, runDirectorMemoryCleanup, getDirectorBrainHistory, type DirectorRosterEntry, type DirectorVerdictRow, type MemoryCleanupReport } from '@/api/director';
import { useToastStore } from '@/stores/toastStore';
import { silentCatch } from '@/lib/silentCatch';
import { ScoreSparkline } from '../ScoreSparkline';
import { scoreTone, toneFill } from '../directorScore';
import { attentionFlags, FLAG_TONE, type AttentionFlag } from '../attention';
import { categoryMeta, categoryLabel } from '../categoryMeta';

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
  const { t, tx } = useTranslation();
  const [verdicts, setVerdicts] = useState<DirectorVerdictRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [brainHistory, setBrainHistory] = useState<string | null>(null);
  const [brainOpen, setBrainOpen] = useState(false);
  const addToast = useToastStore((s) => s.addToast);

  useEffect(() => {
    if (!entry) return;
    setLoading(true);
    setExpanded(null);
    setCatFilter(null);
    setBrainHistory(null);
    setBrainOpen(false);
    listDirectorVerdicts(entry.personaId)
      .then(setVerdicts)
      .catch(silentCatch('PersonaDetailModal:verdicts'))
      .finally(() => setLoading(false));
    // Best-effort: returns null when Brain is off / no vault / no notes yet.
    getDirectorBrainHistory(entry.personaId)
      .then(setBrainHistory)
      .catch(silentCatch('PersonaDetailModal:brainHistory'));
  }, [entry]);

  // Distinct categories present in this persona's history (first-seen order),
  // for the filter strip. Only worth showing when there's more than one.
  const presentCategories = useMemo(() => {
    const seen: string[] = [];
    for (const v of verdicts) if (v.category && !seen.includes(v.category)) seen.push(v.category);
    return seen;
  }, [verdicts]);
  const shownVerdicts = catFilter ? verdicts.filter((v) => v.category === catFilter) : verdicts;

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

  const cleanMemories = async () => {
    setCleaning(true);
    try {
      const r: MemoryCleanupReport = await runDirectorMemoryCleanup(entry.personaId);
      const archived = r.deduped + r.llmArchived;
      addToast(
        archived === 0
          ? t.director.cleanup_none
          : tx(t.director.cleanup_done, { count: archived, deduped: r.deduped, llm: r.llmArchived }),
        'success',
      );
      // Refresh the verdict list (the cleanup doesn't change verdicts, but the
      // scores/last-review may have shifted if a review ran alongside).
      listDirectorVerdicts(entry.personaId).then(setVerdicts).catch(silentCatch('PersonaDetailModal:verdicts'));
    } catch (e) {
      silentCatch('PersonaDetailModal:cleanMemories')(e);
      addToast(t.director.cleanup_failed, 'error');
    } finally {
      setCleaning(false);
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
        <Button
          variant="secondary"
          size="sm"
          disabled={cleaning}
          icon={<Eraser className={`w-3.5 h-3.5 ${cleaning ? 'animate-pulse' : ''}`} />}
          onClick={cleanMemories}
          title={t.director.cleanup_hint}
        >
          {cleaning ? t.director.cleanup_running : t.director.cleanup_memories}
        </Button>
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
              <span className="typo-caption uppercase tracking-wider text-foreground">{t.director.col_verdict}</span>
              <ScoreSparkline scores={entry.scoreTrend} width={72} height={20} tooltip={`${t.director.sparkline_scores}: ${entry.scoreTrend.join(' → ')}`} />
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="typo-caption uppercase tracking-wider text-foreground">{t.director.detail_value_rate}</span>
            <Numeric value={entry.valueDeliveredRate} unit="ratio" precision={0} className="typo-body font-medium text-foreground tabular-nums" />
          </div>
          <div className="flex items-center gap-2">
            <span className="typo-caption uppercase tracking-wider text-foreground">{t.director.last_review}</span>
            {entry.lastReviewedAt ? (
              <RelativeTime timestamp={entry.lastReviewedAt} className="typo-body text-foreground" />
            ) : (
              <span className="typo-body text-foreground">{t.director.roster_never}</span>
            )}
          </div>
        </div>

        {/* attention flags */}
        {flags.length > 0 && (
          <div className="space-y-1.5">
            <span className="typo-caption uppercase tracking-wider text-foreground">{t.director.detail_attention}</span>
            <div className="flex flex-col gap-1.5">
              {flags.map((f) => (
                <div key={f} className="flex items-center gap-2">
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide font-medium shrink-0"
                    style={{ color: FLAG_TONE[f], backgroundColor: toneFill(FLAG_TONE[f], 14) }}
                  >
                    {flagMeta[f].label}
                  </span>
                  <span className="typo-caption text-foreground">{flagMeta[f].hint}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* verdict history */}
        <div className="space-y-1.5">
          <span className="typo-caption uppercase tracking-wider text-foreground">{t.director.detail_history}</span>
          {/* category filter — only when the history spans more than one kind */}
          {presentCategories.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5 pb-0.5">
              <button
                type="button"
                onClick={() => setCatFilter(null)}
                className={`px-2 py-0.5 rounded-pill typo-caption transition-colors focus-ring ${
                  catFilter === null ? 'bg-violet-500/15 text-violet-200 border border-violet-500/30' : 'text-foreground border border-transparent hover:bg-secondary/40'
                }`}
              >
                {t.director.category_all}
              </button>
              {presentCategories.map((c) => {
                const meta = categoryMeta(c);
                const active = catFilter === c;
                const Icon = meta.icon;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCatFilter(active ? null : c)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-pill typo-caption transition-colors focus-ring border"
                    style={
                      active
                        ? { color: meta.color, backgroundColor: toneFill(meta.color, 16), borderColor: meta.color }
                        : { color: 'var(--foreground)', borderColor: 'transparent' }
                    }
                  >
                    <Icon className="w-3 h-3" />
                    {categoryLabel(t, c)}
                  </button>
                );
              })}
            </div>
          )}
          {loading ? (
            <div className="flex justify-center py-4"><LoadingSpinner /></div>
          ) : verdicts.length === 0 ? (
            <p className="typo-body text-foreground py-2">{t.director.no_verdicts}</p>
          ) : (
            <ul className="space-y-1.5">
              {shownVerdicts.map((v) => {
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
                      <Chevron className="w-3.5 h-3.5 text-foreground shrink-0" />
                      <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide shrink-0 ${SEVERITY_CHIP[v.severity] ?? SEVERITY_CHIP.info}`}>
                        {tokenLabel(t, 'severity', v.severity)}
                      </span>
                      {v.category && (() => {
                        const meta = categoryMeta(v.category);
                        const Icon = meta.icon;
                        return (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] shrink-0"
                            style={{ color: meta.color, backgroundColor: toneFill(meta.color, 14) }}
                          >
                            <Icon className="w-3 h-3" />
                            {categoryLabel(t, v.category)}
                          </span>
                        );
                      })()}
                      <span className="typo-body text-foreground truncate flex-1">{v.title}</span>
                      <RelativeTime timestamp={v.createdAt} className="typo-caption text-foreground shrink-0" />
                    </button>
                    {open && (
                      <div className="pl-8 pr-4 pb-3 pt-0.5 space-y-2 animate-fade-slide-in">
                        {v.description && <p className="typo-body text-foreground">{v.description}</p>}
                        {v.rationale && (
                          <p className="typo-caption text-foreground italic border-l-2 border-primary/15 pl-2">{v.rationale}</p>
                        )}
                        {v.suggestedActions.length > 0 && (
                          <ul className="space-y-1">
                            {v.suggestedActions.map((a, j) => (
                              <li key={j} className="flex items-start gap-1.5 typo-caption text-foreground">
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

        {/* prior coaching from long-term memory (Obsidian Brain), when enabled */}
        {brainHistory && (
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => setBrainOpen((o) => !o)}
              aria-expanded={brainOpen}
              className="inline-flex items-center gap-1.5 typo-caption uppercase tracking-wider text-foreground focus-ring rounded"
            >
              {brainOpen ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
              <Brain className="w-3.5 h-3.5 text-violet-300" />
              {t.director.brain_history_title}
            </button>
            {brainOpen && (
              <div className="rounded-card border border-primary/10 bg-secondary/15 px-3 py-2 animate-fade-slide-in">
                <MarkdownRenderer content={brainHistory} />
              </div>
            )}
          </div>
        )}
      </div>
    </BaseModal>
  );
}
