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
  /** See {@link AppKeyboardOptions.exclusive}. */
  exclusive: boolean;
  handler: AppKeyboardHandler;
}

interface AppKeyboardContextValue {
  register: (handler: AppKeyboardHandler, priority?: number, exclusive?: boolean) => () => void;
}

const AppKeyboardContext = createContext<AppKeyboardContextValue | null>(null);

/**
 * The app's priority ladder, in one place so a new binding can be placed
 * deliberately rather than by guessing a number:
 *
 * | 100 | dev-only mobile-preview toggle                          |
 * |  90 | CommandPalette (mod+K must open from anywhere)          |
 * |  80 | BaseModal (Escape / Tab focus cycling)                  |
 * |  70 | TriageDeck — EXCLUSIVE, a full-app decision surface     |
 * |  30 | KeyboardNavMode (`;` mode + Back)                       |
 * |  29 | TitleBarDock hint keys (only while nav mode is armed)   |
 * |  20 | ShortcutCheatSheet (`?`)                                |
 * |  15 | WorkspaceShortcuts                                      |
 * |  10 | route-level decision surfaces (review flow, backlog     |
 * |     | deck, Athena's `;`-leader digits)                       |
 * |   0 | default                                                 |
 */
export function AppKeyboardProvider({ children }: { children: ReactNode }) {
  const handlersRef = useRef<KeyboardRegistration[]>([]);
  const nextIdRef = useRef(1);

  const register = useCallback((handler: AppKeyboardHandler, priority = 0, exclusive = false) => {
    const registration: KeyboardRegistration = {
      id: nextIdRef.current++,
      priority,
      exclusive,
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
        // An EXCLUSIVE surface owns the keyboard for everything beneath it,
        // whether or not it recognised this particular key. Priority alone only
        // decides who sees a key FIRST — it cannot stop a key the top surface
        // ignores from reaching a route that is still mounted underneath, which
        // is how one press could decide two rows (a triage verdict in front and
        // a backlog verdict behind an opaque overlay). Handlers ABOVE the
        // exclusive one still run: a modal opened on top of it must keep its
        // Escape and its focus trap.
        if (registration.exclusive) {
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

/**
 * Where a surface that belongs to the CURRENT ROUTE registers — a focus flow, a
 * swipe deck, an inbox cursor. Above the default so a route's own bindings beat
 * incidental ones, and far below every overlay, because anything mounted over
 * the route is what the user is actually looking at.
 */
export const ROUTE_DECISION_PRIORITY = 10;

/**
 * Where a transient overlay (a modal, an anchored popover) registers its own
 * dismiss keys — BaseModal's rung on the ladder. A surface mounted over
 * everything else must also win the keyboard over everything else.
 */
export const OVERLAY_DISMISS_PRIORITY = 80;

/** The notepad full-screen layer. Deliberately BELOW `OVERLAY_DISMISS_PRIORITY`
 *  so a BaseModal / ConfirmDialog raised from inside the notepad takes Escape
 *  first, and above the route-level decision handlers it covers. */
export const NOTEPAD_LAYER_PRIORITY = 60;

export interface AppKeyboardOptions {
  enabled?: boolean;
  /** Higher runs first. See the ladder above {@link AppKeyboardProvider}. */
  priority?: number;
  /**
   * Swallow every key this handler does not consume, so nothing registered at a
   * lower priority ever sees it. For full-app surfaces that decide something —
   * anything mounted underneath them is invisible, and an invisible surface
   * must not be able to act on a keystroke.
   *
   * Only honoured inside an {@link AppKeyboardProvider}; the bare-window
   * fallback below has no registry to gate.
   */
  exclusive?: boolean;
}

export function useAppKeyboard(handler: AppKeyboardHandler, options?: AppKeyboardOptions) {
  const context = useContext(AppKeyboardContext);
  const handlerRef = useRef(handler);
  const enabled = options?.enabled ?? true;
  const priority = options?.priority ?? 0;
  const exclusive = options?.exclusive ?? false;

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) return;

    const wrapped = (event: KeyboardEvent) => handlerRef.current(event);
    if (context) {
      return context.register(wrapped, priority, exclusive);
    }

    window.addEventListener('keydown', wrapped);
    return () => window.removeEventListener('keydown', wrapped);
  }, [context, enabled, priority, exclusive]);
}
