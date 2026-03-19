import { useRef, useEffect } from 'react';

// -- Shared line classification --

type LineStyle = 'error' | 'system' | 'success' | 'marker' | 'default';

const LINE_STYLES: Record<LineStyle, { text: string; dot: string }> = {
  error:   { text: 'text-red-400/80',     dot: 'bg-red-400' },
  system:  { text: 'text-amber-400/70',   dot: 'bg-amber-400' },
  success: { text: 'text-emerald-400/80', dot: 'bg-emerald-400' },
  marker:  { text: 'text-cyan-300/80',    dot: 'bg-cyan-400' },
  default: { text: 'text-blue-400/80',    dot: 'bg-blue-400/40' },
};

function classifyLine(line: string): LineStyle {
  const lower = line.toLowerCase();
  if (lower.includes('transform_questions') || lower.includes('transform_persona') || lower.includes('[milestone]')) return 'marker';
  if (lower.includes('error') || lower.includes('failed') || lower.includes('failure') || lower.includes('[warn]')) return 'error';
  if (lower.includes('[system]') || lower.includes('starting') || lower.includes('initializing')) return 'system';
  if (lower.includes('complete') || lower.includes('success') || lower.includes('finished') || lower.includes('done') || lower.includes('\u2713')) return 'success';
  return 'default';
}

interface TerminalBodyProps {
  lines: string[];
}

export function useTerminalScroll(lines: string[]) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  useEffect(() => {
    if (terminalRef.current && shouldAutoScroll.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines]);

  const handleTerminalScroll = () => {
    if (terminalRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = terminalRef.current;
      shouldAutoScroll.current = Math.abs(scrollHeight - clientHeight - scrollTop) < 10;
    }
  };

  return { terminalRef, handleTerminalScroll };
}

export function TerminalBody({ lines }: TerminalBodyProps) {
  return (
    <>
      {lines.length === 0 ? (
        <div className="p-4 text-muted-foreground/80 text-center typo-body">No output yet...</div>
      ) : (
        <div className="p-3">
          {lines.map((line, index) => {
            const style = classifyLine(line);
            const colors = LINE_STYLES[style];
            return (
              <div key={index} className="flex items-start gap-2 py-px">
                <span className="text-muted-foreground/20 select-none flex-shrink-0 w-8 text-right">
                  {(index + 1).toString().padStart(3, ' ')}
                </span>
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-[5px] ${colors.dot}`} />
                <span className={`${colors.text} break-all`}>{line}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
