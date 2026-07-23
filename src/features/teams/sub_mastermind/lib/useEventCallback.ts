// Stable-identity event callback: the returned function never changes identity
// across renders, but always invokes the LATEST closure passed in. Lets the
// canvas hand islands referentially-stable callbacks (so React.memo can skip
// them) without freezing the state those callbacks read. Standard React
// "useEvent" pattern; the ref is updated in a layout effect so a child that
// fires during commit still sees the current handler.
import { useCallback, useLayoutEffect, useRef } from 'react';

export function useEventCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
