import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

type Politeness = 'polite' | 'assertive';

interface AriaLiveContextValue {
  announce: (message: string, politeness?: Politeness) => void;
}

const AriaLiveContext = createContext<AriaLiveContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Renders two screen-reader-only live regions (polite + assertive) at the app
 * root.  Components call `useAnnounce()` to push status messages without
 * requiring focus changes, satisfying WCAG 2.1 SC 4.1.3.
 */
export function AriaLiveProvider({ children }: { children: ReactNode }) {
  const [politeMessage, setPoliteMessage] = useState('');
  const [assertiveMessage, setAssertiveMessage] = useState('');

  // Toggle key forces the DOM node to re-render so screen readers pick up
  // duplicate consecutive messages.
  const keyRef = useRef(0);
  const [politeKey, setPoliteKey] = useState(0);
  const [assertiveKey, setAssertiveKey] = useState(0);

  const announce = useCallback((message: string, politeness: Politeness = 'polite') => {
    const key = ++keyRef.current;
    if (politeness === 'assertive') {
      setAssertiveMessage(message);
      setAssertiveKey(key);
    } else {
      setPoliteMessage(message);
      setPoliteKey(key);
    }
  }, []);

  // Register imperative handle so non-component code (store subscribers) can announce.
  useEffect(() => {
    _registerAnnounce(announce);
    return () => { _announce = null; };
  }, [announce]);

  return (
    <AriaLiveContext.Provider value={{ announce }}>
      {children}

      {/* Polite live region — read after current speech finishes */}
      <div
        key={`polite-${politeKey}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {politeMessage}
      </div>

      {/* Assertive live region — interrupts current speech */}
      <div
        key={`assertive-${assertiveKey}`}
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      >
        {assertiveMessage}
      </div>
    </AriaLiveContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Returns an `announce` function that pushes a status message to the app-wide
 * aria-live region.
 *
 * ```ts
 * const announce = useAnnounce();
 * announce("Design analysis complete", "polite");
 * announce("Credential test failed", "assertive");
 * ```
 */
export function useAnnounce(): (message: string, politeness?: Politeness) => void {
  const ctx = useContext(AriaLiveContext);
  if (!ctx) {
    throw new Error('useAnnounce must be used within <AriaLiveProvider>');
  }
  return ctx.announce;
}

// ---------------------------------------------------------------------------
// Standalone imperative API (for non-component code like store subscribers)
// ---------------------------------------------------------------------------

let _announce: ((message: string, politeness?: Politeness) => void) | null = null;

/** Called once by the provider to register the imperative handle. */
export function _registerAnnounce(fn: (message: string, politeness?: Politeness) => void) {
  _announce = fn;
}

/**
 * Imperative announce — works outside React components (e.g. store
 * subscribers).  No-ops silently if the provider hasn't mounted yet.
 */
export function announceImperative(message: string, politeness: Politeness = 'polite') {
  _announce?.(message, politeness);
}
