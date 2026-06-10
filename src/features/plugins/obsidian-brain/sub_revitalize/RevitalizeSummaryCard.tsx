import { MoonStar, Sparkles, RotateCcw, Check } from 'lucide-react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import type { RevitalizeSummary } from '@/api/obsidianBrain';

interface RevitalizeSummaryCardProps {
  summary: RevitalizeSummary;
  vaultName: string | null;
  onRunAgain: () => void;
  onDismiss: () => void;
}

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

/** End-of-pass report: what the sleep cycle changed, in numbers and words. */
export default function RevitalizeSummaryCard({
  summary,
  vaultName,
  onRunAgain,
  onDismiss,
}: RevitalizeSummaryCardProps) {
  const { t, tx } = useTranslation();
  const ob = t.plugins.obsidian_brain;
  const tokensSaved = Math.max(0, summary.estTokensBefore - summary.estTokensAfter);

  const tiles = [
    {
      label: ob.revitalize_stat_deleted,
      value: <Numeric value={summary.filesDeleted} />,
      tone: 'border-red-500/20 bg-red-500/5 text-red-400',
    },
    {
      label: ob.revitalize_stat_merged,
      value: <Numeric value={summary.filesMerged} />,
      tone: 'border-violet-500/20 bg-violet-500/5 text-violet-300',
    },
    {
      label: ob.revitalize_stat_updated,
      value: <Numeric value={summary.filesUpdated} />,
      tone: 'border-cyan-500/20 bg-cyan-500/5 text-cyan-300',
    },
    {
      label: ob.revitalize_stat_reviewed,
      value: <Numeric value={summary.filesReviewed} />,
      tone: 'border-primary/15 bg-secondary/20 text-foreground',
    },
    {
      label: ob.revitalize_stat_tokens_saved,
      value: <Numeric value={tokensSaved} unit="compact" />,
      tone: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400',
    },
    {
      label: ob.revitalize_stat_notes_delta,
      value: (
        <span className="inline-flex items-baseline gap-1.5">
          <Numeric value={summary.notesBefore} />
          <span aria-hidden className="typo-caption text-foreground/90">→</span>
          <Numeric value={summary.notesAfter} />
        </span>
      ),
      tone: 'border-primary/15 bg-secondary/20 text-foreground',
    },
  ];

  return (
    <div className="rounded-modal border border-violet-500/25 bg-violet-500/5 overflow-hidden animate-fade-slide-in">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-violet-500/15">
        <div className="w-10 h-10 rounded-modal border border-violet-500/25 bg-violet-500/10 flex items-center justify-center flex-shrink-0">
          <MoonStar className="w-5 h-5 text-violet-300" />
        </div>
        <div className="min-w-0">
          <h3 className="typo-heading-lg text-violet-200">{ob.revitalize_summary_title}</h3>
          <p className="typo-caption text-foreground/90 truncate">
            {tx(ob.revitalize_summary_vault, {
              name: vaultName ?? '—',
              duration: formatDuration(summary.durationSecs),
            })}
          </p>
        </div>
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* Stat tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {tiles.map((tile) => (
            <div key={tile.label} className={`rounded-card border px-3 py-2.5 ${tile.tone}`}>
              <div className="typo-heading-lg">{tile.value}</div>
              <p className="typo-caption text-foreground/90 mt-0.5">{tile.label}</p>
            </div>
          ))}
        </div>

        {/* Model narrative */}
        {summary.summary && (
          <div>
            <p className="typo-label typo-section-title mb-1.5">{ob.revitalize_model_summary}</p>
            <p className="typo-body text-foreground leading-relaxed">{summary.summary}</p>
          </div>
        )}

        {/* Highlights */}
        {summary.highlights.length > 0 && (
          <div>
            <p className="typo-label typo-section-title mb-1.5">{ob.revitalize_highlights}</p>
            <ul className="space-y-1.5">
              {summary.highlights.map((h, i) => (
                <li key={i} className="flex items-start gap-2 typo-body text-foreground">
                  <Sparkles className="w-3.5 h-3.5 text-violet-400 flex-shrink-0 mt-0.5" />
                  <span className="min-w-0">{h}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={onDismiss}
            className="inline-flex items-center gap-1.5 px-4 py-2 typo-heading rounded-card bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30 transition-colors focus-ring"
          >
            <Check className="w-3.5 h-3.5" />
            {ob.revitalize_done}
          </button>
          <button
            onClick={onRunAgain}
            className="inline-flex items-center gap-1.5 px-4 py-2 typo-heading rounded-card text-foreground border border-primary/15 hover:bg-secondary/40 transition-colors focus-ring"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {ob.revitalize_run_again}
          </button>
        </div>
      </div>
    </div>
  );
}
