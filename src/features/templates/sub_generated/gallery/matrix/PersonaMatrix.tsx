import { useMemo } from 'react';
import { deriveArchCategories, type ArchCategory } from './architecturalCategories';
import {
  UseCasesIcon, ConnectorsIcon, TriggersIcon, HumanReviewIcon,
  MessagesIcon, MemoryIcon, ErrorsIcon, EventsIcon,
} from './MatrixIcons';
import type { AgentIR, SuggestedTrigger, SuggestedEventSubscription, ProtocolCapability } from '@/lib/types/designTypes';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import type { CredentialMetadata } from '@/lib/types/types';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import type { RequiredConnector } from '../../adoption/steps/connect/ConnectStep';
import type { MatrixEditState, MatrixEditCallbacks } from './EditableMatrixCells';
import { ConnectorEditCell, TriggerEditCell, ReviewEditCell, MemoryEditCell, MessagesEditCell } from './EditableMatrixCells';
import { MatrixCommandCenter } from './MatrixCommandCenter';

/** @deprecated Single theme — kept for backward compatibility */
export type MatrixTheme = 'neon';
/** @deprecated */
export type MatrixLayout = 'orbit';

interface MatrixCell {
  key: string;
  label: string;
  watermark: React.ComponentType<{ className?: string }>;
  watermarkColor: string;
  render: () => React.ReactNode;
  editRender?: () => React.ReactNode;
}

interface PersonaMatrixBaseProps {
  designResult: AgentIR | null;
  flows?: UseCaseFlow[];
  hideHeader?: boolean;
  /** @deprecated Ignored */ theme?: MatrixTheme;
  /** @deprecated Ignored */ layout?: MatrixLayout;
  onLaunch?: () => void;
  launchDisabled?: boolean;
  launchLabel?: string;
  isRunning?: boolean;
  onNavigateCatalog?: () => void;
  /** Lock all interactive grid cells to view mode during build */
  buildLocked?: boolean;
  /** CLI questions during build */
  questions?: TransformQuestionResponse[] | null;
  /** Current user answers */
  userAnswers?: Record<string, string>;
  /** Question answer changed */
  onAnswerUpdated?: (questionId: string, answer: string) => void;
  /** Submit answers and continue build */
  onSubmitAnswers?: () => void;
  /** Whether build is completed (draft available) */
  buildCompleted?: boolean;
  /** User-facing build phase label */
  phaseLabel?: string;
}

interface PersonaMatrixViewProps extends PersonaMatrixBaseProps { mode?: 'view'; }
interface PersonaMatrixEditProps extends PersonaMatrixBaseProps {
  mode: 'edit';
  editState: MatrixEditState;
  editCallbacks: MatrixEditCallbacks;
  requiredConnectors: RequiredConnector[];
  credentials: CredentialMetadata[];
}

export type PersonaMatrixProps = PersonaMatrixViewProps | PersonaMatrixEditProps;

// ── Extraction helpers ───────────────────────────────────────────────

function describeCron(cron: string): string {
  const p = cron.trim().split(/\s+/);
  if (p.length < 5) return cron;
  const [min, hour, , , dow] = p as [string, string, string, string, string];
  if (min === '*' && hour === '*') return 'Every minute';
  if (min !== '*' && hour === '*') return `Every hour at :${min.padStart(2, '0')}`;
  if (min === '0' && hour === '0') return 'Daily at midnight';
  if (min === '0' && /^\d+$/.test(hour)) return `Daily at ${hour}:00`;
  if (min === '*/5') return 'Every 5 minutes';
  if (min === '*/10') return 'Every 10 minutes';
  if (min === '*/15') return 'Every 15 minutes';
  if (min === '*/30') return 'Every 30 minutes';
  if (dow === '1-5') return `Weekdays at ${hour}:${min.padStart(2, '0')}`;
  return cron;
}

function extractTriggers(triggers: SuggestedTrigger[]): { type: string; label: string }[] {
  return triggers.map((t) => {
    const cfg = t.config as Record<string, unknown> | undefined;
    if (t.trigger_type === 'schedule' && cfg) {
      const cron = typeof cfg.cron === 'string' ? cfg.cron : null;
      if (cron) return { type: t.trigger_type, label: describeCron(cron) };
      const interval = cfg.interval ?? cfg.every ?? cfg.frequency;
      if (typeof interval === 'string') return { type: t.trigger_type, label: `Every ${interval}` };
      if (typeof interval === 'number') return { type: t.trigger_type, label: `Every ${interval}m` };
    }
    if (t.trigger_type === 'polling' && cfg) {
      const interval = cfg.interval ?? cfg.every ?? cfg.frequency ?? cfg.poll_interval;
      if (typeof interval === 'string') return { type: t.trigger_type, label: `Poll every ${interval}` };
      if (typeof interval === 'number') return { type: t.trigger_type, label: `Poll every ${interval}m` };
    }
    if (t.description.length > 3 && t.description.length <= 45) return { type: t.trigger_type, label: t.description };
    return { type: t.trigger_type, label: TRIGGER_LABELS[t.trigger_type] ?? t.trigger_type };
  });
}

function extractHumanReview(capabilities: ProtocolCapability[] | undefined) {
  const review = capabilities?.find((c) => c.type === 'manual_review');
  if (!review) return { level: 'none' as const, label: 'Autonomous', context: 'No human approval gates' };
  const ctx = review.context?.toLowerCase() ?? '';
  if (ctx.includes('always') || ctx.includes('required'))
    return { level: 'required' as const, label: 'Required', context: review.context || 'Approval before every action' };
  return { level: 'optional' as const, label: 'Conditional', context: review.context || 'Review on flagged items' };
}

function extractMemory(capabilities: ProtocolCapability[] | undefined) {
  const memory = capabilities?.find((c) => c.type === 'agent_memory');
  if (!memory) return { active: false, label: 'Stateless', context: 'No cross-run memory' };
  return { active: true, label: 'Persistent', context: memory.context || 'Retains context across runs' };
}

function extractErrorStrategies(errorHandling: string): string[] {
  if (!errorHandling) return ['Default error handling'];
  const s: string[] = [];
  const t = errorHandling.toLowerCase();
  if (t.includes('retry') || t.includes('backoff')) s.push('Retry with backoff');
  if (t.includes('timeout')) s.push('Timeout protection');
  if (t.includes('fallback') || t.includes('graceful')) s.push('Graceful fallback');
  if (t.includes('rate') && t.includes('limit')) s.push('Rate limit handling');
  if (t.includes('auth') || t.includes('credential') || t.includes('401')) s.push('Auth recovery');
  if (t.includes('log') || t.includes('report')) s.push('Error logging');
  if (t.includes('escalat') || t.includes('notify')) s.push('Escalation alerts');
  if (t.includes('skip') || t.includes('ignore')) s.push('Skip & continue');
  if (t.includes('circuit') && t.includes('break')) s.push('Circuit breaker');
  if (t.includes('idempoten')) s.push('Idempotent retries');
  return s.length > 0 ? s.slice(0, 3) : ['Default error handling'];
}

function CellBullets({ items, color = 'text-foreground/70' }: { items: string[]; color?: string }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 leading-tight">
          <span className="w-1.5 h-1.5 rounded-full bg-current opacity-40 mt-[7px] flex-shrink-0" />
          <span className={`text-sm ${color} leading-snug`}>{item}</span>
        </li>
      ))}
    </ul>
  );
}

const TRIGGER_LABELS: Record<string, string> = {
  schedule: 'Runs on a schedule', polling: 'Polls for changes', webhook: 'Listens for webhooks',
  manual: 'Manually triggered', event: 'Reacts to events',
};

// ── Cell renderer (Neon, dark+light aware) ───────────────────────────

function MatrixCellRenderer({ cell, isEditMode, buildLocked }: { cell: MatrixCell; isEditMode: boolean; buildLocked?: boolean }) {
  const Watermark = cell.watermark;
  const useEditRender = isEditMode && cell.editRender && !buildLocked;

  return (
    <div className={[
      'relative rounded-xl border border-card-border p-4 transition-all duration-150 shadow-md',
      useEditRender
        ? 'bg-card-bg ring-1 ring-inset ring-primary/10'
        : 'bg-card-bg',
    ].join(' ')}>
      <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
        <div className={`absolute -right-1 -top-1 ${useEditRender ? 'opacity-[0.15]' : 'opacity-[0.25]'}`}>
          <Watermark className={`w-22 h-22 ${cell.watermarkColor}`} />
        </div>
      </div>
      <div className="mb-2.5">
        <span className="text-[13px] font-bold uppercase tracking-[0.15em] text-foreground/60">{cell.label}</span>
      </div>
      <div className="relative min-h-[52px] flex items-start">
        {useEditRender ? cell.editRender!() : cell.render()}
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────

export function PersonaMatrix(props: PersonaMatrixProps) {
  const { designResult, flows = [], hideHeader = false, onLaunch, launchDisabled, launchLabel, isRunning, onNavigateCatalog, buildLocked = false, questions, userAnswers, onAnswerUpdated, onSubmitAnswers, buildCompleted, phaseLabel } = props;
  const isEditMode = props.mode === 'edit';

  const cells = useMemo<MatrixCell[]>(() => {
    if (!designResult) return [];
    const connectorNames = designResult.suggested_connectors?.map((c) => c.name) ?? [];
    const archCategories = deriveArchCategories(connectorNames);
    const triggers = extractTriggers(designResult.suggested_triggers ?? []);
    const review = extractHumanReview(designResult.protocol_capabilities);
    const memory = extractMemory(designResult.protocol_capabilities);
    const channels = designResult.suggested_notification_channels ?? [];
    const errorStrategies = extractErrorStrategies(designResult.structured_prompt?.errorHandling ?? '');
    const events: SuggestedEventSubscription[] = designResult.suggested_event_subscriptions ?? [];
    const editProps = isEditMode ? props as PersonaMatrixEditProps : null;

    return [
      { key: 'use-cases', label: 'Use Cases', watermark: UseCasesIcon, watermarkColor: 'text-violet-400',        render: () => flows.length === 0 ? <CellBullets items={['General-purpose agent']} color="text-muted-foreground/50" /> : <CellBullets items={flows.slice(0, 3).map((f) => f.name)} color="text-foreground/70" /> },
      { key: 'connectors', label: 'Connectors', watermark: ConnectorsIcon, watermarkColor: 'text-cyan-400',        render: () => {
          if (archCategories.length === 0) return <CellBullets items={['No external services']} color="text-muted-foreground/50" />;
          return (<div className="space-y-1.5">{archCategories.slice(0, 3).map((cat: ArchCategory) => { const CatIcon = cat.icon; return (<div key={cat.key} className="flex items-center gap-2"><CatIcon className="w-3.5 h-3.5 flex-shrink-0 opacity-70" style={{ color: cat.color }} /><span className="text-sm text-foreground/70 leading-snug">{cat.label}</span></div>); })}{archCategories.length > 3 && <span className="text-sm text-muted-foreground/40 pl-[22px]">+{archCategories.length - 3} more</span>}</div>);
        },
        editRender: editProps ? () => (<ConnectorEditCell requiredConnectors={editProps.requiredConnectors} credentials={editProps.credentials} editState={editProps.editState} callbacks={editProps.editCallbacks} onNavigateCatalog={onNavigateCatalog} />) : undefined },
      { key: 'triggers', label: 'Triggers', watermark: TriggersIcon, watermarkColor: 'text-amber-400',        render: () => triggers.length === 0 ? <CellBullets items={['Manual execution only']} color="text-muted-foreground/50" /> : <CellBullets items={triggers.slice(0, 3).map((t) => t.label)} color="text-foreground/70" />,
        editRender: editProps ? () => (<TriggerEditCell designResult={designResult} editState={editProps.editState} callbacks={editProps.editCallbacks} />) : undefined },
      { key: 'human-review', label: 'Human Review', watermark: HumanReviewIcon,
        watermarkColor: review.level === 'required' ? 'text-rose-400' : review.level === 'optional' ? 'text-amber-400' : 'text-emerald-400',
        render: () => { const dotColor = review.level === 'required' ? 'bg-rose-400' : review.level === 'optional' ? 'bg-amber-400' : 'bg-emerald-400'; return (<div className="space-y-1.5"><div className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${dotColor} flex-shrink-0`} /><span className="text-sm font-medium text-foreground/80">{review.label}</span></div><p className="text-sm text-muted-foreground/60 leading-snug pl-[16px]">{review.context.length > 55 ? review.context.slice(0, 53) + '\u2026' : review.context}</p></div>); },
        editRender: editProps ? () => (<ReviewEditCell editState={editProps.editState} callbacks={editProps.editCallbacks} />) : undefined },
      { key: 'messages', label: 'Messages', watermark: MessagesIcon, watermarkColor: 'text-blue-400',
        render: () => { if (channels.length === 0) return <CellBullets items={['In-app notifications only']} color="text-muted-foreground/50" />; const bullets = channels.slice(0, 3).map((ch) => { const prefix = ch.type.charAt(0).toUpperCase() + ch.type.slice(1); return ch.description.length > 3 && ch.description.length <= 40 ? `${prefix}: ${ch.description}` : `${prefix} channel`; }); return <CellBullets items={bullets} color="text-foreground/70" />; },
        editRender: editProps ? () => (<MessagesEditCell editState={editProps.editState} callbacks={editProps.editCallbacks} />) : undefined },
      { key: 'memory', label: 'Memory', watermark: MemoryIcon,
        watermarkColor: memory.active ? 'text-purple-400' : 'text-zinc-400',
        render: () => (<div className="space-y-1.5"><div className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${memory.active ? 'bg-purple-400' : 'bg-zinc-500'} flex-shrink-0`} /><span className="text-sm font-medium text-foreground/80">{memory.label}</span></div><p className="text-sm text-muted-foreground/60 leading-snug pl-[16px]">{memory.context}</p></div>),
        editRender: editProps ? () => (<MemoryEditCell editState={editProps.editState} callbacks={editProps.editCallbacks} />) : undefined },
      { key: 'error-handling', label: 'Errors', watermark: ErrorsIcon, watermarkColor: 'text-orange-400',
        render: () => <CellBullets items={errorStrategies} color="text-foreground/70" /> },
      { key: 'events', label: 'Events', watermark: EventsIcon,
        watermarkColor: events.length > 0 ? 'text-teal-400' : 'text-muted-foreground',
        render: () => { if (events.length === 0) return <CellBullets items={['No event subscriptions']} color="text-muted-foreground/40" />; const bullets = events.slice(0, 3).map((ev) => ev.description.length > 3 && ev.description.length <= 40 ? ev.description : ev.event_type); return <CellBullets items={bullets} color="text-foreground/70" />; } },
    ];
  }, [designResult, flows, isEditMode, onNavigateCatalog, // deps intentionally limited
    ...(isEditMode ? [(props as PersonaMatrixEditProps).editState, (props as PersonaMatrixEditProps).requiredConnectors, (props as PersonaMatrixEditProps).credentials] : [])]);

  const commandCenter = (<MatrixCommandCenter designResult={designResult} isEditMode={isEditMode} isRunning={isRunning} onLaunch={onLaunch} launchDisabled={launchDisabled} launchLabel={launchLabel} questions={questions} userAnswers={userAnswers} onAnswerUpdated={onAnswerUpdated} onSubmitAnswers={onSubmitAnswers} buildCompleted={buildCompleted} phaseLabel={phaseLabel} />);

  if (!designResult || cells.length === 0) return (<div className="flex items-center justify-center py-12 text-sm text-muted-foreground/60">Matrix data unavailable.</div>);

  const firstFour = cells.slice(0, 4);
  const lastFour = cells.slice(4);

  return (
    <div className="space-y-3 w-full">
      {!hideHeader && (
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded bg-primary/20 flex items-center justify-center border border-primary/25 shadow-sm shadow-primary/20">
            <span className="text-[10px] font-bold text-foreground/60">M</span>
          </div>
          <h4 className="text-base font-bold text-foreground/80 uppercase tracking-wider">Persona Matrix</h4>
        </div>
      )}
      <div className="grid grid-cols-[1fr_1.3fr_1fr] gap-2.5">
        {firstFour.map((cell) => (<MatrixCellRenderer key={cell.key} cell={cell} isEditMode={isEditMode} buildLocked={buildLocked} />))}
        <div className="relative rounded-xl border border-primary/30 p-5 ring-1 ring-primary/10 shadow-2xl shadow-primary/5 overflow-hidden">
          {/* Neon background — theme-colored radial glow */}
          <div className="absolute inset-0 bg-card-bg" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,var(--primary)_0%,transparent_70%)] opacity-[0.07]" />
          <div className="relative z-10">{commandCenter}</div>
        </div>
        {lastFour.map((cell) => (<MatrixCellRenderer key={cell.key} cell={cell} isEditMode={isEditMode} buildLocked={buildLocked} />))}
      </div>
    </div>
  );
}
