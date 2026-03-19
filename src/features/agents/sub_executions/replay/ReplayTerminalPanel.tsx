import { useEffect, useRef } from 'react';
import { classifyLine, TERMINAL_STYLE_MAP } from '@/lib/utils/terminalColors';
import { RunningIcon } from '../components/ExecutionLifecycleIcons';

/** Replay terminal panel -- shows log lines up to current scrub position. */
export function ReplayTerminalPanel({
  visibleLines,
  totalLines,
}: {
  visibleLines: Array<{ index: number; text: string; timestamp_ms: number }>;
  totalLines: number;
}) {
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
        <span className="typo-heading text-muted-foreground/70">Output</span>
        <span className="ml-auto typo-body tabular-nums text-muted-foreground/60">
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
          return (
            <div key={line.index} className={cls || 'text-foreground/90'}>
              {line.text || '\u00A0'}
            </div>
          );
        })}
        {visibleLines.length === 0 && (
          <div className="flex flex-col items-center justify-center py-6">
            {/* Film-reel / timeline rewind illustration */}
            <svg width="120" height="80" viewBox="0 0 120 80" fill="none" className="mb-3">
              <defs>
                <linearGradient id="rtp-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.5" />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.5" />
                </linearGradient>
              </defs>
              {/* Timeline track */}
              <line x1="15" y1="40" x2="105" y2="40" stroke="url(#rtp-grad)" strokeWidth="2" strokeLinecap="round" />
              {/* Film reel circles */}
              <circle cx="25" cy="40" r="12" fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeOpacity="0.4" />
              <circle cx="25" cy="40" r="4" fill="#3b82f6" fillOpacity="0.2" />
              <circle cx="95" cy="40" r="12" fill="none" stroke="#8b5cf6" strokeWidth="1.5" strokeOpacity="0.4" />
              <circle cx="95" cy="40" r="4" fill="#8b5cf6" fillOpacity="0.2" />
              {/* Sprocket holes on reels */}
              <circle cx="25" cy="30" r="1.5" fill="#3b82f6" fillOpacity="0.3" />
              <circle cx="25" cy="50" r="1.5" fill="#3b82f6" fillOpacity="0.3" />
              <circle cx="17" cy="40" r="1.5" fill="#3b82f6" fillOpacity="0.3" />
              <circle cx="33" cy="40" r="1.5" fill="#3b82f6" fillOpacity="0.3" />
              <circle cx="95" cy="30" r="1.5" fill="#8b5cf6" fillOpacity="0.3" />
              <circle cx="95" cy="50" r="1.5" fill="#8b5cf6" fillOpacity="0.3" />
              <circle cx="87" cy="40" r="1.5" fill="#8b5cf6" fillOpacity="0.3" />
              <circle cx="103" cy="40" r="1.5" fill="#8b5cf6" fillOpacity="0.3" />
              {/* Frame markers along timeline */}
              <rect x="42" y="35" width="2" height="10" rx="1" fill="#6366f1" fillOpacity="0.3" />
              <rect x="52" y="35" width="2" height="10" rx="1" fill="#6366f1" fillOpacity="0.25" />
              <rect x="62" y="35" width="2" height="10" rx="1" fill="#6366f1" fillOpacity="0.2" />
              <rect x="72" y="35" width="2" height="10" rx="1" fill="#6366f1" fillOpacity="0.15" />
              {/* Rewind arrow */}
              <path d="M55 20l-8 5 8 5" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.5" />
              <path d="M65 20l-8 5 8 5" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.35" />
            </svg>
            <span className="typo-body text-muted-foreground/50">Scrub forward to see output...</span>
          </div>
        )}
      </div>
    </div>
  );
}
