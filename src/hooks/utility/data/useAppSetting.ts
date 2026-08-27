import { useState, useEffect, useCallback, useRef } from 'react';
import { deleteAppSetting, setAppSetting } from '@/api/system/settings';
import { getAppSettingCoalesced } from '@/hooks/utility/data/useSettings';
import { createLogger } from '@/lib/log';
import { silentCatch } from '@/lib/silentCatch';

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

  // A key change starts a NEW load: the previous key's value must not stay on
  // screen (callers switch keys live — `ProviderCredentialField` swaps
  // `field.settingKey` when the provider changes, which showed the previous
  // provider's stored credential until the new read resolved), `loaded` must
  // go back to false so consumers don't treat the stale value as settled, and
  // a late response for the superseded key must not clobber the new one.
  // Tauri `invoke` has no abort, so the `cancelled` flag is the cancellation.
  const isFirstLoadRef = useRef(true);
  useEffect(() => {
    let cancelled = false;

    if (!isFirstLoadRef.current) {
      setValueRaw(defaultValueRef.current);
      setLoaded(false);
      setError(null);
      setSaved(false);
    }
    isFirstLoadRef.current = false;

    // An empty key is "no setting to read" (callers pass `field?.key ?? ''`).
    // Sending it would put an unregistered key in the shared bulk batch, which
    // the backend answers with null plus a warn breadcrumb.
    if (!key) {
      setLoaded(true);
      return;
    }

    getAppSettingCoalesced(key)
      .then((val) => {
        if (cancelled) return;
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
      .catch(silentCatch('hooks/utility/data/useAppSetting:loadAppSetting'))
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => { cancelled = true; };
  }, [key]);

  // The "Saved ✓" flash timer, so a rapid second save restarts it rather than
  // stacking, and an unmount mid-flash does not leave it running.
  const savedTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
  }, []);

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
      if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
      savedTimerRef.current = window.setTimeout(() => {
        savedTimerRef.current = null;
        setSaved(false);
      }, 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Failed to save app setting', { key, err: message });
      setError(message);
    }
  }, [key]);

  return { value, setValue, save, loaded, saved, error };
}
