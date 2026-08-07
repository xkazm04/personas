/**
 * @catalog Renders an agent-declared SurfaceSpec (see surface/SPEC.md) as live UI using ONLY blessed catalog primitives — StatCard, UnifiedTable, DecisionRow, MarkdownRenderer, ConfidenceArc, CliOutputPanel — with every action consent-gated behind DispatchChooser/ConfirmDialog. Use `extractSurfaceSpec` + this instead of hand-rolling agent-output UI.
 *
 * SurfaceRenderer — the "generative cockpit": a persona run whose output is a
 * valid SurfaceSpec stops being a text blob and becomes an interactive decision
 * surface. The switch below is the ENTIRE vocabulary — every node maps onto an
 * existing catalog component, no new visual primitives, no arbitrary HTML.
 *
 * Consent rule (shared UX contract): NOTHING auto-runs from a rendered
 * surface. `dispatch` actions open DispatchChooserModal (the app's universal
 * consent surface); `execute_persona` actions open ConfirmDialog with the
 * prepared input visible. A surface can propose, only the operator disposes.
 */
import { useMemo, useState } from 'react';

import type { DecisionAction } from '@/features/shared/components/decisions/decisionTypes';
import { DecisionRow } from '@/features/shared/components/decisions/DecisionRow';
import { ConfidenceArc } from '@/features/shared/components/display/ConfidenceArc';
import { SectionLabel } from '@/features/shared/components/display/SectionLabel';
import { StatCard } from '@/features/shared/components/display/StatCard';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { AthenaComposedBadge } from '@/features/shared/components/feedback/AthenaComposedBadge';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import CliOutputPanel from '@/features/shared/components/terminal/CliOutputPanel';
import { DispatchChooserModal, type DispatchRequest } from '@/features/shared/dispatch/DispatchChooser';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';

import type { SurfaceAction, SurfaceBlock, SurfaceSpec } from './surfaceSpec';

/**
 * Everything the host view can lend the surface for wiring actions. The
 * catalog stays domain-agnostic: the renderer never touches a store — the
 * hosting feature passes its own persona-execution capability in.
 */
export interface SurfaceRenderContext {
  /** Default persona for `execute_persona` actions (usually the run's). */
  personaId?: string;
  /** Repo target for `dispatch` actions; without it they render disabled. */
  dispatchTarget?: DispatchRequest['target'];
  /** Fleet session dedup key prefix for dispatched work. */
  fleetKey?: string;
  /** Host-supplied persona runner (e.g. agentStore.executePersona). Without
   *  it, `execute_persona` actions render disabled. */
  onExecutePersona?: (personaId: string, input: { message: string }) => Promise<unknown>;
}

interface SurfaceRendererProps {
  spec: SurfaceSpec;
  /** Blocks removed by the repair pass — surfaced honestly, never hidden. */
  dropped?: number;
  context?: SurfaceRenderContext;
  className?: string;
}

export function SurfaceRenderer({ spec, dropped = 0, context, className }: SurfaceRendererProps) {
  const { t, tx } = useTranslation();
  const [pendingDispatch, setPendingDispatch] = useState<DispatchRequest | null>(null);
  const [pendingRun, setPendingRun] = useState<SurfaceAction | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  const toDecisionAction = (action: SurfaceAction, keyPrefix: string): DecisionAction => {
    const isDispatch = action.kind === 'dispatch';
    const targetPersona = action.persona_id ?? context?.personaId;
    const unusable = isDispatch
      ? !context?.dispatchTarget
      : !targetPersona || !context?.onExecutePersona;
    return {
      id: `${keyPrefix}:${action.id}`,
      label: action.label,
      tone: action.tone,
      disabled: unusable || runningId !== null,
      loading: runningId === `${keyPrefix}:${action.id}`,
      title: unusable ? t.shared.surface.no_target : action.label,
      onClick: () => {
        if (unusable) return;
        if (isDispatch && context?.dispatchTarget) {
          setPendingDispatch({
            title: action.label,
            prompt: action.prompt,
            target: context.dispatchTarget,
            fleetKey: context.fleetKey ? `${context.fleetKey}:${action.id}` : undefined,
          });
        } else {
          setPendingRun(action);
        }
      },
    };
  };

  const confirmRun = async (action: SurfaceAction) => {
    const personaId = action.persona_id ?? context?.personaId;
    if (!personaId || !context?.onExecutePersona) return;
    const key = `run:${action.id}`;
    setRunningId(key);
    try {
      await context.onExecutePersona(personaId, { message: action.prompt });
    } catch (err) {
      toastCatch('surface action run')(err);
    } finally {
      setRunningId(null);
      setPendingRun(null);
    }
  };

  return (
    <div className={`space-y-4 ${className ?? ''}`.trim()} data-testid="surface-renderer">
      {/* Provenance header — an agent composed this, and it says so. */}
      <div className="flex items-start gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          {spec.title && <h3 className="typo-heading font-semibold text-foreground/90">{spec.title}</h3>}
          {spec.summary && <p className="typo-caption text-foreground mt-0.5">{spec.summary}</p>}
        </div>
        <AthenaComposedBadge
          variant="composed"
          label={t.shared.surface.composed_badge}
          title={t.shared.surface.composed_tip}
        />
      </div>

      {dropped > 0 && (
        <p className="typo-caption text-amber-400/90" data-testid="surface-dropped-note">
          {tx(t.shared.surface.dropped_blocks, { count: dropped })}
        </p>
      )}

      {spec.blocks.map((block, i) => (
        <SurfaceBlockView
          key={`${block.type}-${i}`}
          block={block}
          index={i}
          toDecisionAction={toDecisionAction}
        />
      ))}

      {/* Consent surfaces — the ONLY paths from a rendered button to work. */}
      {pendingDispatch && (
        <DispatchChooserModal request={pendingDispatch} onClose={() => setPendingDispatch(null)} />
      )}
      {pendingRun && (
        <ConfirmDialog
          title={t.shared.surface.confirm_run_title}
          body={tx(t.shared.surface.confirm_run_body, {
            label: pendingRun.label,
            prompt: pendingRun.prompt.length > 400 ? `${pendingRun.prompt.slice(0, 400)}…` : pendingRun.prompt,
          })}
          confirmLabel={t.shared.surface.confirm_run_action}
          onConfirm={() => confirmRun(pendingRun)}
          onCancel={() => setPendingRun(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block switch — the frozen vocabulary. One case per catalog component.
// ---------------------------------------------------------------------------

const STAT_TONE = { neutral: 'neutral', success: 'success', warning: 'warning', danger: 'danger', info: 'info' } as const;

type SurfaceTableRow = Record<string, string | number | boolean | null> & { __surfaceKey: string };

function SurfaceBlockView({
  block,
  index,
  toDecisionAction,
}: {
  block: SurfaceBlock;
  index: number;
  toDecisionAction: (action: SurfaceAction, keyPrefix: string) => DecisionAction;
}) {
  const { t } = useTranslation();

  switch (block.type) {
    case 'stat_row':
      return (
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}
          data-testid="surface-stat-row"
        >
          {block.stats.map((stat, i) => (
            <StatCard
              key={`${stat.label}-${i}`}
              label={stat.label}
              value={stat.value}
              tone={STAT_TONE[stat.tone]}
              hint={stat.hint}
              delta={stat.delta}
            />
          ))}
        </div>
      );

    case 'table':
      return <SurfaceTable block={block} />;

    case 'decisions':
      return (
        <div data-testid="surface-decisions">
          {block.title && <SectionLabel>{block.title}</SectionLabel>}
          <ul className="rounded-card border border-primary/10 bg-secondary/10 divide-y divide-primary/5 overflow-hidden">
            {block.items.map((item) => (
              <DecisionRow
                key={item.id}
                record={{
                  id: item.id,
                  title: item.title,
                  summary: item.summary ?? null,
                  category: item.category ?? null,
                  facts: item.facts,
                }}
                actions={item.actions.map((a) => toDecisionAction(a, `d:${item.id}`))}
                testId={`surface-decision-${item.id}`}
              />
            ))}
          </ul>
        </div>
      );

    case 'markdown':
      return <MarkdownRenderer content={block.content} className="typo-body" />;

    case 'gauge':
      return (
        <div
          className="rounded-card border border-primary/10 bg-gradient-to-b from-secondary/45 to-secondary/15 shadow-elevation-1 p-3.5 flex items-center gap-4"
          data-testid="surface-gauge"
        >
          <ConfidenceArc value={block.value} width={72} height={40} showLabel />
          <div className="min-w-0">
            <span className="typo-label text-foreground block">{block.label}</span>
            {block.hint && <span className="typo-caption text-foreground">{block.hint}</span>}
          </div>
        </div>
      );

    case 'progress':
      return (
        <StatCard
          label={block.label}
          value={`${Math.round(block.value)}%`}
          tone={block.value >= 100 ? 'success' : 'neutral'}
          hint={block.hint}
          spark={
            // StatCard's documented mini-bar slot; token colors only.
            <div className="h-1 rounded-full bg-secondary/40 overflow-hidden" aria-hidden>
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${block.value}%` }}
              />
            </div>
          }
        />
      );

    case 'terminal':
      return (
        <div data-testid="surface-terminal">
          {block.title && <SectionLabel>{block.title}</SectionLabel>}
          <CliOutputPanel
            phase="completed"
            lines={block.lines}
            idleText={t.shared.surface.terminal_empty}
            maxHeightClassName="max-h-72"
          />
        </div>
      );

    default: {
      // Exhaustiveness guard — a schema-valid block always matches a case.
      const _never: never = block;
      void _never;
      void index;
      return null;
    }
  }
}

function SurfaceTable({ block }: { block: Extract<SurfaceBlock, { type: 'table' }> }) {
  const { t } = useTranslation();

  const rows = useMemo<SurfaceTableRow[]>(
    () => block.rows.map((row, i) => ({ ...row, __surfaceKey: `row-${i}` })),
    [block.rows],
  );

  const columns = useMemo<TableColumn<SurfaceTableRow>[]>(
    () =>
      block.columns.map((col) => ({
        key: col.key,
        label: col.label,
        width: 'minmax(90px, 1fr)',
        align: col.align,
        sortable: true,
        render: (row) => {
          const value = row[col.key];
          if (value === null || value === undefined) {
            return <span className="text-foreground">—</span>;
          }
          return <span className={typeof value === 'number' ? 'tabular-nums' : undefined}>{String(value)}</span>;
        },
      })),
    [block.columns],
  );

  return (
    <div data-testid="surface-table">
      {block.title && <SectionLabel>{block.title}</SectionLabel>}
      <UnifiedTable<SurfaceTableRow>
        columns={columns}
        data={rows}
        getRowKey={(row) => row.__surfaceKey}
        emptyTitle={t.shared.surface.table_empty}
      />
    </div>
  );
}

// Re-export so consumers can keep a single import site.
export { extractSurfaceSpec, parseSurfaceSpec } from './surfaceSpec';
export type { SurfaceSpec, SurfaceAction, SurfaceBlock } from './surfaceSpec';
