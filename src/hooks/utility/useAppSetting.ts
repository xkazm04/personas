import { useState, useEffect, useCallback } from 'react';
import { deleteAppSetting, getAppSetting, setAppSetting } from '@/api/settings';

interface UseAppSettingResult {
  value: string;
  setValue: (v: string) => void;
  save: () => Promise<void>;
  loaded: boolean;
  saved: boolean;
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

  useEffect(() => {
    getAppSetting(key)
      .then((val) => {
        if (val) {
          if (validate && !validate(val)) {
            console.warn(`App setting "${key}" failed validation, using default`);
            setValueRaw(defaultValue);
          } else {
            setValueRaw(val);
          }
        }
      })
      .catch((err) => {
        console.error(`Failed to load app setting "${key}":`, err);
      })
      .finally(() => setLoaded(true));
  }, [key]);

  const setValue = useCallback((v: string) => {
    setValueRaw(v);
    setSaved(false);
  }, []);

  const save = useCallback(async () => {
    const trimmed = value.trim();
    if (trimmed) {
      await setAppSetting(key, trimmed);
    } else {
      await deleteAppSetting(key);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [key, value]);

  return { value, setValue, save, loaded, saved };
}
