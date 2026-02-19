import { useEffect, useRef, useState } from 'react';
import { TerminalHeader } from './TerminalHeader';
import { classifyLine, TERMINAL_STYLE_MAP } from '@/lib/utils/terminalColors';

interface ExecutionTerminalProps {
  lines: string[];
  isRunning: boolean;
  onStop?: () => void;
  executionId?: string | null;
}

export function ExecutionTerminal({ lines, isRunning, onStop }: ExecutionTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const [copied, setCopied] = useState(false);

  const handleCopyLog = async () => {
    await navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    if (terminalRef.current && shouldAutoScroll.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines.length]);

  const handleScroll = () => {
    if (terminalRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = terminalRef.current;
      const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 10;
      shouldAutoScroll.current = isAtBottom;
    }
  };

  return (
    <div className="border border-border/30 rounded-2xl overflow-hidden bg-background shadow-[0_0_30px_rgba(0,0,0,0.3)]">
      <TerminalHeader
        isRunning={isRunning}
        lineCount={lines.length}
        onCopy={handleCopyLog}
        copied={copied}
        onStop={onStop}
      />

      {/* Terminal Content */}
      <div
        ref={terminalRef}
        onScroll={handleScroll}
        className="max-h-[500px] overflow-y-auto text-sm bg-background font-mono"
      >
        {lines.length === 0 ? (
          <div className="p-6 text-muted-foreground/30 text-center">
            No output yet...
          </div>
        ) : (
          <div className="px-4 py-3">
            {lines.map((line, i) => {
              if (!line.trim()) return <div key={i} className="h-2" />;
              const style = classifyLine(line);
              return (
                <div key={i} className={`text-xs leading-5 whitespace-pre-wrap break-words ${TERMINAL_STYLE_MAP[style]}`}>
                  {line}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
