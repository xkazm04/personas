import { useState } from "react";
import type { ReasoningEntry } from "@/hooks/execution/useReasoningTrace";
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';

function relativeTs(ts: number, base: number): string {
  const delta = Math.max(0, Math.round((ts - base) / 1000));
  const m = Math.floor(delta / 60);
  const s = delta % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function ExpandableText({ text, maxLen = 120 }: { text: string; maxLen?: number }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (text.length <= maxLen) return <span className="text-foreground">{text}</span>;
  // A real button, not a <span onClick>: the disclosure has to be reachable by
  // keyboard and to announce its state, which a span never did.
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={expanded ? t.shared.reasoning_trace.show_less : t.shared.reasoning_trace.show_more}
      className="text-left text-foreground cursor-pointer hover:text-foreground"
      onClick={() => setExpanded((v) => !v)}
    >
      {expanded ? text : `${text.slice(0, maxLen)}...`}
    </button>
  );
}

export function EntryRenderer({ entry, baseTime }: { entry: ReasoningEntry; baseTime: number }) {
  const { t } = useTranslation();
  const ts = relativeTs(entry.ts, baseTime);

  switch (entry.type) {
    case "init":
      return (
        <div className="flex items-start gap-2 py-1">
          <span className="text-blue-400 shrink-0">{"\u25CF"}</span>
          <div className="min-w-0 flex-1">
            <span className="typo-caption">{t.shared.reasoning_trace.system_init}</span>
            <span className="typo-caption text-foreground ml-2">{entry.model}</span>
            {entry.sessionId != null && (
              <span className="typo-caption text-foreground ml-1">({String(entry.sessionId).slice(0, 8)})</span>
            )}
          </div>
          <span className="typo-caption text-foreground shrink-0">{ts}</span>
        </div>
      );

    case "text":
      return (
        <div className="flex items-start gap-2 py-1">
          <span className="text-purple-400 shrink-0">{"\u25C6"}</span>
          <div className="min-w-0 flex-1 typo-caption">
            <span className="font-medium">{t.shared.reasoning_trace.reasoning}</span>
            <div className="mt-0.5">
              <ExpandableText text={entry.content.split("\n")[0] ?? ""} />
            </div>
          </div>
          <span className="typo-caption text-foreground shrink-0">{ts}</span>
        </div>
      );

    case "tool_call":
      return (
        <div className="flex items-start gap-2 py-1">
          <span className="text-green-400 shrink-0">{"\u25B6"}</span>
          <div className="min-w-0 flex-1 typo-caption">
            <span className="font-medium">{t.shared.reasoning_trace.tool_call_label} {entry.toolName}</span>
            <div className="mt-0.5">
              <ExpandableText text={entry.inputPreview} maxLen={80} />
            </div>
          </div>
          <span className="typo-caption text-foreground shrink-0">{ts}</span>
        </div>
      );

    case "tool_result":
      return (
        <div className="flex items-start gap-2 py-1">
          <span className="text-yellow-400 shrink-0">{"\u25C0"}</span>
          <div className="min-w-0 flex-1 typo-caption">
            <span className="font-medium">{t.shared.reasoning_trace.result}</span>
            <div className="mt-0.5">
              <ExpandableText text={entry.contentPreview} maxLen={80} />
            </div>
          </div>
          <span className="typo-caption text-foreground shrink-0">{ts}</span>
        </div>
      );

    case "file_change":
      return (
        <div className="flex items-start gap-2 py-1">
          <span className={`shrink-0 ${entry.changeType === 'read' ? 'text-blue-400' : 'text-orange-400'}`}>{entry.changeType === 'read' ? '\u25CB' : '\u25CF'}</span>
          <div className="min-w-0 flex-1 typo-caption">
            <span className="font-medium capitalize">{entry.changeType}</span>
            <span className="text-foreground ml-1.5 truncate">{entry.path.split('/').pop()}</span>
          </div>
          <span className="typo-caption text-foreground shrink-0">{ts}</span>
        </div>
      );

    case "heartbeat":
      if (entry.silence < 10_000) return null;
      return (
        <div className="flex items-center gap-2 py-0.5 opacity-50">
          <span className="text-foreground shrink-0">{"\u2022"}</span>
          <span className="typo-caption text-foreground">
            {Math.round(entry.elapsed / 1000)}{t.shared.reasoning_trace.heartbeat_silent} {Math.round(entry.silence / 1000)}s)
          </span>
          <span className="typo-caption text-foreground ml-auto shrink-0">{ts}</span>
        </div>
      );

    case "complete":
      return (
        <div className="flex items-start gap-2 py-1">
          <span className="text-green-400 shrink-0">{"\u25CF"}</span>
          <div className="min-w-0 flex-1 typo-caption">
            <span className="font-medium">{t.shared.reasoning_trace.complete}</span>
            <span className="text-foreground ml-2">
              <Numeric value={entry.durationMs / 1000} precision={1} />s
              {entry.cost != null && (
                <>
                  {' \u00B7 $'}
                  <Numeric value={entry.cost} precision={4} />
                </>
              )}
              {entry.tokens != null && ` \u00B7 ${entry.tokens} tokens`}
            </span>
          </div>
          <span className="typo-caption text-foreground shrink-0">{ts}</span>
        </div>
      );

    case "error":
      return (
        <div className="flex items-start gap-2 py-1">
          <span className="text-red-400 shrink-0">{"\u2717"}</span>
          <div className="min-w-0 flex-1 typo-caption">
            <span className="font-medium text-red-400">{t.shared.reasoning_trace.error}</span>
            <span className="text-red-400 ml-2">{entry.message}</span>
          </div>
          <span className="typo-caption text-foreground shrink-0">{ts}</span>
        </div>
      );
  }
}

