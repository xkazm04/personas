import { useState, useCallback } from 'react';

/**
 * Generic modal stack hook that replaces independent useState pairs for
 * multiple modals with a single stack supporting open/close/replace.
 *
 * The stack handles Z-ordering (most recent on top) and typed lookups.
 * New modals only need a type discriminant added to the entry union —
 * zero new state variables or handlers in the parent component.
 *
 * @example
 * type MyModal =
 *   | { type: 'detail'; item: Item }
 *   | { type: 'create' };
 *
 * const modals = useModalStack<MyModal>();
 * modals.open({ type: 'detail', item });
 * modals.isOpen('detail');          // true
 * modals.find('detail')?.item;      // Item
 * modals.close('detail');
 */
export function useModalStack<E extends { type: string }>() {
  const [stack, setStack] = useState<E[]>([]);

  /** Push a new modal onto the stack. */
  const open = useCallback((entry: E) => {
    setStack((prev) => [...prev, entry]);
  }, []);

  /**
   * Close a modal.
   * - If `type` is given, removes the most recent entry of that type.
   * - If omitted, pops the top of the stack.
   */
  const close = useCallback((type?: E['type']) => {
    setStack((prev) => {
      if (type) {
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i]!.type === type) {
            return [...prev.slice(0, i), ...prev.slice(i + 1)];
          }
        }
        return prev;
      }
      return prev.slice(0, -1);
    });
  }, []);

  /** Replace the top entry with a new one (useful for modal transitions). */
  const replace = useCallback((entry: E) => {
    setStack((prev) => (prev.length > 0 ? [...prev.slice(0, -1), entry] : [entry]));
  }, []);

  /** Close every modal in the stack. */
  const closeAll = useCallback(() => setStack([]), []);

  return {
    stack,
    open,
    close,
    replace,
    closeAll,
    /** Find the most recent entry of a given type (or undefined). */
    find: <T extends E['type']>(type: T) =>
      stack.find((e) => e.type === type) as Extract<E, { type: T }> | undefined,
    /** Whether any entry of the given type is on the stack. */
    isOpen: (type: E['type']) => stack.some((e) => e.type === type),
    /** The topmost entry, or undefined if the stack is empty. */
    top: stack[stack.length - 1] as E | undefined,
  };
}
