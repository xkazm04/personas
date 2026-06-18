import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Power, Play, FlaskConical, AlertTriangle,
  Calendar, UserCheck, Brain, Activity, Pencil,
  ListTodo, AlertOctagon, Cpu, ShieldCheck, ShieldOff,
} from 'lucide-react';
import { DIM_META } from '@/features/shared/glyph/dimMeta';
import type { GlyphDimension } from '@/features/shared/glyph';
import type { CredentialMetadata } from '@/lib/types/types';
import { UseCaseHistory } from '@/features/agents/sub_lab/use-cases/UseCaseHistory';
import { useAgentStore } from '@/stores/agentStore';
import { useTranslation } from '@/i18n/useTranslation';
import { EventRenameModal } from '../../core/EventRenameModal';
import { UseCaseDetailPanel } from '../../detail/UseCaseDetailPanel';
import { getHealthMeta, getModeMeta, getDimLabels, type DisplayUseCase } from './displayUseCase';
import { MiniSigil } from './MiniSigil';
import { usePolicyControls, type ReviewMode } from './usePolicyControls';
import { ConnectorDimCard } from './ConnectorDimCard';
import { NotificationsDimCard } from './NotificationsDimCard';

interface UseCaseDetailExpandedProps {
  uc: DisplayUseCase;
  personaId: string;
  credentials: CredentialMetadata[];
  memoriesDefault: boolean;
  reviewsDefault: boolean;
  isExecuting: boolean;
  isThisExecuting: boolean;
  pendingToggleId: string | null;
  historyRefreshKey: number;
  onBack: () => void;
  onToggle: () => void;
  onRun: () => void;
  onSimulate: () => void;
  onRerun: (inputData: string) => void;
}

/**
 * Level-2 detail view for SigilGrid.
 *
 * Layout:
 *   ┌── back · title · state · mode  · · ·  Rename · Pause · Run · Simulate ──┐
 *   │ ┌─attention banner if needs-attention──────────────────────────────────┐│
 *   │ │ Two columns:                                                         ││
 *   │ │   left:  large sigil (wedge style, active)                           ││
 *   │ │   right: dim cards — Memory/Review/Event toggle policy in place,    ││
 *   │ │          Connector re-binds the persona's credential, Notifications  ││
 *   │ │          toggles channel types; the rest are read-only displays.     ││
 *   │ ├ Tabs: History · Config ─────────────────────────────────────────────┤│
 *   └─────────────────────────────────────────────────────────────────────────┘
 */
export function UseCaseDetailExpanded({
  uc, personaId, credentials,
  memoriesDefault, reviewsDefault,
  isExecuting, isThisExecuting, pendingToggleId, historyRefreshKey,
  onBack, onToggle, onRun, onSimulate, onRerun,
}: UseCaseDetailExpandedProps) {
  const [tab, setTab] = useState<'history' | 'config'>('history');
  const [renameOpen, setRenameOpen] = useState(false);
  const fetchDetail = useAgentStore((s) => s.fetchDetail);
  const { t, tx } = useTranslation();

  const policy = usePolicyControls({ personaId, uc, memoriesDefault, reviewsDefault });

  const healthMeta = getHealthMeta(t);
  const modeMeta = getModeMeta(t);
  const dimLabels = getDimLabels(t);

  const health = healthMeta[uc.health];
  const HealthIcon = health.icon;
  const isDisabled = uc.health === 'disabled';
  const isPending = pendingToggleId === uc.id;
  const runDisabled = isDisabled || uc.mode === 'non_executable' || (isExecuting && !isThisExecuting);
  const simulateDisabled = uc.mode === 'non_executable' || (isExecuting && !isThisExecuting);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="flex flex-col h-full"
    >
      {/* Header bar */}
      <div className="flex items-start gap-3 px-1 pb-3 flex-shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-full border border-card-border bg-secondary/40 text-foreground hover:text-foreground hover:border-primary/40 cursor-pointer transition-colors"
          title={t.agents.use_cases.back_to_grid}
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="typo-section-title text-foreground">{uc.title}</span>
            <span className={`typo-label px-1.5 py-0.5 rounded border inline-flex items-center gap-1 ${health.toneText} ${health.toneBg} ${health.toneBorder}`}>
              {HealthIcon && <HealthIcon className="w-3 h-3" />}
              {health.label}
            </span>
            <span className={`typo-label px-1.5 py-0.5 rounded border ${modeMeta[uc.mode].tone}`}>
              {modeMeta[uc.mode].label}
            </span>
          </div>
          <div className="typo-caption text-foreground mt-0.5">{uc.description}</div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Rename event aliases — sits left of Pause */}
          <button
            type="button"
            onClick={() => setRenameOpen(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-interactive border border-card-border bg-secondary/50 text-foreground/85 hover:border-primary/40 hover:text-primary typo-caption cursor-pointer transition-colors"
            title={
              policy.aliasCount > 0
                ? tx(t.agents.use_cases.rename_event_tooltip_count, { count: policy.aliasCount })
                : t.agents.use_cases.rename_event_tooltip_empty
            }
          >
            <Pencil className="w-3 h-3" />
            <span>
              {policy.aliasCount > 0
                ? tx(t.agents.use_cases.rename_with_count, { count: policy.aliasCount })
                : t.agents.use_cases.rename_label}
            </span>
          </button>
          <button
            type="button"
            onClick={onToggle}
            disabled={isPending}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-interactive border typo-caption cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              isDisabled
                ? 'border-status-success/30 bg-status-success/10 text-status-success hover:bg-status-success/20'
                : 'border-card-border bg-secondary/50 text-foreground/85 hover:border-foreground/40'
            }`}
            title={isDisabled ? t.agents.use_cases.activate_label : t.agents.use_cases.pause_label}
          >
            <Power className="w-3 h-3" /> {isDisabled ? t.agents.use_cases.activate_label : t.agents.use_cases.pause_label}
          </button>
          <button
            type="button"
            onClick={onRun}
            disabled={runDisabled}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-interactive border typo-caption cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              isThisExecuting
                ? 'border-status-info/45 bg-status-info/15 text-status-info'
                : 'border-card-border bg-secondary/50 text-foreground/85 hover:border-status-info/40 hover:text-status-info'
            }`}
            title={tx(t.agents.use_cases.run_title_detail, { title: uc.title })}
          >
            {isThisExecuting ? (
              <span className="relative flex h-3 w-3 items-center justify-center" aria-hidden>
                <span className="animate-ping absolute h-full w-full rounded-full bg-status-info opacity-50" />
                <span className="relative rounded-full h-1.5 w-1.5 bg-status-info" />
              </span>
            ) : (
              <Play className="w-3 h-3" />
            )}
            {t.agents.use_cases.run_label}
          </button>
          <button
            type="button"
            onClick={onSimulate}
            disabled={simulateDisabled}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-interactive border typo-caption cursor-pointer transition-colors border-status-warning/30 bg-status-warning/10 text-status-warning/90 hover:bg-status-warning/20 disabled:opacity-40 disabled:cursor-not-allowed"
            title={t.agents.use_cases.simulate_tooltip}
          >
            <FlaskConical className="w-3 h-3" /> {t.agents.use_cases.simulate_label}
          </button>
        </div>
      </div>

      {/* Attention banner */}
      {uc.attentionReason && (
        <div className="mb-3 mx-1 px-3 py-2 rounded-card border border-status-warning/30 bg-status-warning/10 inline-flex items-start gap-2 flex-shrink-0">
          <AlertTriangle className="w-4 h-4 text-status-warning mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="typo-label uppercase tracking-wider text-status-warning">{t.agents.use_cases.needs_attention_label}</div>
            <div className="typo-caption text-foreground/85 mt-0.5">{uc.attentionReason}</div>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4 px-1 pb-3">
          {/* Sigil column */}
          <div className="rounded-card border border-card-border bg-secondary/30 p-4 flex flex-col items-center justify-center">
            <motion.div className="relative" layoutId={`sigil-${uc.id}`} transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}>
              <MiniSigil uc={uc} size={228} isActive petalStyle="wedge" />
            </motion.div>
            <div className="typo-label uppercase tracking-wider text-foreground mt-3">
              {tx(t.agents.use_cases.dimensions_of_eight, { count: uc.dimensions.length })}
            </div>
            <div className="flex flex-wrap gap-1 justify-center mt-2 max-w-[200px]">
              {uc.dimensions.map((d) => (
                <span
                  key={d}
                  className="typo-label px-1.5 py-0.5 rounded border"
                  style={{
                    color: DIM_META[d].color,
                    borderColor: DIM_META[d].color + '55',
                    background: DIM_META[d].color + '14',
                  }}
                >
                  {dimLabels[d]}
                </span>
              ))}
            </div>
          </div>

          {/* Dimension cards. Memory/Review/Event/Connector/Notifications
              are interactive — clicking opens a picker or toggles state.
              Trigger/Capability/Error remain read-only displays. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 content-start">
            <DimCard dim="trigger"   title={t.agents.use_cases.dim_trigger_title}   body={uc.triggerLabel} icon={Calendar} active={uc.dimensions.includes('trigger')} />
            <ConnectorDimCard uc={uc} personaId={personaId} credentials={credentials} />
            <NotificationsDimCard uc={uc} personaId={personaId} />
            <DimCard dim="task" title={t.agents.use_cases.dim_capability_title} body={uc.category?.replace(/-/g, ' ') ?? t.agents.use_cases.dim_generic_task} icon={ListTodo} active />

            {/* Toggle dim cards */}
            <ToggleDimCard
              dim="memory"
              title={t.agents.use_cases.dim_memory_title}
              icon={Brain}
              state={policy.memoriesValue}
              loading={policy.pending === 'memories'}
              onClick={policy.toggleMemories}
              bodyOn={t.agents.use_cases.memory_body_on}
              bodyOff={memoriesDefault ? t.agents.use_cases.memory_body_off_inherited : t.agents.use_cases.memory_body_off_stateless}
            />
            <ReviewDimCard
              state={policy.reviewsValue}
              loading={policy.pending === 'reviews'}
              onClick={policy.cycleReviews}
              reviewsDefault={reviewsDefault}
            />
            <ToggleDimCard
              dim="event"
              title={t.agents.use_cases.dim_events_title}
              icon={Activity}
              state={policy.eventsValue}
              loading={policy.pending === 'events'}
              onClick={policy.toggleEvents}
              bodyOn={t.agents.use_cases.events_body_on}
              bodyOff={t.agents.use_cases.events_body_off}
            />
            <DimCard dim="error" title={t.agents.use_cases.dim_error_title} body={uc.attentionReason ?? t.agents.use_cases.dim_default_policy} icon={AlertOctagon} active={!!uc.attentionReason} tone={uc.attentionReason ? 'warning' : undefined} />

            {uc.hasModelOverride && (
              <DimCard dim="task" title={t.agents.use_cases.dim_model_override_title} body={t.agents.use_cases.dim_model_override_body} icon={Cpu} active activeColor="#a78bfa" />
            )}
          </div>
        </div>

        {/* Tabs: History · Config */}
        <div className="mt-1 mx-1 rounded-card border border-card-border bg-secondary/30 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-card-border/60">
            <div className="flex items-center gap-1 rounded-card bg-secondary/60 border border-card-border/50 p-0.5">
              {(['history', 'config'] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`px-2.5 py-1 rounded-input typo-caption transition-colors cursor-pointer ${
                    tab === id ? 'bg-primary/15 text-primary' : 'text-foreground hover:text-foreground'
                  }`}
                >
                  {id === 'history' ? t.agents.use_cases.tab_history : t.agents.use_cases.tab_config}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-[40vh] overflow-y-auto">
            <AnimatePresence mode="wait" initial={false}>
              {tab === 'history' ? (
                <motion.div
                  key="history"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.14 }}
                >
                  <UseCaseHistory
                    personaId={personaId}
                    useCaseId={uc.id}
                    onRerun={onRerun}
                    refreshKey={historyRefreshKey}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="config"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.14 }}
                  className="p-3"
                >
                  <UseCaseDetailPanel useCaseId={uc.id} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {renameOpen && (
        <EventRenameModal
          personaId={personaId}
          useCase={uc.raw}
          settings={policy.settings}
          onClose={() => setRenameOpen(false)}
          onSaved={async () => { await fetchDetail(personaId); }}
        />
      )}
    </motion.div>
  );
}

interface DimCardProps {
  dim: GlyphDimension;
  title: string;
  body: string;
  icon: typeof Calendar;
  active: boolean;
  tone?: 'warning';
  activeColor?: string;
}

function DimCard({ dim, title, body, icon: Icon, active, tone, activeColor }: DimCardProps) {
  const color = activeColor ?? DIM_META[dim].color;
  const isWarn = tone === 'warning';
  return (
    <div
      className={`rounded-card border bg-secondary/30 px-3 py-2 transition-opacity ${
        active ? 'border-card-border opacity-100' : 'border-border/30 opacity-55'
      } ${isWarn ? 'border-status-warning/40 bg-status-warning/8' : ''}`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className="flex items-center justify-center rounded"
          style={{
            width: 18, height: 18,
            background: active ? `${color}1f` : 'rgba(148,163,184,0.12)',
            border: `1px solid ${active ? color + '55' : 'rgba(148,163,184,0.25)'}`,
          }}
        >
          <Icon className="w-3 h-3" style={{ color: active ? color : '#94a3b8' }} />
        </span>
        <span className="typo-label uppercase tracking-wider text-foreground">{title}</span>
      </div>
      <div className="typo-caption text-foreground/85 leading-snug">{body}</div>
    </div>
  );
}

interface ToggleDimCardProps {
  dim: GlyphDimension;
  title: string;
  icon: typeof Calendar;
  state: 'on' | 'off';
  loading: boolean;
  onClick: () => void;
  bodyOn: string;
  bodyOff: string;
}

/**
 * Boolean-state dim card with an inline toggle pill in the top-right.
 * Click target is the whole card *and* the explicit pill (the pill carries
 * a clear `aria-pressed` state for assistive tech). Used for Memory and
 * Events; Review uses `ReviewDimCard` (3-state cycle).
 */
function ToggleDimCard({ dim, title, icon: Icon, state, loading, onClick, bodyOn, bodyOff }: ToggleDimCardProps) {
  const { t } = useTranslation();
  const color = DIM_META[dim].color;
  const on = state === 'on';
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      disabled={loading}
      className={`text-left rounded-card border bg-secondary/30 px-3 py-2 transition-all cursor-pointer disabled:cursor-wait ${
        on ? 'border-card-border opacity-100 hover:border-status-success/40' : 'border-border/30 opacity-70 hover:border-foreground/30 hover:opacity-95'
      }`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className="flex items-center justify-center rounded"
          style={{
            width: 18, height: 18,
            background: on ? `${color}1f` : 'rgba(148,163,184,0.12)',
            border: `1px solid ${on ? color + '55' : 'rgba(148,163,184,0.25)'}`,
          }}
        >
          <Icon className="w-3 h-3" style={{ color: on ? color : '#94a3b8' }} />
        </span>
        <span className="typo-label uppercase tracking-wider text-foreground">{title}</span>
        <span
          className={`ml-auto typo-label uppercase tracking-wider px-1.5 py-0.5 rounded border ${
            on
              ? 'bg-status-success/15 border-status-success/35 text-status-success/95'
              : 'bg-secondary/60 border-card-border text-foreground'
          } ${loading ? 'opacity-50' : ''}`}
          aria-pressed={on}
        >
          {on ? t.agents.use_cases.pill_on : t.agents.use_cases.pill_off}
        </span>
      </div>
      <div className="typo-caption text-foreground/85 leading-snug">
        {on ? bodyOn : bodyOff}
      </div>
    </button>
  );
}

interface ReviewDimCardProps {
  state: ReviewMode;
  loading: boolean;
  onClick: () => void;
  reviewsDefault: boolean;
}

function ReviewDimCard({ state, loading, onClick, reviewsDefault }: ReviewDimCardProps) {
  const { t } = useTranslation();
  const color = DIM_META.review.color;
  const config: Record<ReviewMode, { label: string; pill: string; icon: React.ReactNode; body: string }> = {
    on: {
      label: t.agents.use_cases.review_pill_queue,
      pill: 'bg-status-error/15 border-status-error/35 text-status-error/95',
      icon: <AlertTriangle className="w-2.5 h-2.5" />,
      body: t.agents.use_cases.review_queue_body,
    },
    trust_llm: {
      label: t.agents.use_cases.review_pill_trust,
      pill: 'bg-status-warning/15 border-status-warning/35 text-status-warning/95',
      icon: <ShieldCheck className="w-2.5 h-2.5" />,
      body: t.agents.use_cases.review_trust_body,
    },
    off: {
      label: t.agents.use_cases.pill_off,
      pill: 'bg-secondary/60 border-card-border text-foreground',
      icon: <ShieldOff className="w-2.5 h-2.5" />,
      body: reviewsDefault ? t.agents.use_cases.review_off_body_inherited : t.agents.use_cases.review_off_body_dropped,
    },
  };
  const s = config[state] ?? config.on;
  const isOn = state !== 'off';
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      disabled={loading}
      title={t.agents.use_cases.review_cycle_tooltip}
      className={`text-left rounded-card border bg-secondary/30 px-3 py-2 transition-all cursor-pointer disabled:cursor-wait ${
        isOn ? 'border-card-border opacity-100 hover:border-foreground/40' : 'border-border/30 opacity-70 hover:opacity-95'
      }`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className="flex items-center justify-center rounded"
          style={{
            width: 18, height: 18,
            background: isOn ? `${color}1f` : 'rgba(148,163,184,0.12)',
            border: `1px solid ${isOn ? color + '55' : 'rgba(148,163,184,0.25)'}`,
          }}
        >
          <UserCheck className="w-3 h-3" style={{ color: isOn ? color : '#94a3b8' }} />
        </span>
        <span className="typo-label uppercase tracking-wider text-foreground">{t.agents.use_cases.dim_review_title}</span>
        <span
          className={`ml-auto inline-flex items-center gap-1 typo-label uppercase tracking-wider px-1.5 py-0.5 rounded border ${s.pill} ${
            loading ? 'opacity-50' : ''
          }`}
        >
          {s.icon}
          {s.label}
        </span>
      </div>
      <div className="typo-caption text-foreground/85 leading-snug">
        {s.body}
      </div>
    </button>
  );
}

export type { ReviewMode };
