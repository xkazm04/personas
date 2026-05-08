import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

export type AppKeyboardHandler = (event: KeyboardEvent) => boolean | void;

interface KeyboardRegistration {
  id: number;
  priority: number;
  handler: AppKeyboardHandler;
}

interface AppKeyboardContextValue {
  register: (handler: AppKeyboardHandler, priority?: number) => () => void;
}

const AppKeyboardContext = createContext<AppKeyboardContextValue | null>(null);

export function AppKeyboardProvider({ children }: { children: ReactNode }) {
  const handlersRef = useRef<KeyboardRegistration[]>([]);
  const nextIdRef = useRef(1);

  const register = useCallback((handler: AppKeyboardHandler, priority = 0) => {
    const registration: KeyboardRegistration = {
      id: nextIdRef.current++,
      priority,
      handler,
    };
    handlersRef.current = [...handlersRef.current, registration].sort(
      (a, b) => b.priority - a.priority || b.id - a.id,
    );

    return () => {
      handlersRef.current = handlersRef.current.filter((item) => item.id !== registration.id);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      for (const registration of handlersRef.current) {
        if (registration.handler(event) === true) {
          break;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const value = useMemo(() => ({ register }), [register]);

  return <AppKeyboardContext.Provider value={value}>{children}</AppKeyboardContext.Provider>;
}

export function useAppKeyboard(
  handler: AppKeyboardHandler,
  options?: { enabled?: boolean; priority?: number },
) {
  const context = useContext(AppKeyboardContext);
  const handlerRef = useRef(handler);
  const enabled = options?.enabled ?? true;
  const priority = options?.priority ?? 0;

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) return;

    const wrapped = (event: KeyboardEvent) => handlerRef.current(event);
    if (context) {
      return context.register(wrapped, priority);
    }

    window.addEventListener('keydown', wrapped);
    return () => window.removeEventListener('keydown', wrapped);
  }, [context, enabled, priority]);
}
