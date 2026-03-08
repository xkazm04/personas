import { createContext, useContext, useRef, type ReactNode, type MutableRefObject } from 'react';

const CanvasDragContext = createContext<MutableRefObject<string | null> | null>(null);

export function CanvasDragProvider({ children }: { children: ReactNode }) {
  const ref = useRef<string | null>(null);
  return <CanvasDragContext.Provider value={ref}>{children}</CanvasDragContext.Provider>;
}

export function useCanvasDragRef(): MutableRefObject<string | null> {
  const ctx = useContext(CanvasDragContext);
  if (!ctx) throw new Error('useCanvasDragRef must be used within CanvasDragProvider');
  return ctx;
}
