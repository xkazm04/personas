import { Brain, Zap, ShieldCheck, ShieldOff, AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { usePolicyControls, type ReviewMode } from './usePolicyControls';
import type { DisplayUseCase } from './displayUseCase';

interface TilePolicyTogglesProps {
  personaId: string;
  uc: DisplayUseCase;
  memoriesDefault: boolean;
  reviewsDefault: boolean;
}

/**
 * Compact icon-only policy toggles for the SigilGrid tile right edge.
 * Three buttons stacked vertically: memory / review (3-state) / events.
 * Persistence is via the shared `usePolicyControls` hook so changes
 * propagate to the detail view's in-card toggles automatically.
 */
export function TilePolicyToggles({ personaId, uc, memoriesDefault, reviewsDefault }: TilePolicyTogglesProps) {
  const {
    memoriesValue, reviewsValue, eventsValue, pending,
    toggleMemories, toggleEvents, cycleReviews,
  } = usePolicyControls({ personaId, uc, memoriesDefault, reviewsDefault });

  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
      <BoolToggle
        on={memoriesValue === 'on'}
        loading={pending === 'memories'}
        onClick={toggleMemories}
        title={
          memoriesValue === 'on'
            ? t.agents.use_cases.memories_on_title
            : t.agents.use_cases.memories_off_title
        }
        icon={<Brain className="w-3 h-3" />}
      />
      <ReviewToggle value={reviewsValue} loading={pending === 'reviews'} onClick={cycleReviews} />
      <BoolToggle
        on={eventsValue === 'on'}
        loading={pending === 'events'}
        onClick={toggleEvents}
        title={
          eventsValue === 'on'
            ? t.agents.use_cases.events_on_title
            : t.agents.use_cases.events_off_title
        }
        icon={<Zap className="w-3 h-3" />}
      />
    </div>
  );
}

interface BoolToggleProps {
  on: boolean;
  loading: boolean;
  onClick: () => void;
  title: string;
  icon: React.ReactNode;
}

function BoolToggle({ on, loading, onClick, title, icon }: BoolToggleProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      title={title}
      className={`inline-flex items-center justify-center w-6 h-6 rounded-full border transition-colors cursor-pointer disabled:cursor-wait ${
        on
          ? 'bg-status-success/12 border-status-success/35 text-status-success/95 hover:bg-status-success/20'
          : 'bg-secondary/60 border-card-border text-foreground/55 hover:text-foreground/85 hover:border-foreground/30'
      } ${loading ? 'opacity-50' : ''}`}
    >
      {icon}
    </button>
  );
}

interface ReviewToggleProps {
  value: ReviewMode;
  loading: boolean;
  onClick: () => void;
}

function ReviewToggle({ value, loading, onClick }: ReviewToggleProps) {
  const { t } = useTranslation();
  const config: Record<ReviewMode, { icon: React.ReactNode; cls: string; title: string }> = {
    on: {
      icon: <AlertTriangle className="w-3 h-3" />,
      cls: 'bg-status-error/12 border-status-error/35 text-status-error/95 hover:bg-status-error/20',
      title: t.agents.use_cases.review_on_title,
    },
    trust_llm: {
      icon: <ShieldCheck className="w-3 h-3" />,
      cls: 'bg-status-warning/12 border-status-warning/35 text-status-warning/95 hover:bg-status-warning/20',
      title: t.agents.use_cases.review_trust_title,
    },
    off: {
      icon: <ShieldOff className="w-3 h-3" />,
      cls: 'bg-secondary/60 border-card-border text-foreground/55 hover:text-foreground/85 hover:border-foreground/30',
      title: t.agents.use_cases.review_off_title,
    },
  };
  const { icon, cls, title } = config[value] ?? config.on;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      title={title}
      className={`inline-flex items-center justify-center w-6 h-6 rounded-full border transition-colors cursor-pointer disabled:cursor-wait ${cls} ${
        loading ? 'opacity-50' : ''
      }`}
    >
      {icon}
    </button>
  );
}
