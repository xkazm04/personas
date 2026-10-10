import { useEffect, useState } from 'react';
import { FormField } from '@/features/shared/components/forms/FormField';
import Button from '@/features/shared/components/buttons/Button';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { useTranslation, interpolate } from '@/i18n/useTranslation';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { getCloudPairingOrigin, setCloudPairingOrigin } from '@/api/cloudSync';
import type { CloudPairingOrigin } from '@/lib/bindings/CloudPairingOrigin';

/** Matches `settings_keys::CLOUD_PAIRING_ORIGIN_MAX`. */
const MAX_ORIGIN = 256;

/**
 * The web address the pairing QR opens. The page served there reads the
 * pairing secret from the URL fragment, so the panel always shows where the
 * next QR goes. There is no default: empty clears it, which turns pairing off,
 * and the backend refuses to start a pairing until one is saved. It accepts
 * only a bare `https://host[:port]` origin (`http://` for localhost).
 *
 * `onOriginChange` reports every loaded or saved state (null while unknown),
 * so the panel can keep Pair a phone disabled until an origin is set.
 */
export default function PairingOriginField({
  onOriginChange,
}: {
  onOriginChange?: (origin: CloudPairingOrigin | null) => void;
}) {
  const { t } = useTranslation();
  const s = t.settings.account;
  const [current, setCurrent] = useState<CloudPairingOrigin | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCloudPairingOrigin()
      .then((o) => {
        if (cancelled) return;
        setCurrent(o);
        onOriginChange?.(o);
        setDraft(o.custom ? o.origin : '');
      })
      .catch((e: unknown) => {
        // Shown inline: the operator pressed nothing, and the panel must not
        // look as if it knows where the QR opens when it does not.
        if (!cancelled) {
          setLoadFailed(true);
          onOriginChange?.(null);
        }
        silentCatch('PairingOriginField:load')(e);
      });
    return () => {
      cancelled = true;
    };
  }, [onOriginChange]);

  const trimmed = draft.trim();
  const saved = current?.custom ? current.origin : '';
  const dirty = (current !== null || loadFailed) && trimmed !== saved;

  const save = async () => {
    setSaving(true);
    try {
      const next = await setCloudPairingOrigin(trimmed === '' ? null : trimmed);
      setCurrent(next);
      onOriginChange?.(next);
      setLoadFailed(false);
      setDraft(next.custom ? next.origin : '');
      useToastStore.getState().addToast(s.cloud_pairing_origin_saved, 'success');
    } catch (e) {
      toastCatch('PairingOriginField:save', s.cloud_pairing_origin_failed)(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <FormField label={s.cloud_pairing_origin_label} helpText={s.cloud_pairing_origin_hint}>
            {(inputProps) => (
              <input
                {...inputProps}
                type="url"
                value={draft}
                maxLength={MAX_ORIGIN}
                spellCheck={false}
                onChange={(e) => setDraft(e.target.value)}
                className={INPUT_FIELD}
                data-testid="cloud-pairing-origin"
              />
            )}
          </FormField>
        </div>
        <Button
          variant="secondary"
          size="sm"
          loading={saving}
          disabled={saving || !dirty}
          onClick={() => {
            void save();
          }}
        >
          {s.cloud_pairing_origin_save}
        </Button>
      </div>
      {loadFailed && !current && (
        <p className="typo-caption text-status-error" role="alert">
          {s.cloud_pairing_origin_load_failed}
        </p>
      )}
      {current?.custom && (
        <p className="typo-caption text-foreground break-all" data-testid="cloud-pairing-origin-effective">
          {interpolate(s.cloud_pairing_origin_opens, { origin: current.origin })}
        </p>
      )}
      {current && !current.custom && (
        <p className="typo-caption text-status-warning" data-testid="cloud-pairing-origin-unset">
          {s.cloud_pairing_origin_unset}
        </p>
      )}
    </div>
  );
}
