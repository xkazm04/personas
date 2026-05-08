import { classifyLine, type TerminalLineStyle } from '@/lib/utils/terminalColors';

export interface TerminalClassifierRequest {
  id: number;
  lines: string[];
}

export interface ClassifiedTerminalLine {
  line: string;
  style: TerminalLineStyle;
}

export interface TerminalClassifierResponse {
  id: number;
  lines: ClassifiedTerminalLine[];
}

const ANSI_ESCAPE_PATTERN = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  'g',
);

function normalizeLine(line: string): string {
  return line.replace(ANSI_ESCAPE_PATTERN, '');
}

self.onmessage = (event: MessageEvent<TerminalClassifierRequest>) => {
  const lines = event.data.lines.map((line) => {
    const normalized = normalizeLine(line);
    return {
      line: normalized,
      style: classifyLine(normalized),
    };
  });

  self.postMessage({ id: event.data.id, lines } satisfies TerminalClassifierResponse);
};
