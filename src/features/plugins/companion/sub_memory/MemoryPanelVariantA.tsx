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
 * Variant A — "Split rail".
 *
 * The bulk-action toolbar is moved from a thin horizontal strip into
 * a dedicated **left rail** of action cards (icon + label + 1-line
 * description). The brain inspector / consolidation review takes the
 * full width of the right pane. This makes the actions persistently
 * available without competing for header real estate, and gives each
 * action enough room to explain itself.
 *
 * Direction: actions become first-class citizens, inspector becomes
 * the canvas. Trades: more horizontal space spent on chrome, but
 * actions are always one click away regardless of scroll position.
 */
export default function MemoryPanelVariantA() {
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
    <div className="h-full -mx-4 -mb-6 sm:-mx-6 lg:-mx-8 rounded-card overflow-hidden border border-foreground/10 bg-secondary/40 grid grid-cols-[260px_1fr]">
      <aside className="border-r border-foreground/10 bg-card-bg/40 p-3 flex flex-col gap-2 overflow-y-auto">
        <div className="px-1 pb-2 mb-1 border-b border-foreground/5">
          <div className="typo-label text-foreground/55">
            {t.plugins.companion.memory_bulk_actions_title}
          </div>
          <div className="typo-caption text-foreground/55 mt-0.5 leading-snug">
            {t.plugins.companion.memory_bulk_actions_desc}
          </div>
        </div>

        {/* prototype-only descriptions — re-extract to en.json before consolidation */}
        <ActionCard
          icon={<Brain className="w-4 h-4" />}
          label="Inspect brain"
          description="Browse facts, reflections, and edges."
          active={view === 'brain'}
          onClick={() => setView('brain')}
        />

        <ActionCard
          icon={<RefreshCw className="w-4 h-4" />}
          label={t.plugins.companion.memory_run_consolidation}
          description="Review proposals from the latest consolidation pass."
          active={view === 'consolidation'}
          onClick={() => setView('consolidation')}
        />

        <ActionCard
          icon={
            reflecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />
          }
          label={
            reflecting
              ? t.plugins.companion.reflection_running
              : t.plugins.companion.memory_generate_reflection
          }
          description="Synthesize today's interactions into a reflection."
          onClick={generateReflection}
          disabled={reflecting}
        />

        <ActionCard
          icon={
            decaying ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingDown className="w-4 h-4" />
          }
          label={t.plugins.companion.memory_decay_unused}
          description="Lower confidence on facts that have not been used recently."
          onClick={decayFacts}
          disabled={decaying}
          tone="muted"
        />
      </aside>

      <div className="min-h-0 overflow-hidden">
        {view === 'consolidation' ? (
          <ConsolidationReview onClose={() => setView('brain')} />
        ) : (
          <BrainViewer />
        )}
      </div>
    </div>
  );
}

function ActionCard({
  icon,
  label,
  description,
  active,
  disabled,
  onClick,
  tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  tone?: 'default' | 'muted';
}) {
  const base = active
    ? 'border-primary/40 bg-primary/10 text-foreground'
    : tone === 'muted'
      ? 'border-foreground/8 bg-secondary/30 hover:bg-secondary/50 text-foreground/80'
      : 'border-foreground/10 bg-secondary/50 hover:bg-secondary/70 text-foreground';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-left rounded-card border px-3 py-2.5 transition-colors focus-ring disabled:opacity-50 disabled:cursor-not-allowed ${base}`}
    >
      <div className="flex items-center gap-2">
        <span className={active ? 'text-primary' : 'text-foreground/65'}>{icon}</span>
        <span className="typo-body font-medium truncate">{label}</span>
      </div>
      <div className="typo-caption text-foreground/55 mt-1 leading-snug">{description}</div>
    </button>
  );
}
