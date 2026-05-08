import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';

export function useEditorKeyboard(undo: () => void, redo: () => void) {
  useAppKeyboard((e) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return false;

    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        redo();
      } else {
        undo();
      }
      return true;
    }

    return false;
  }, { priority: 10 });
}
