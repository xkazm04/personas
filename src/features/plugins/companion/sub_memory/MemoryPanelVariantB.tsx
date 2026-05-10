import { useCallback, useState } from 'react';
import { Brain, Loader2, RefreshCw, Sparkles, TrendingDown } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { silentCatch } from '@/lib/silentCatch';
import {
  companionDecayUnusedFacts,
  companionRunReflection,
} from '@/api/companion';
import { BrainViewer } from '../BrainViewer';
import { useCompanionStore } from '../companionStore';
import { ConsolidationReview } from './ConsolidationReview';

type MemoryView = 'brain' | 'consolidation';

/**
 * Variant B — "Action dashboard".
 *
 * The bulk-action toolbar fans out into a top row of full-width
 * action cards (each with icon, label, short rationale, and explicit
 * call-to-action button). The brain inspector / consolidation review
 * sits below them, taking the rest of the height. This makes the
 * three maintenance passes feel like equal-weight choices presented
 * up front, instead of a thin strip of icon-buttons that compete for
 * attention with the inspector.
 *
 * Direction: actions become a dashboard of next-best-moves. Trades:
 * eats more vertical space than the strip, but each action is fully
 * self-explanatory without a tooltip.
 */
export default function MemoryPanelVariantB() {
  const { t } = useTranslation();
  const [view, setView] = useState<MemoryView>('brain');
  const [reflecting, setReflecting] = useState(false);
  const [decaying, setDecaying] = useState(false);
  const setBrainView = useCompanionStore((s) => s.setBrainView);
  const addToast = useToastStore((s) => s.addToast);

  const generateReflection = useCallback(async () => {
    setReflecting(true);
    try {
      const id = await companionRunReflection();
      addToast(t.plugins.companion.reflections, 'success');
      setBrainView({ open: true, kind: 'reflection', id });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast(`${t.plugins.companion.reflection_failed}: ${msg}`, 'error');
      silentCatch('companion_run_reflection')(err);
    } finally {
      setReflecting(false);
    }
  }, [addToast, setBrainView, t]);

  const decayFacts = useCallback(async () => {
    setDecaying(true);
    try {
      const n = await companionDecayUnusedFacts();
      addToast(
        n === 0
          ? t.plugins.companion.decay_none
          : `${n} ${t.plugins.companion.decay_done.replace('{{count}}', String(n)).replace(/^\d+\s+/, '')}`,
        'success',
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast(msg, 'error');
      silentCatch('companion_decay_unused_facts')(err);
    } finally {
      setDecaying(false);
    }
  }, [addToast, t]);

  return (
    <div className="h-full -mx-4 -mb-6 sm:-mx-6 lg:-mx-8 rounded-card overflow-hidden border border-foreground/10 bg-secondary/40 flex flex-col">
      <div className="px-4 pt-4 pb-3 border-b border-foreground/10 shrink-0">
        <div className="typo-section-title">
          {t.plugins.companion.memory_bulk_actions_title}
        </div>
        <div className="typo-caption text-foreground/60 mt-0.5">
          {t.plugins.companion.memory_bulk_actions_desc}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3">
          {/* prototype-only descriptions — re-extract to en.json before consolidation */}
          <DashboardCard
            tint="cyan"
            icon={<RefreshCw className="w-5 h-5" />}
            title={t.plugins.companion.memory_run_consolidation}
            description="Group similar facts and surface proposals to merge or drop."
            ctaLabel="Open review"
            onClick={() => setView('consolidation')}
            active={view === 'consolidation'}
          />
          <DashboardCard
            tint="violet"
            icon={
              reflecting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />
            }
            title={
              reflecting
                ? t.plugins.companion.reflection_running
                : t.plugins.companion.memory_generate_reflection
            }
            description="Synthesize the day's interactions into a reflection."
            ctaLabel={reflecting ? '…' : 'Run now'}
            onClick={generateReflection}
            disabled={reflecting}
          />
          <DashboardCard
            tint="amber"
            icon={
              decaying ? <Loader2 className="w-5 h-5 animate-spin" /> : <TrendingDown className="w-5 h-5" />
            }
            title={t.plugins.companion.memory_decay_unused}
            description="Lower confidence on facts that have not been read recently."
            ctaLabel={decaying ? '…' : 'Run decay'}
            onClick={decayFacts}
            disabled={decaying}
          />
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <div className="px-4 py-2 border-b border-foreground/5 flex items-center gap-2 bg-card-bg/40">
          <Brain className="w-3.5 h-3.5 text-primary" />
          <div className="typo-caption font-medium text-foreground/75">
            {view === 'consolidation'
              ? t.plugins.companion.memory_run_consolidation
              : 'Brain inspector'}
          </div>
        </div>
        {view === 'consolidation' ? (
          <ConsolidationReview onClose={() => setView('brain')} />
        ) : (
          <BrainViewer />
        )}
      </div>
    </div>
  );
}

function DashboardCard({
  tint,
  icon,
  title,
  description,
  ctaLabel,
  active,
  disabled,
  onClick,
}: {
  tint: 'cyan' | 'violet' | 'amber';
  icon: React.ReactNode;
  title: string;
  description: string;
  ctaLabel: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const tintClasses: Record<typeof tint, string> = {
    cyan: 'border-cyan-500/30 bg-cyan-500/5 text-cyan-300',
    violet: 'border-violet-500/30 bg-violet-500/5 text-violet-300',
    amber: 'border-amber-500/30 bg-amber-500/5 text-amber-300',
  };
  const activeClasses = active ? 'ring-1 ring-primary/40 bg-primary/10' : '';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-left rounded-card border bg-secondary/40 hover:bg-secondary/60 transition-colors p-3 focus-ring disabled:opacity-50 disabled:cursor-not-allowed flex flex-col gap-2 ${activeClasses}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-card border ${tintClasses[tint]}`}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <div className="typo-body font-medium truncate">{title}</div>
        </div>
      </div>
      <div className="typo-caption text-foreground/60 leading-snug">{description}</div>
      <div className="mt-auto flex items-center justify-between pt-1">
        <span className="typo-caption text-foreground/45">
          {active ? 'Open' : ' '}
        </span>
        <span className="typo-caption font-medium text-primary">{ctaLabel} →</span>
      </div>
    </button>
  );
}
