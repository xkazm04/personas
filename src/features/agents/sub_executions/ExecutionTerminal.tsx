import { TerminalHeader } from '@/features/shared/components/TerminalHeader';
import { TerminalSearchBar, useTerminalFilter } from '@/features/shared/components/TerminalSearchBar';
import { TerminalBody } from '@/features/shared/components/TerminalBody';
import { useCopyToClipboard } from '@/hooks/utility/useCopyToClipboard';

interface ExecutionTerminalProps {
  lines: string[];
  isRunning: boolean;
  onStop?: () => void;
}

export function ExecutionTerminal({ lines, isRunning, onStop }: ExecutionTerminalProps) {
  const { copied, copy: copyToClipboard } = useCopyToClipboard();
  const { filter, setFilter, isLineVisible, isFiltering } = useTerminalFilter();

  const handleCopyLog = () => copyToClipboard(lines.join('\n'));

  return (
    <div className="border border-border/30 rounded-2xl overflow-hidden bg-background shadow-[0_0_30px_rgba(0,0,0,0.3)]">
      <TerminalHeader
        isRunning={isRunning}
        lineCount={lines.length}
        onCopy={handleCopyLog}
        copied={copied}
        onStop={onStop}
      />

      <TerminalSearchBar filter={filter} onChange={setFilter} />

      <TerminalBody
        lines={lines}
        isRunning={isRunning}
        isLineVisible={isLineVisible}
        isFiltering={isFiltering}
      />
    </div>
  );
}
