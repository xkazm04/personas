import { useEffect, useRef, useMemo } from 'react';
import { classifyLine, TERMINAL_STYLE_MAP } from '@/lib/utils/terminalColors';
import { RunningIcon } from '../components/ExecutionLifecycleIcons';
import { useTranslation } from '@/i18n/useTranslation';

/** Try to syntax-highlight a line if it contains JSON or protocol messages. */
function highlightLine(text: string): React.ReactNode {
  const trimmed = text.trim();

  // Detect JSON objects/arrays — protocol messages, tool calls, etc.
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const parsed = JSON.parse(trimmed);
      const pretty = JSON.stringify(parsed, null, 2);
      return <JsonHighlight json={pretty} />;
    } catch { /* not valid JSON, render as text */ }
  }

  // Detect inline JSON within text: "... {"key": ...} ..."
  const jsonMatch = text.match(/^(.*?)(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})(.*)$/);
  if (jsonMatch && jsonMatch[2]) {
    const before = jsonMatch[1] ?? '';
    const json = jsonMatch[2];
    const after = jsonMatch[3] ?? '';
    try {
      const parsed = JSON.parse(json);
      const pretty = JSON.stringify(parsed, null, 2);
      return (
        <>
          {before && <span>{before}</span>}
          <JsonHighlight json={pretty} />
          {after && <span>{after}</span>}
        </>
      );
    } catch { /* not valid JSON */ }
  }

  return text;
}

/** Token-level JSON syntax coloring */
function JsonHighlight({ json }: { json: string }) {
  const highlighted = useMemo(() => {
    return json.replace(
      /("(?:\\.|[^"\\])*")\s*:/g, '<k>$1</k>:'  // keys
    ).replace(
      /:\s*("(?:\\.|[^"\\])*")/g, ': <s>$1</s>'  // string values
    ).replace(
      /:\s*(true|false|null)\b/g, ': <b>$1</b>'  // booleans/null
    ).replace(
      /:\s*(-?\d+\.?\d*(?:e[+-]?\d+)?)\b/g, ': <n>$1</n>'  // numbers
    );
  }, [json]);

  // Parse the highlighted string into React elements
  const parts = useMemo(() => {
    const result: React.ReactNode[] = [];
    let remaining = highlighted;

    const tagMap: Record<string, string> = {
      k: 'text-sky-400',      // keys
      s: 'text-emerald-400',  // strings
      b: 'text-amber-400',    // booleans
      n: 'text-violet-400',   // numbers
    };

    while (remaining.length > 0) {
      const match = remaining.match(/<([ksnb])>(.*?)<\/\1>/);
      if (!match) {
        result.push(<span key={result.length} className="text-foreground">{remaining}</span>);
        break;
      }
      const before = remaining.slice(0, match.index);
      if (before) result.push(<span key={result.length} className="text-foreground">{before}</span>);
      result.push(<span key={result.length} className={tagMap[match[1] ?? 'k']}>{match[2]}</span>);
      remaining = remaining.slice((match.index || 0) + match[0].length);
    }
    return result;
  }, [highlighted]);

  return (
    <pre className="typo-caption leading-relaxed pl-2 border-l-2 border-primary/10 my-0.5 whitespace-pre-wrap">
      {parts}
    </pre>
  );
}

/** Replay terminal panel -- shows log lines up to current scrub position. */
export function ReplayTerminalPanel({
  visibleLines,
  totalLines,
}: {
  visibleLines: Array<{ index: number; text: string; timestamp_ms: number }>;
  totalLines: number;
}) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [visibleLines.length]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10">
        <RunningIcon size={14} className="opacity-60" />
        <span className="typo-heading text-foreground">{e.output_panel}</span>
        <span className="ml-auto typo-body tabular-nums text-foreground">
          {visibleLines.length}/{totalLines} lines
        </span>
      </div>
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 typo-code leading-relaxed"
      >
        {visibleLines.map((line) => {
          const style = classifyLine(line.text);
          const cls = TERMINAL_STYLE_MAP[style];
          const content = highlightLine(line.text);
          return (
            <div key={line.index} className={cls || 'text-foreground/90'}>
              {content || '\u00A0'}
            </div>
          );
        })}
        {visibleLines.length === 0 && (
          <div className="flex flex-col items-center justify-center py-6">
            <svg width="120" height="80" viewBox="0 0 120 80" fill="none" className="mb-3">
              <defs>
                <linearGradient id="rtp-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.5" />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.5" />
                </linearGradient>
              </defs>
              <line x1="15" y1="40" x2="105" y2="40" stroke="url(#rtp-grad)" strokeWidth="2" strokeLinecap="round" />
              <circle cx="25" cy="40" r="12" fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeOpacity="0.4" />
              <circle cx="25" cy="40" r="4" fill="#3b82f6" fillOpacity="0.2" />
              <circle cx="95" cy="40" r="12" fill="none" stroke="#8b5cf6" strokeWidth="1.5" strokeOpacity="0.4" />
              <circle cx="95" cy="40" r="4" fill="#8b5cf6" fillOpacity="0.2" />
              <circle cx="25" cy="30" r="1.5" fill="#3b82f6" fillOpacity="0.3" />
              <circle cx="25" cy="50" r="1.5" fill="#3b82f6" fillOpacity="0.3" />
              <circle cx="17" cy="40" r="1.5" fill="#3b82f6" fillOpacity="0.3" />
              <circle cx="33" cy="40" r="1.5" fill="#3b82f6" fillOpacity="0.3" />
              <circle cx="95" cy="30" r="1.5" fill="#8b5cf6" fillOpacity="0.3" />
              <circle cx="95" cy="50" r="1.5" fill="#8b5cf6" fillOpacity="0.3" />
              <circle cx="87" cy="40" r="1.5" fill="#8b5cf6" fillOpacity="0.3" />
              <circle cx="103" cy="40" r="1.5" fill="#8b5cf6" fillOpacity="0.3" />
              <rect x="42" y="35" width="2" height="10" rx="1" fill="#6366f1" fillOpacity="0.3" />
              <rect x="52" y="35" width="2" height="10" rx="1" fill="#6366f1" fillOpacity="0.25" />
              <rect x="62" y="35" width="2" height="10" rx="1" fill="#6366f1" fillOpacity="0.2" />
              <rect x="72" y="35" width="2" height="10" rx="1" fill="#6366f1" fillOpacity="0.15" />
              <path d="M55 20l-8 5 8 5" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.5" />
              <path d="M65 20l-8 5 8 5" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.35" />
            </svg>
            <span className="typo-body text-foreground">{e.scrub_forward}</span>
          </div>
        )}
      </div>
    </div>
  );
}
