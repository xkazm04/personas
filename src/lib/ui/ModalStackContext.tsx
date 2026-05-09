import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

interface ModalStackEntry {
  id: number;
}

interface ModalStackContextValue {
  register: () => { id: number; depth: number; total: number };
  unregister: (id: number) => void;
  getDepth: (id: number) => number;
  getTotal: () => number;
  isTopmost: (id: number) => boolean;
  subscribe: (listener: () => void) => () => void;
}

const ModalStackContext = createContext<ModalStackContextValue | null>(null);

export function ModalStackProvider({ children }: { children: ReactNode }) {
  const stackRef = useRef<ModalStackEntry[]>([]);
  const nextIdRef = useRef(1);
  const listenersRef = useRef<Set<() => void>>(new Set());

  const notify = useCallback(() => {
    for (const listener of listenersRef.current) listener();
  }, []);

  const register = useCallback(() => {
    const id = nextIdRef.current++;
    stackRef.current = [...stackRef.current, { id }];
    const depth = stackRef.current.length - 1;
    const total = stackRef.current.length;
    notify();
    return { id, depth, total };
  }, [notify]);

  const unregister = useCallback(
    (id: number) => {
      stackRef.current = stackRef.current.filter((entry) => entry.id !== id);
      notify();
    },
    [notify],
  );

  const getDepth = useCallback((id: number) => {
    return stackRef.current.findIndex((entry) => entry.id === id);
  }, []);

  const getTotal = useCallback(() => stackRef.current.length, []);

  const isTopmost = useCallback((id: number) => {
    const stack = stackRef.current;
    return stack.length > 0 && stack[stack.length - 1]!.id === id;
  }, []);

  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const value = useMemo<ModalStackContextValue>(
    () => ({ register, unregister, getDepth, getTotal, isTopmost, subscribe }),
    [register, unregister, getDepth, getTotal, isTopmost, subscribe],
  );

  return <ModalStackContext.Provider value={value}>{children}</ModalStackContext.Provider>;
}

interface ModalStackPosition {
  depth: number;
  total: number;
  isTopmost: boolean;
}

/**
 * Registers a modal in the stack while open. Returns its current depth (0 = bottom),
 * total stack size, and whether it is the topmost modal. Re-renders on stack changes
 * so progressive blur and Escape gating react when a sibling modal opens or closes.
 *
 * Returns null when no provider is mounted, so BaseModal can fall back to legacy
 * single-modal behaviour without crashing in tests or storybooks.
 */
export function useModalStackPosition(isOpen: boolean): ModalStackPosition | null {
  const context = useContext(ModalStackContext);
  const idRef = useRef<number | null>(null);
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!context || !isOpen) return;
    const { id } = context.register();
    idRef.current = id;
    return () => {
      context.unregister(id);
      idRef.current = null;
    };
  }, [context, isOpen]);

  useEffect(() => {
    if (!context) return;
    return context.subscribe(() => forceRender((n) => n + 1));
  }, [context]);

  if (!context || !isOpen || idRef.current == null) return null;

  const depth = context.getDepth(idRef.current);
  if (depth < 0) return null;
  return {
    depth,
    total: context.getTotal(),
    isTopmost: context.isTopmost(idRef.current),
  };
}
