import { useEffect, useRef, useState } from 'react';
import { classifyLine } from '@/lib/utils/terminalColors';
import type { TerminalLineStyle } from '@/lib/utils/terminalColors';
import type {
  ClassifiedTerminalLine,
  TerminalClassifierResponse,
} from '@/workers/terminal-classifier';

const ANSI_ESCAPE_PATTERN = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  'g',
);

function classifySynchronously(lines: string[]): ClassifiedTerminalLine[] {
  return lines.map((line) => {
    const normalized = line.replace(ANSI_ESCAPE_PATTERN, '');
    return {
      line: normalized,
      style: classifyLine(normalized) as TerminalLineStyle,
    };
  });
}

function createWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('../../workers/terminal-classifier.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    return null;
  }
}

export function useTerminalClassification(lines: string[]): ClassifiedTerminalLine[] {
  const [classified, setClassified] = useState<ClassifiedTerminalLine[]>(() =>
    classifySynchronously(lines),
  );
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (lines.length === 0) {
      setClassified([]);
      return;
    }

    if (!workerRef.current) {
      workerRef.current = createWorker();
    }

    const worker = workerRef.current;
    if (!worker) {
      setClassified(classifySynchronously(lines));
      return;
    }

    const requestId = ++requestIdRef.current;
    let rafId: number | null = requestAnimationFrame(() => {
      rafId = null;
      worker.postMessage({ id: requestId, lines });
    });

    const handleMessage = (event: MessageEvent<TerminalClassifierResponse>) => {
      if (event.data.id !== requestIdRef.current) return;
      setClassified(event.data.lines);
    };

    const handleError = () => {
      worker.terminate();
      workerRef.current = null;
      setClassified(classifySynchronously(lines));
    };

    worker.addEventListener('message', handleMessage);
    worker.addEventListener('error', handleError, { once: true });

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
    };
  }, [lines]);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  return classified;
}
