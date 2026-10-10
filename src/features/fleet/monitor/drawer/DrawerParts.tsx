// DrawerParts — the atoms every reading of the dossier is built from.
//
// A variant composes these; it never re-authors one. That is the line between
// "three readings" and "three features": the report card, the activity line
// and the settled-empty line look the same in all three, so switching variant
// changes WHAT YOU LOOK AT FIRST, not what a report is.
//
// THE REPORT BODY IS MARKDOWN. It was printed as `whitespace-pre-wrap` text
// (`MonitorDrawer.tsx:344` before this change), so a persona's report arrived
// as a wall of `##` and `-` characters. Reports are written as markdown
// documents by the engine; `MarkdownRenderer` is the renderer every other
// report surface in the app already uses.

import { useState, type ReactNode } from 'react';
import { Check, Clock } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import ReasoningTrace from '@/features/shared/components/layout/ReasoningTrace';
import { useReasoningTrace } from '@/hooks/execution/useReasoningTrace';
import { useExecutionScope } from '@/hooks/execution/useExecutionScope';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaReport } from '@/lib/bindings/PersonaReport';
import { Dot } from '@/features/shared/components/kit';
import {
  elapsedStr, processStatusLabel, processStatusMeta, type ProcessEntry,
} from '../monitorModel';
import { navigateToProcess } from '../navigateToProcess';

/** Priorities that make an unread report a demand rather than a notice. */
const LOUD = new Set(['high', 'urgent']);

/**
 * A settled-empty line inside a plate or a section. Deliberately one shared
 * component rather than one per variant, and deliberately a LINE rather than
 * an illustrated panel: the drawer shows four domains at once and three of
 * them are usually empty, so a full `ScenarioEmptyState` per domain would be
 * the loudest thing on a calm persona's dossier.
 */
export function NothingHere({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <p className={`typo-caption text-foreground ${compact ? 'px-1 py-2' : 'px-1 py-6 text-center'}`}>
      {text}
    </p>
  );
}

/**
 * One unread report. `density` picks the markdown treatment: `card` for the
 * stacked readings, `document` for the continuous brief, where a report is
 * the thing being read rather than a row in a list.
 */
export function ReportCard({
  message, onMarkRead, density = 'card',
}: {
  message: PersonaReport;
  onMarkRead: (id: string) => void;
  density?: 'card' | 'document';
}) {
  const { t } = useTranslation();
  const loud = LOUD.has(message.priority);
  return (
    <article className="rounded-card border border-border/60 bg-secondary/20 px-4 py-3">
      <div className="flex items-start gap-3">
        <Tooltip content={loud ? t.monitor.attention_warning : t.monitor.attention_info}>
          <span className="mt-1.5 inline-flex">
            <Dot tone={loud ? 'warning' : 'info'} glyph={loud ? 'solid' : 'soft'} />
          </span>
        </Tooltip>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-1.5 typo-caption text-foreground">
            <Clock className="h-3 w-3" aria-hidden />
            <RelativeTime timestamp={message.created_at} />
          </div>
          {message.title && <h5 className="typo-heading text-foreground">{message.title}</h5>}
          <MarkdownRenderer
            content={message.content}
            variant={density}
            className="typo-body text-foreground"
          />
        </div>
        <Button
          size="sm"
          variant="secondary"
          icon={<Check className="h-3.5 w-3.5" />}
          onClick={() => onMarkRead(message.id)}
        >
          {t.monitor.mark_read}
        </Button>
      </div>
    </article>
  );
}

/**
 * One live process. Clicking navigates when the process declares a
 * destination; otherwise a running execution expands its reasoning trace in
 * place. The chrome is a hairline rule and a hover wash in semantic tokens —
 * deliberately NOT the panel's `ae-line`, whose custom properties are only
 * defined inside an `.ae-root`, so this atom is correct in all three readings.
 */
export function ActivityLine({
  entry, now, onNavigate,
}: { entry: ProcessEntry; now: number; onNavigate: () => void }) {
  const { t, tx } = useTranslation();
  const { proc } = entry;
  const [expanded, setExpanded] = useState(false);
  const isExecution = proc.domain === 'execution';
  const executionId = isExecution && expanded ? (proc.runId ?? null) : null;
  useExecutionScope(executionId, executionId ? proc.personaId ?? null : null);
  const { entries, isLive } = useReasoningTrace(executionId);
  const hasNav = !!proc.navigateTo;
  const M = processStatusMeta(proc.status);

  const handleClick = () => {
    if (hasNav) {
      navigateToProcess(proc, onNavigate);
      return;
    }
    if (isExecution && proc.status === 'running') setExpanded((v) => !v);
  };

  const trailing = proc.status === 'running'
    ? elapsedStr(proc.startedAt, now)
    : proc.status === 'queued'
      ? tx(t.monitor.queue_position, { position: (proc.queuePosition ?? 0) + 1 })
      : processStatusLabel(t, proc.status);

  return (
    <div className="border-t border-border/50 transition-colors first:border-t-0 hover:bg-secondary/30">
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start gap-2.5 rounded-none px-3 py-2.5 text-left"
        onClick={handleClick}
      >
        <span
          aria-hidden
          className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${M.dot} ${M.pulse ? 'animate-pulse motion-reduce:animate-none' : ''}`}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate typo-body text-foreground">
            {proc.label ?? proc.domain}
            {proc.runId && <span className="ml-1 typo-caption text-foreground">({proc.runId.slice(0, 8)})</span>}
          </span>
          {proc.lastEvent && (
            <span className="block truncate typo-caption text-foreground">{proc.lastEvent}</span>
          )}
        </span>
        <span className={`shrink-0 text-right typo-caption tabular-nums ${M.text}`}>{trailing}</span>
        {hasNav && <span aria-hidden className="ml-1 shrink-0 typo-caption text-primary">&rsaquo;</span>}
      </Button>
      {expanded && isExecution && (
        <div className="border-t border-border/50 bg-background/50">
          <ReasoningTrace entries={entries} isLive={isLive} startTime={proc.startedAt} />
          {proc.costUsd > 0 && (
            <p className="px-3 pb-2 typo-caption text-foreground">
              {tx(t.monitor.tool_calls, { count: proc.toolCallCount, cost: proc.costUsd.toFixed(4) })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** A plate's engraved head: title, count, and whatever the variant hangs right. */
export function PlateHead({
  title, count, children,
}: { title: string; count?: number; children?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2 border-b border-border/50 px-3 pb-1.5 pt-2">
      <span className="ae-engrave typo-label">{title}</span>
      {count != null && <span className="typo-caption tabular-nums text-foreground">{count}</span>}
      {children && <span className="ml-auto flex items-center gap-1.5">{children}</span>}
    </div>
  );
}
