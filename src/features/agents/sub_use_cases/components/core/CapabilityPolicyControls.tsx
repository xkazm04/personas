import { useCallback, useMemo, useState } from 'react';
import { Brain, AlertTriangle, Zap, Pencil, ShieldCheck, ShieldOff, ShieldQuestion } from 'lucide-react';
import {
  setUseCaseGenerationSettings,
  type UseCaseGenerationSettings,
} from '@/api/agents/useCases';
import type { DesignUseCase } from '@/lib/types/frontendTypes';
import { useToastStore } from '@/stores/toastStore';
import { useAgentStore } from '@/stores/agentStore';
import { toastCatch } from '@/lib/silentCatch';
import { EventRenameModal } from './EventRenameModal';

type ReviewMode = 'on' | 'off' | 'trust_llm';
type BoolMode = 'on' | 'off';

interface Props {
  personaId: string;
  useCase: DesignUseCase;
  /**
   * Per-persona defaults. Used when a capability has no explicit setting.
   * `memoriesDefault` and `reviewsDefault` reflect whether the persona has
   * any existing memories / reviews — i.e., "is this artifact a thing for
   * this persona at all?". Drives the toggle's initial visual state when the
   * user has never explicitly configured the capability.
   */
  memoriesDefault: boolean;
  reviewsDefault: boolean;
}

/**
 * Phase C5b — inline generation-policy controls for a Use Case Grid card.
 *
 * Three switches (memories, reviews, events) plus an event-rename launcher.
 * Saves immediately on change; the persona session-pool is invalidated by
 * the backend so the next run picks up the new policy + the prompt's
 * "Generation policy for this capability" lines.
 */
export function CapabilityPolicyControls({ personaId, useCase, memoriesDefault, reviewsDefault }: Props) {
  const fetchDetail = useAgentStore((s) => s.fetchDetail);
  const settings: UseCaseGenerationSettings = useMemo(
    () => (useCase.generation_settings ?? {}) as UseCaseGenerationSettings,
    [useCase.generation_settings],
  );

  // Effective values — explicit setting wins, then persona-level default.
  const memoriesValue: BoolMode = settings.memories ?? (memoriesDefault ? 'on' : 'off');
  const reviewsValue: ReviewMode = settings.reviews ?? (reviewsDefault ? 'on' : 'off');
  const eventsValue: BoolMode = settings.events ?? 'on';
  const aliasCount = Object.keys(settings.event_aliases ?? {}).length;

  const [pending, setPending] = useState<null | 'memories' | 'reviews' | 'events'>(null);
  const [renameOpen, setRenameOpen] = useState(false);

  const persist = useCallback(
    async (next: UseCaseGenerationSettings, key: 'memories' | 'reviews' | 'events') => {
      setPending(key);
      try {
        await setUseCaseGenerationSettings(personaId, useCase.id, next);
        useToastStore.getState().addToast(`${capitalize(key)} policy updated`, 'success');
        await fetchDetail(personaId);
      } catch (err) {
        toastCatch('CapabilityPolicyControls:persist')(err);
      } finally {
        setPending(null);
      }
    },
    [personaId, useCase.id, fetchDetail],
  );

  const cycleReviews = useCallback(() => {
    const order: ReviewMode[] = ['on', 'trust_llm', 'off'];
    const next = order[(order.indexOf(reviewsValue) + 1) % order.length] ?? 'on';
    persist({ ...settings, reviews: next }, 'reviews');
  }, [reviewsValue, settings, persist]);

  const toggleMemories = useCallback(() => {
    persist({ ...settings, memories: memoriesValue === 'on' ? 'off' : 'on' }, 'memories');
  }, [memoriesValue, settings, persist]);

  const toggleEvents = useCallback(() => {
    persist({ ...settings, events: eventsValue === 'on' ? 'off' : 'on' }, 'events');
  }, [eventsValue, settings, persist]);

  return (
    <div className="flex items-center gap-1 flex-wrap" onClick={(e) => e.stopPropagation()}>
      <PolicyChip
        icon={<Brain className="w-3 h-3" />}
        label="Mem"
        state={memoriesValue}
        loading={pending === 'memories'}
        onClick={toggleMemories}
        title={
          memoriesValue === 'on'
            ? 'Memories: ON — agent stores learnings under this capability'
            : 'Memories: OFF — agent does not write memory for this capability'
        }
      />
      <ReviewChip value={reviewsValue} loading={pending === 'reviews'} onClick={cycleReviews} />
      <PolicyChip
        icon={<Zap className="w-3 h-3" />}
        label="Evt"
        state={eventsValue}
        loading={pending === 'events'}
        onClick={toggleEvents}
        title={
          eventsValue === 'on'
            ? 'Events: ON — capability publishes events to subscribers'
            : 'Events: OFF — events emitted by the LLM are dropped'
        }
      />
      <button
        onClick={() => setRenameOpen(true)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-primary/15 bg-secondary/30 text-foreground/70 hover:text-primary hover:border-primary/30 transition-colors typo-caption"
        title={
          aliasCount > 0
            ? `Rename emitted events (${aliasCount} alias${aliasCount === 1 ? '' : 'es'} configured)`
            : 'Rename an event this capability emits'
        }
      >
        <Pencil className="w-3 h-3" />
        <span>Rename{aliasCount > 0 ? ` (${aliasCount})` : ''}</span>
      </button>

      {renameOpen && (
        <EventRenameModal
          personaId={personaId}
          useCase={useCase}
          settings={settings}
          onClose={() => setRenameOpen(false)}
          onSaved={async () => {
            await fetchDetail(personaId);
          }}
        />
      )}
    </div>
  );
}

function PolicyChip({
  icon, label, state, loading, onClick, title,
}: {
  icon: React.ReactNode;
  label: string;
  state: BoolMode;
  loading: boolean;
  onClick: () => void;
  title: string;
}) {
  const on = state === 'on';
  return (
    <button
      onClick={onClick}
      disabled={loading}
      title={title}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border typo-caption transition-colors ${
        on
          ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300/90 hover:bg-emerald-500/20'
          : 'bg-secondary/40 border-primary/10 text-foreground/50 hover:text-foreground/80 hover:border-primary/20'
      } ${loading ? 'opacity-50 cursor-wait' : ''}`}
    >
      {icon}
      <span>{label}</span>
      <span className="font-mono opacity-80">{on ? 'on' : 'off'}</span>
    </button>
  );
}

function ReviewChip({ value, loading, onClick }: { value: ReviewMode; loading: boolean; onClick: () => void }) {
  const config: Record<ReviewMode, { icon: React.ReactNode; tone: string; label: string; title: string }> = {
    on: {
      icon: <AlertTriangle className="w-3 h-3" />,
      tone: 'bg-rose-500/10 border-rose-500/25 text-rose-300/90 hover:bg-rose-500/20',
      label: 'queue',
      title: 'Reviews: ON — manual review requests queue for human resolution. Click to cycle.',
    },
    trust_llm: {
      icon: <ShieldCheck className="w-3 h-3" />,
      tone: 'bg-amber-500/10 border-amber-500/25 text-amber-300/90 hover:bg-amber-500/20',
      label: 'trust',
      title: 'Reviews: TRUST_LLM — reviews are stored but auto-resolved (no human queue). Click to cycle.',
    },
    off: {
      icon: <ShieldOff className="w-3 h-3" />,
      tone: 'bg-secondary/40 border-primary/10 text-foreground/50 hover:text-foreground/80 hover:border-primary/20',
      label: 'off',
      title: 'Reviews: OFF — review requests are dropped. Click to cycle.',
    },
  };
  const { icon, tone, label, title } = config[value] ?? config.on;
  return (
    <button
      onClick={onClick}
      disabled={loading}
      title={title}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border typo-caption transition-colors ${tone} ${
        loading ? 'opacity-50 cursor-wait' : ''
      }`}
    >
      {value === 'trust_llm' ? <ShieldQuestion className="w-3 h-3" /> : icon}
      <span>Rev</span>
      <span className="font-mono opacity-80">{label}</span>
    </button>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
