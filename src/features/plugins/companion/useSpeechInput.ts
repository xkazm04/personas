import { useSystemStore } from '@/stores/systemStore';
import { useDictation, type DictationState } from './useDictation';
import { useLocalDictation } from './useLocalDictation';

/**
 * Engine-agnostic voice input. Returns whichever dictation implementation
 * the user selected (`companionSttEngine`): the browser Web Speech engine
 * (`'browser'`, default) or the local on-device whisper engine
 * (`'whisper'`). Both hooks are instantiated unconditionally (to satisfy the
 * rules of hooks) but the unselected one stays dormant — neither touches the
 * mic until its `start()` is called, and only the selected one is returned.
 */
export function useSpeechInput(args: { lang?: string } = {}): DictationState {
  const engine = useSystemStore((s) => s.companionSttEngine);
  const browser = useDictation(args);
  const local = useLocalDictation(args);
  return engine === 'whisper' ? local : browser;
}
