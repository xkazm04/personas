import { useCallback, useEffect, useRef } from 'react';

export function useRafCoalescedCallback<T extends unknown[]>(
  callback: (...args: T) => void,
) {
  const callbackRef = useRef(callback);
  const frameRef = useRef<number | null>(null);
  const argsRef = useRef<T | null>(null);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => () => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
    }
  }, []);

  return useCallback((...args: T) => {
    argsRef.current = args;
    if (frameRef.current !== null) return;

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const latestArgs = argsRef.current;
      argsRef.current = null;
      if (latestArgs) {
        callbackRef.current(...latestArgs);
      }
    });
  }, []);
}
