import { useMemo } from 'react';
import { Hexagon } from 'lucide-react';
import { deriveArchCategories, type ArchCategory } from './architecturalCategories';
import {
  UseCasesIcon,
  ConnectorsIcon,
  TriggersIcon,
  HumanReviewIcon,
  MessagesIcon,
  MemoryIcon,
  ErrorsIcon,
  EventsIcon,
} from './MatrixIcons';
import type {
  AgentIR,
  SuggestedTrigger,
  SuggestedEventSubscription,
  ProtocolCapability,
} from '@/lib/types/designTypes';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import type { CredentialMetadata } from '@/lib/types/types';
import type { RequiredConnector } from '../adoption/steps/ConnectStep';
import type { MatrixEditState, MatrixEditCallbacks } from './EditableMatrixCells';
import {
  ConnectorEditCell,
  TriggerEditCell,
  ReviewEditCell,
  MemoryEditCell,
} from './EditableMatrixCells';

// ── Types ────────────────────────────────────────────────────────────

interface MatrixCell {
  key: string;
  label: string;
  watermark: React.ComponentType<{ className?: string }>;
  watermarkColor: string;
  borderTint: string;
  render: () => React.ReactNode;
  editRender?: () => React.ReactNode;
}

interface PersonaMatrixBaseProps {
  designResult: AgentIR | null;
  flows?: UseCaseFlow[];
  /** Hide the "Persona Matrix" header. Default: false */
  hideHeader?: boolean;
}

interface PersonaMatrixViewProps extends PersonaMatrixBaseProps {
  mode?: 'view';
}

interface PersonaMatrixEditProps extends PersonaMatrixBaseProps {
  mode: 'edit';
  editState: MatrixEditState;
  editCallbacks: MatrixEditCallbacks;
  requiredConnectors: RequiredConnector[];
  credentials: CredentialMetadata[];
}

export type PersonaMatrixProps = PersonaMatrixViewProps | PersonaMatrixEditProps;

// ── Extraction helpers ───────────────────────────────────────────────

interface TriggerInfo {
  type: string;
  label: string;
}

/** Try to derive a human-readable cron/interval label from trigger config */
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

function extractTriggers(triggers: SuggestedTrigger[]): TriggerInfo[] {
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

    if (t.description.length > 3 && t.description.length <= 45) {
      return { type: t.trigger_type, label: t.description };
    }

    return { type: t.trigger_type, label: TRIGGER_LABELS[t.trigger_type] ?? t.trigger_type };
  });
}

function extractHumanReview(capabilities: ProtocolCapability[] | undefined): {
  level: 'required' | 'optional' | 'none';
  label: string;
  context: string;
} {
  const review = capabilities?.find((c) => c.type === 'manual_review');
  if (!review) return { level: 'none', label: 'Autonomous', context: 'No human approval gates' };
  const ctx = review.context?.toLowerCase() ?? '';
  if (ctx.includes('always') || ctx.includes('required')) {
    return { level: 'required', label: 'Required', context: review.context || 'Approval before every action' };
  }
  return { level: 'optional', label: 'Conditional', context: review.context || 'Review on flagged items' };
}

function extractMemory(capabilities: ProtocolCapability[] | undefined): {
  active: boolean;
  label: string;
  context: string;
} {
  const memory = capabilities?.find((c) => c.type === 'agent_memory');
  if (!memory) return { active: false, label: 'Stateless', context: 'No cross-run memory' };
  return { active: true, label: 'Persistent', context: memory.context || 'Retains context across runs' };
}

function extractErrorStrategies(errorHandling: string): string[] {
  if (!errorHandling) return ['Default error handling'];
  const strategies: string[] = [];
  const text = errorHandling.toLowerCase();

  if (text.includes('retry') || text.includes('backoff')) strategies.push('Retry with backoff');
  if (text.includes('timeout')) strategies.push('Timeout protection');
  if (text.includes('fallback') || text.includes('graceful')) strategies.push('Graceful fallback');
  if (text.includes('rate') && text.includes('limit')) strategies.push('Rate limit handling');
  if (text.includes('auth') || text.includes('credential') || text.includes('401')) strategies.push('Auth recovery');
  if (text.includes('log') || text.includes('report')) strategies.push('Error logging');
  if (text.includes('escalat') || text.includes('notify')) strategies.push('Escalation alerts');
  if (text.includes('skip') || text.includes('ignore')) strategies.push('Skip & continue');
  if (text.includes('circuit') && text.includes('break')) strategies.push('Circuit breaker');
  if (text.includes('idempoten')) strategies.push('Idempotent retries');

  return strategies.length > 0 ? strategies.slice(0, 3) : ['Default error handling'];
}

// ── Shared sub-components ────────────────────────────────────────────

function CellBullets({ items, color = 'text-foreground/70' }: { items: string[]; color?: string }) {
  return (
    <ul className="space-y-0.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-1.5 leading-tight">
          <span className="w-1 h-1 rounded-full bg-current opacity-40 mt-[5px] flex-shrink-0" />
          <span className={`text-[11px] ${color} leading-snug`}>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function EmptySlot() {
  return (
    <span className="text-[10px] text-muted-foreground/25 font-mono uppercase tracking-widest select-none">
      — —
    </span>
  );
}

const TRIGGER_LABELS: Record<string, string> = {
  schedule: 'Runs on a schedule',
  polling: 'Polls for changes',
  webhook: 'Listens for webhooks',
  manual: 'Manually triggered',
  event: 'Reacts to events',
};

// ── Main Component ───────────────────────────────────────────────────

export function PersonaMatrix(props: PersonaMatrixProps) {
  const { designResult, flows = [], hideHeader = false } = props;
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

    // Edit-mode cell renderers (only created when needed)
    const editProps = isEditMode ? props as PersonaMatrixEditProps : null;

    return [
      // ── Row 1 ──────────────────────────────────
      {
        key: 'use-cases',
        label: 'Use Cases',
        watermark: UseCasesIcon,
        watermarkColor: 'text-violet-400',
        borderTint: 'border-violet-500/15',
        render: () => {
          if (flows.length === 0) {
            return <CellBullets items={['General-purpose agent']} color="text-muted-foreground/50" />;
          }
          return <CellBullets items={flows.slice(0, 3).map((f) => f.name)} color="text-foreground/70" />;
        },
      },
      {
        key: 'connectors',
        label: 'Connectors',
        watermark: ConnectorsIcon,
        watermarkColor: 'text-cyan-400',
        borderTint: 'border-cyan-500/15',
        render: () => {
          if (archCategories.length === 0) {
            return <CellBullets items={['No external services']} color="text-muted-foreground/50" />;
          }
          return (
            <div className="space-y-1">
              {archCategories.slice(0, 3).map((cat: ArchCategory) => {
                const CatIcon = cat.icon;
                return (
                  <div key={cat.key} className="flex items-center gap-1.5">
                    <CatIcon className="w-3 h-3 flex-shrink-0 opacity-70" style={{ color: cat.color }} />
                    <span className="text-[11px] text-foreground/70 leading-snug">{cat.label}</span>
                  </div>
                );
              })}
              {archCategories.length > 3 && (
                <span className="text-[10px] text-muted-foreground/40 pl-[18px]">
                  +{archCategories.length - 3} more
                </span>
              )}
            </div>
          );
        },
        editRender: editProps ? () => (
          <ConnectorEditCell
            requiredConnectors={editProps.requiredConnectors}
            credentials={editProps.credentials}
            editState={editProps.editState}
            callbacks={editProps.editCallbacks}
          />
        ) : undefined,
      },
      {
        key: 'triggers',
        label: 'Triggers',
        watermark: TriggersIcon,
        watermarkColor: 'text-amber-400',
        borderTint: 'border-amber-500/15',
        render: () => {
          if (triggers.length === 0) {
            return <CellBullets items={['Manual execution only']} color="text-muted-foreground/50" />;
          }
          return <CellBullets items={triggers.slice(0, 3).map((t) => t.label)} color="text-foreground/70" />;
        },
        editRender: editProps ? () => (
          <TriggerEditCell
            designResult={designResult}
            editState={editProps.editState}
            callbacks={editProps.editCallbacks}
          />
        ) : undefined,
      },

      // ── Row 2 ──────────────────────────────────
      {
        key: 'human-review',
        label: 'Human Review',
        watermark: HumanReviewIcon,
        watermarkColor: review.level === 'required'
          ? 'text-rose-400'
          : review.level === 'optional'
            ? 'text-amber-400'
            : 'text-emerald-400',
        borderTint: review.level === 'required'
          ? 'border-rose-500/15'
          : review.level === 'optional'
            ? 'border-amber-500/15'
            : 'border-emerald-500/15',
        render: () => {
          const dotColor = review.level === 'required' ? 'bg-rose-400' : review.level === 'optional' ? 'bg-amber-400' : 'bg-emerald-400';
          return (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${dotColor} flex-shrink-0`} />
                <span className="text-[11px] font-medium text-foreground/80">{review.label}</span>
              </div>
              <p className="text-[10px] text-muted-foreground/60 leading-snug pl-[12px]">
                {review.context.length > 50 ? review.context.slice(0, 48) + '…' : review.context}
              </p>
            </div>
          );
        },
        editRender: editProps ? () => (
          <ReviewEditCell
            editState={editProps.editState}
            callbacks={editProps.editCallbacks}
          />
        ) : undefined,
      },
      {
        key: 'messages',
        label: 'Messages',
        watermark: MessagesIcon,
        watermarkColor: 'text-blue-400',
        borderTint: 'border-blue-500/15',
        render: () => {
          if (channels.length === 0) {
            return <CellBullets items={['In-app notifications only']} color="text-muted-foreground/50" />;
          }
          const bullets = channels.slice(0, 3).map((ch) => {
            const prefix = ch.type.charAt(0).toUpperCase() + ch.type.slice(1);
            return ch.description.length > 3 && ch.description.length <= 40
              ? `${prefix}: ${ch.description}`
              : `${prefix} channel`;
          });
          return <CellBullets items={bullets} color="text-foreground/70" />;
        },
      },
      {
        key: 'memory',
        label: 'Memory',
        watermark: MemoryIcon,
        watermarkColor: memory.active ? 'text-purple-400' : 'text-zinc-400',
        borderTint: memory.active ? 'border-purple-500/15' : 'border-zinc-500/15',
        render: () => (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${memory.active ? 'bg-purple-400' : 'bg-zinc-500'} flex-shrink-0`} />
              <span className="text-[11px] font-medium text-foreground/80">{memory.label}</span>
            </div>
            <p className="text-[10px] text-muted-foreground/60 leading-snug pl-[12px]">
              {memory.context}
            </p>
          </div>
        ),
        editRender: editProps ? () => (
          <MemoryEditCell
            editState={editProps.editState}
            callbacks={editProps.editCallbacks}
          />
        ) : undefined,
      },

      // ── Row 3 ──────────────────────────────────
      {
        key: 'error-handling',
        label: 'Errors',
        watermark: ErrorsIcon,
        watermarkColor: 'text-orange-400',
        borderTint: 'border-orange-500/15',
        render: () => <CellBullets items={errorStrategies} color="text-foreground/70" />,
      },
      {
        key: 'events',
        label: 'Events',
        watermark: EventsIcon,
        watermarkColor: events.length > 0 ? 'text-teal-400' : 'text-muted-foreground',
        borderTint: events.length > 0 ? 'border-teal-500/15' : 'border-primary/5',
        render: () => {
          if (events.length === 0) {
            return <CellBullets items={['No event subscriptions']} color="text-muted-foreground/40" />;
          }
          const bullets = events.slice(0, 3).map((ev) =>
            ev.description.length > 3 && ev.description.length <= 40 ? ev.description : ev.event_type,
          );
          return <CellBullets items={bullets} color="text-foreground/70" />;
        },
      },
      {
        key: 'slot-9',
        label: '· · ·',
        watermark: Hexagon,
        watermarkColor: 'text-muted-foreground',
        borderTint: 'border-primary/5',
        render: () => <EmptySlot />,
      },
    ];
  }, [designResult, flows, isEditMode,
    // Edit-mode deps: re-derive cells when edit state changes
    ...(isEditMode ? [
      (props as PersonaMatrixEditProps).editState,
      (props as PersonaMatrixEditProps).requiredConnectors,
      (props as PersonaMatrixEditProps).credentials,
    ] : []),
  ]);

  if (!designResult || cells.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground/60">
        Matrix data unavailable.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!hideHeader && (
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-gradient-to-br from-violet-500/20 to-cyan-500/20 flex items-center justify-center">
            <span className="text-[10px] font-bold text-foreground/60">M</span>
          </div>
          <h4 className="text-sm font-semibold text-muted-foreground/80 uppercase tracking-wider">
            Persona Matrix
          </h4>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {cells.map((cell) => {
          const Watermark = cell.watermark;
          const isFreeSlot = cell.key.startsWith('slot-');
          const useEditRender = isEditMode && cell.editRender;
          return (
            <div
              key={cell.key}
              className={`relative overflow-hidden rounded-xl border p-2.5 transition-colors ${
                isFreeSlot
                  ? 'border-dashed border-primary/8 bg-transparent'
                  : useEditRender
                    ? `${cell.borderTint} bg-secondary/10 hover:bg-secondary/20 ring-1 ring-inset ring-primary/5`
                    : `${cell.borderTint} bg-secondary/15 hover:bg-secondary/25`
              }`}
            >
              {/* Watermark background icon */}
              <div className={`absolute -right-2 -top-2 pointer-events-none ${useEditRender ? 'opacity-40' : 'opacity-70'}`}>
                <Watermark className={`w-16 h-16 ${cell.watermarkColor}`} />
              </div>

              {/* Label header */}
              <div className="mb-1.5">
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${
                  isFreeSlot ? 'text-muted-foreground/20' : 'text-muted-foreground/60'
                }`}>
                  {cell.label}
                </span>
              </div>

              {/* Content */}
              <div className="relative min-h-[36px] flex items-start">
                {useEditRender ? cell.editRender!() : cell.render()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
