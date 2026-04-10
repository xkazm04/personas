import { useEffect, useRef, useState } from "react";
import type { ReasoningEntry } from "@/hooks/execution/useReasoningTrace";

interface ReasoningTraceProps {
  entries: ReasoningEntry[];
  isLive: boolean;
  startTime?: number;
}

function relativeTs(ts: number, base: number): string {
  const delta = Math.max(0, Math.round((ts - base) / 1000));
  const m = Math.floor(delta / 60);
  const s = delta % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function ExpandableText({ text, maxLen = 120 }: { text: string; maxLen?: number }) {
  const [expanded, setExpanded] = useState(false);
  if (text.length <= maxLen) return <span className="text-foreground">{text}</span>;
  return (
    <span
      className="text-foreground cursor-pointer hover:text-foreground"
      onClick={() => setExpanded((v) => !v)}
    >
      {expanded ? text : `${text.slice(0, maxLen)}...`}
    </span>
  );
}

function EntryRenderer({ entry, baseTime }: { entry: ReasoningEntry; baseTime: number }) {
  const ts = relativeTs(entry.ts, baseTime);

  switch (entry.type) {
    case "init":
      return (
        <div className="flex items-start gap-2 py-1">
          <span className="text-blue-400 shrink-0">{"\u25CF"}</span>
          <div className="min-w-0 flex-1">
            <span className="typo-caption font-medium">System Init</span>
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
            <span className="font-medium">Reasoning</span>
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
            <span className="font-medium">Tool Call: {entry.toolName}</span>
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
            <span className="font-medium">Result</span>
            <div className="mt-0.5">
              <ExpandableText text={entry.contentPreview} maxLen={80} />
            </div>
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
            Elapsed {Math.round(entry.elapsed / 1000)}s (silent {Math.round(entry.silence / 1000)}s)
          </span>
          <span className="typo-caption text-foreground ml-auto shrink-0">{ts}</span>
        </div>
      );

    case "complete":
      return (
        <div className="flex items-start gap-2 py-1">
          <span className="text-green-400 shrink-0">{"\u25CF"}</span>
          <div className="min-w-0 flex-1 typo-caption">
            <span className="font-medium">Complete</span>
            <span className="text-foreground ml-2">
              {(entry.durationMs / 1000).toFixed(1)}s
              {entry.cost != null && ` \u00B7 $${entry.cost.toFixed(4)}`}
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
            <span className="font-medium text-red-400">Error</span>
            <span className="text-red-400 ml-2">{entry.message}</span>
          </div>
          <span className="typo-caption text-foreground shrink-0">{ts}</span>
        </div>
      );
  }
}

export default function ReasoningTrace({ entries, isLive, startTime }: ReasoningTraceProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  const baseTime = startTime ?? (entries.length > 0 ? entries[0]!.ts : Date.now());

  // Auto-scroll to bottom when live
  useEffect(() => {
    if (!isLive || userScrolledUp.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length, isLive]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    userScrolledUp.current = !atBottom;
  };

  if (entries.length === 0) {
    return (
      <div className="px-3 py-4 typo-caption text-foreground text-center">
        Waiting for execution events...
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="max-h-[300px] overflow-y-auto px-3 py-1 space-y-0.5"
    >
      {entries.map((entry, i) => (
        <EntryRenderer key={i} entry={entry} baseTime={baseTime} />
      ))}
    </div>
  );
}
