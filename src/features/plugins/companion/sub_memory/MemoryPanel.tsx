import { useCallback, useState } from 'react';
import { Loader2, RefreshCw, Sparkles, TrendingDown } from 'lucide-react';
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
import MemoryPanelVariantA from './MemoryPanelVariantA';
import MemoryPanelVariantB from './MemoryPanelVariantB';

type MemoryView = 'brain' | 'consolidation';

type Variant = 'baseline' | 'a' | 'b';

const VARIANT_TABS: { id: Variant; label: string; subtitle: string }[] = [
  { id: 'baseline', label: 'Baseline', subtitle: 'Today, on master' },
  { id: 'a', label: 'Variant A', subtitle: 'Split rail (left actions, right inspector)' },
  { id: 'b', label: 'Variant B', subtitle: 'Action dashboard (top cards, inspector below)' },
];

/**
 * Memory tab — currently in /prototype mode. A tab strip lets the
 * user A/B between the production baseline and two directional
 * variants. Once a winner is picked, the strip is removed and the
 * winning body replaces this wrapper directly. See
 * MemoryPanelVariantA.tsx / MemoryPanelVariantB.tsx for variant notes.
 */
export default function MemoryPanel() {
  const [variant, setVariant] = useState<Variant>('baseline');
  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      <PrototypeTabs active={variant} onChange={setVariant} />
      <div className="flex-1 min-h-0">
        {variant === 'baseline' && <MemoryPanelBaseline />}
        {variant === 'a' && <MemoryPanelVariantA />}
        {variant === 'b' && <MemoryPanelVariantB />}
      </div>
    </div>
  );
}

function PrototypeTabs({
  active,
  onChange,
}: {
  active: Variant;
  onChange: (v: Variant) => void;
}) {
  return (
    <div className="flex gap-1 p-1 rounded-card border border-foreground/10 bg-secondary/40 shrink-0">
      {VARIANT_TABS.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`flex-1 px-3 py-2 rounded-interactive text-left transition-colors focus-ring ${
              isActive ? 'bg-card-bg shadow-elevation-1' : 'hover:bg-foreground/5'
            }`}
          >
            <div
              className={`typo-body font-medium ${
                isActive ? 'text-foreground' : 'text-foreground/70'
              }`}
            >
              {tab.label}
            </div>
            <div
              className={`typo-caption ${
                isActive ? 'text-foreground/65' : 'text-foreground/45'
              }`}
            >
              {tab.subtitle}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function MemoryPanelBaseline() {
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
      // Jump straight to the new reflection so the result is visible.
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
      <div className="px-4 py-2 border-b border-foreground/10 flex items-center justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <div className="typo-caption font-medium text-foreground/80">
            {t.plugins.companion.memory_bulk_actions_title}
          </div>
          <div className="typo-caption text-foreground/55 hidden sm:block">
            {t.plugins.companion.memory_bulk_actions_desc}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setView('consolidation')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-interactive typo-caption font-medium focus-ring transition-colors ${
              view === 'consolidation'
                ? 'bg-primary text-primary-foreground'
                : 'bg-foreground/5 hover:bg-foreground/10 text-foreground/85'
            }`}
            title={t.plugins.companion.memory_run_consolidation}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">
              {t.plugins.companion.memory_run_consolidation}
            </span>
          </button>
          <button
            onClick={generateReflection}
            disabled={reflecting}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-interactive bg-foreground/5 hover:bg-foreground/10 text-foreground/85 typo-caption font-medium disabled:opacity-50 disabled:cursor-not-allowed focus-ring"
            title={t.plugins.companion.memory_generate_reflection}
          >
            {reflecting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">
              {reflecting
                ? t.plugins.companion.reflection_running
                : t.plugins.companion.memory_generate_reflection}
            </span>
          </button>
          <button
            onClick={decayFacts}
            disabled={decaying}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-interactive bg-foreground/5 hover:bg-foreground/10 text-foreground/85 typo-caption font-medium disabled:opacity-50 disabled:cursor-not-allowed focus-ring"
            title={t.plugins.companion.memory_decay_unused}
          >
            {decaying ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">
              {t.plugins.companion.memory_decay_unused}
            </span>
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {view === 'consolidation' ? (
          <ConsolidationReview onClose={() => setView('brain')} />
        ) : (
          <BrainViewer />
        )}
      </div>
    </div>
  );
}
