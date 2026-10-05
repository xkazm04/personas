/**
 * Bind a vault credential to an origin, so `browser_login` can sign the agent
 * in without the model ever seeing a value. Ported from the Detail layout's
 * Sign in tab (spark server-control): it is a draft field now, written on the
 * modal's Save through `bindSiteCredential`.
 *
 * The vault's own pickers choose a connector TYPE to add, or icon every row as
 * a notification channel, so this is the shared `ThemedSelect` over the
 * credential list rather than a mislabelled import.
 */
import { useEffect, useMemo } from 'react';

import { FormField } from '@/features/shared/components/forms/FormField';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { useVaultStore } from '@/stores/vaultStore';

import type { BrowserSite } from '../types';

/** ThemedSelect values are strings, so "no credential" needs a sentinel. */
const NONE = '';

interface SiteCredentialFieldProps {
  site: BrowserSite;
  value: string | null;
  onChange: (credentialId: string | null) => void;
}

export default function SiteCredentialField({ site, value, onChange }: SiteCredentialFieldProps) {
  const { t } = useTranslation();
  const a = t.browser.add_site;
  const credentials = useVaultStore((s) => s.credentials);

  useEffect(() => {
    // Deduped by the slice; the page may be the first surface to need the list.
    useVaultStore.getState().fetchCredentials().catch(silentCatch('browser site credential list'));
  }, []);

  const options = useMemo(
    () => [
      { value: NONE, label: credentials.length === 0 ? a.credential_empty : a.credential_none },
      ...credentials.map((c) => ({ value: c.id, label: c.name, description: c.service_type })),
    ],
    [credentials, a.credential_empty, a.credential_none],
  );

  return (
    <FormField
      label={a.credential_label}
      hint={a.credential_hint}
      helpText={site.scan_report?.login_form ? a.credential_form_found : a.credential_form_missing}
    >
      {(inputProps) => (
        <ThemedSelect
          {...inputProps}
          filterable
          hideSearch
          options={options}
          value={value ?? NONE}
          onValueChange={(next) => onChange(next === NONE ? null : next)}
          aria-label={a.credential_label}
        />
      )}
    </FormField>
  );
}
