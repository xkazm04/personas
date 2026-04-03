import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { storeBus } from '@/lib/storeBus';

export type CredentialNavKey = 'credentials' | 'from-template' | 'add-new' | 'databases' | 'graph';

type NavigateHandler = ((key: CredentialNavKey) => void) | null;

interface CredentialNavContextValue {
  currentKey: CredentialNavKey;
  setCurrentKey: (key: CredentialNavKey) => void;
  navigate: (key: CredentialNavKey) => void;
  setNavigateHandler: (handler: NavigateHandler) => void;
}

const CredentialNavContext = createContext<CredentialNavContextValue | null>(null);

export function CredentialNavProvider({ children }: { children: ReactNode }) {
  const [currentKey, setCurrentKey] = useState<CredentialNavKey>('credentials');
  const [pendingKey, setPendingKey] = useState<CredentialNavKey | null>(null);
  const navigateHandlerRef = useRef<NavigateHandler>(null);

  const setNavigateHandler = useCallback((handler: NavigateHandler) => {
    navigateHandlerRef.current = handler;
    if (handler && pendingKey) {
      handler(pendingKey);
      setPendingKey(null);
    }
  }, [pendingKey]);

  const navigate = useCallback((key: CredentialNavKey) => {
    setCurrentKey(key);
    const handler = navigateHandlerRef.current;
    if (handler) {
      handler(key);
      return;
    }
    setPendingKey(key);
  }, []);

  const value = useMemo<CredentialNavContextValue>(() => ({
    currentKey,
    setCurrentKey,
    navigate,
    setNavigateHandler,
  }), [currentKey, navigate, setNavigateHandler]);

  // Listen for tour navigation requests from outside the provider tree
  useEffect(() => {
    const unsub = storeBus.on('tour:navigate-credential-view', ({ key }) => {
      navigate(key as CredentialNavKey);
    });
    return unsub;
  }, [navigate]);

  return (
    <CredentialNavContext.Provider value={value}>
      {children}
    </CredentialNavContext.Provider>
  );
}

export function useCredentialNav() {
  const ctx = useContext(CredentialNavContext);
  if (ctx) return ctx;

  return {
    currentKey: 'credentials' as CredentialNavKey,
    setCurrentKey: () => {},
    navigate: () => {},
    setNavigateHandler: () => {},
  };
}
