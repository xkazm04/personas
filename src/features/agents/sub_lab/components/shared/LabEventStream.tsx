import { useEffect, useState } from 'react';
import { ChevronDown, MessageSquare, Wrench, ArrowRight, Sparkles, CheckCircle2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { labGetResultEvents } from '@/api/agents/lab';
import type { LabResultEvent } from '@/lib/bindings/LabResultEvent';
import type { LabResultKind } from '@/lib/bindings/LabResultKind';

interface LabEventStreamProps {
  resultId: string;
  resultKind: LabResultKind;
}

interface ToolCallTiming {
  durationMs: number | null;
}

/** Pair each tool_use event with the next tool_result to derive a per-call duration. */
function deriveToolCallDurations(events: LabResultEvent[]): Map<number, ToolCallTiming> {
  const durations = new Map<number, ToolCallTiming>();
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    if (ev.eventType !== 'tool_use') continue;
    const next = events.slice(i + 1).find((e) => e.eventType === 'tool_result');
    durations.set(ev.eventIndex, {
      durationMs: next ? next.tsMsRelative - ev.tsMsRelative : null,
    });
  }
  return durations;
}

export function LabEventStream({ resultId, resultKind }: LabEventStreamProps) {
  const { t, tx } = useTranslation();
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<LabResultEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || events !== null || loading) return;
    setLoading(true);
    setError(null);
    labGetResultEvents(resultId, resultKind)
      .then((rows) => setEvents(rows))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [open, events, loading, resultId, resultKind]);

  const toolDurations = events ? deriveToolCallDurations(events) : new Map<number, ToolCallTiming>();

  return (
    <details
      className="group"
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="flex items-center gap-1.5 typo-label font-semibold text-foreground uppercase tracking-wider cursor-pointer hover:text-muted-foreground/80">
        <ChevronDown className="w-3 h-3 transition-transform group-open:rotate-180" />
        {t.agents.lab.event_stream}
      </summary>
      <div className="mt-2 rounded-card border border-primary/10 bg-background/50 max-h-[320px] overflow-y-auto">
        {loading && (
          <div className="px-3 py-3 typo-caption text-foreground">
            {t.agents.lab.event_stream_loading}
          </div>
        )}
        {error && !loading && (
          <div className="px-3 py-3 typo-caption text-red-400">
            {t.agents.lab.event_stream_failed}: {error}
          </div>
        )}
        {!loading && !error && events !== null && events.length === 0 && (
          <div className="px-3 py-3 typo-caption text-foreground">
            {t.agents.lab.event_stream_empty}
          </div>
        )}
        {!loading && !error && events && events.length > 0 && (
          <ol className="divide-y divide-primary/5">
            {events.map((ev) => (
              <EventRow
                key={ev.id}
                ev={ev}
                tool={toolDurations.get(ev.eventIndex)}
                tEventAssistant={t.agents.lab.event_assistant}
                tEventToolUse={t.agents.lab.event_tool_use}
                tEventToolResult={t.agents.lab.event_tool_result}
                tEventSystemInit={t.agents.lab.event_system_init}
                tEventResult={t.agents.lab.event_result}
                tArgsLabel={t.agents.lab.event_args_label}
                renderDuration={(ms) => tx(t.agents.lab.event_duration_ms, { ms })}
              />
            ))}
          </ol>
        )}
      </div>
    </details>
  );
}

interface EventRowProps {
  ev: LabResultEvent;
  tool: ToolCallTiming | undefined;
  tEventAssistant: string;
  tEventToolUse: string;
  tEventToolResult: string;
  tEventSystemInit: string;
  tEventResult: string;
  tArgsLabel: string;
  renderDuration: (ms: number) => string;
}

function EventRow({
  ev,
  tool,
  tEventAssistant,
  tEventToolUse,
  tEventToolResult,
  tEventSystemInit,
  tEventResult,
  tArgsLabel,
  renderDuration,
}: EventRowProps) {
  switch (ev.eventType) {
    case 'assistant_text':
      return (
        <li className="px-3 py-2.5 flex gap-2.5">
          <MessageSquare className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="typo-caption font-semibold text-foreground/90">{tEventAssistant}</span>
              <span className="typo-caption text-foreground tabular-nums">{renderDuration(ev.tsMsRelative)}</span>
            </div>
            <p className="typo-caption text-foreground whitespace-pre-wrap leading-relaxed">{ev.textPreview ?? ''}</p>
          </div>
        </li>
      );
    case 'tool_use':
      return (
        <li className="px-3 py-2.5 flex gap-2.5">
          <Wrench className="w-3.5 h-3.5 text-blue-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="typo-caption font-semibold text-foreground/90">{tEventToolUse}</span>
              <code className="typo-caption px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300/90">{ev.toolName ?? '?'}</code>
              <span className="typo-caption text-foreground tabular-nums">{renderDuration(ev.tsMsRelative)}</span>
              {tool?.durationMs != null && (
                <span className="typo-caption px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300/90 tabular-nums">
                  +{renderDuration(tool.durationMs)}
                </span>
              )}
            </div>
            {ev.toolArgsPreview && (
              <details>
                <summary className="typo-caption text-foreground cursor-pointer hover:text-foreground/80">{tArgsLabel}</summary>
                <pre className="mt-1 typo-caption text-foreground bg-background/40 rounded p-2 border border-primary/5 max-h-[120px] overflow-y-auto whitespace-pre-wrap">
                  {ev.toolArgsPreview}
                </pre>
              </details>
            )}
          </div>
        </li>
      );
    case 'tool_result':
      return (
        <li className="px-3 py-2.5 flex gap-2.5">
          <ArrowRight className="w-3.5 h-3.5 text-violet-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="typo-caption font-semibold text-foreground/90">{tEventToolResult}</span>
              <span className="typo-caption text-foreground tabular-nums">{renderDuration(ev.tsMsRelative)}</span>
            </div>
            {ev.toolResultPreview && (
              <pre className="typo-caption text-foreground bg-background/40 rounded p-2 border border-primary/5 max-h-[120px] overflow-y-auto whitespace-pre-wrap">
                {ev.toolResultPreview}
              </pre>
            )}
          </div>
        </li>
      );
    case 'system_init':
      return (
        <li className="px-3 py-2 flex items-center gap-2.5">
          <Sparkles className="w-3.5 h-3.5 text-foreground flex-shrink-0" />
          <span className="typo-caption text-foreground">{tEventSystemInit}</span>
          {ev.textPreview && <code className="typo-caption px-1.5 py-0.5 rounded bg-secondary/40 text-foreground">{ev.textPreview}</code>}
          <span className="ml-auto typo-caption text-foreground tabular-nums">{renderDuration(ev.tsMsRelative)}</span>
        </li>
      );
    case 'result':
      return (
        <li className="px-3 py-2 flex items-center gap-2.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
          <span className="typo-caption text-foreground">{tEventResult}</span>
          <span className="ml-auto typo-caption text-foreground tabular-nums">{renderDuration(ev.tsMsRelative)}</span>
        </li>
      );
    default:
      return null;
  }
}
