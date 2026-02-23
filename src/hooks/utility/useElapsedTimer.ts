import { useState, useEffect, useRef } from 'react';

/**
 * Tracks elapsed milliseconds while `isRunning` is true.
 * Starts a fresh timer each time `isRunning` flips to true.
 * Retains the last elapsed value when `isRunning` flips to false.
 */
export function useElapsedTimer(isRunning: boolean, intervalMs = 1000): number {
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef(0);

  useEffect(() => {
    if (!isRunning) return;
    startTimeRef.current = Date.now();
    setElapsed(0);
    const id = setInterval(() => {
      setElapsed(Date.now() - startTimeRef.current);
    }, intervalMs);
    return () => clearInterval(id);
  }, [isRunning, intervalMs]);

  return elapsed;
}
