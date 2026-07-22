import { useState, useEffect, useCallback, useRef } from 'react';
import { deleteAppSetting, setAppSetting } from '@/api/system/settings';
import { getAppSettingCoalesced } from '@/hooks/utility/data/useSettings';
import { createLogger } from '@/lib/log';

const logger = createLogger('app-setting');

interface UseAppSettingResult {
  value: string;
  setValue: (v: string) => void;
  save: () => Promise<void>;
  loaded: boolean;
  saved: boolean;
  error: string | null;
}

/**
 * Load and persist a single app setting by key.
 * Handles load-on-mount, save-with-feedback, and error handling.
 *
 * @param validate - Optional validator. If provided, loaded values that fail
 *   validation are discarded and `defaultValue` is used instead.
 */
export function useAppSetting(
  key: string,
  defaultValue = '',
  validate?: (value: string) => boolean,
): UseAppSettingResult {
  const [value, setValueRaw] = useState(defaultValue);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  // `validate`/`defaultValue` are configuration, not data deps: callers pass
  // inline closures, and depending on them re-ran the load on every render —
  // one IPC probe per render AND setValueRaw clobbering the user's unsaved
  // edits whenever the promise resolved. Latch them in refs and load per key.
  const validateRef = useRef(validate);
  validateRef.current = validate;
  const defaultValueRef = useRef(defaultValue);
  defaultValueRef.current = defaultValue;

  useEffect(() => {
    getAppSettingCoalesced(key)
      .then((val) => {
        if (val) {
          const validateFn = validateRef.current;
          if (validateFn && !validateFn(val)) {
            logger.warn('App setting failed validation, using default', { key });
            setValueRaw(defaultValueRef.current);
          } else {
            setValueRaw(val);
          }
        }
      })
      .catch((err) => {
        logger.error('Failed to load app setting', { key, err: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => setLoaded(true));
  }, [key]);

  const setValue = useCallback((v: string) => {
    setValueRaw(v);
    setSaved(false);
  }, []);

  const save = useCallback(async () => {
    setError(null);
    try {
      const trimmed = valueRef.current.trim();
      if (trimmed) {
        await setAppSetting(key, trimmed);
      } else {
        await deleteAppSetting(key);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Failed to save app setting', { key, err: message });
      setError(message);
    }
  }, [key]);

  return { value, setValue, save, loaded, saved, error };
}
