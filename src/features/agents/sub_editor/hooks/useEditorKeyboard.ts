import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';

export function useEditorKeyboard(undo: () => void, redo: () => void) {
  useAppKeyboard((e) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return false;

    // Shift capitalises the key: Ctrl+Shift+Z arrives as 'Z', so an exact
    // 'z' comparison meant redo could never fire from the keyboard.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
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
