/**
 * Bind a vault credential to an origin, so `browser_login` can sign the agent
 * in without the model ever seeing a value.
 *
 * REUSE NOTE. The brief asked for the vault credential picker. The vault's own
 * `sub_catalog` picker chooses a CONNECTOR TYPE to add, not an existing
 * credential, and the closest "pick one of my credentials" control
 * (`agents/sub_connectors/.../CredentialPicker`) is notification-channel
 * flavoured — it icons every row as Slack / Telegram / Email / bell, which
 * would put a bell beside a website login. So this uses the shared primitive
 * that one is itself built on, `forms/Listbox`, rather than re-implementing a
 * dropdown or importing a mislabelled one. Nothing about the dropdown
 * mechanics (focus, keyboard, aria) is hand-rolled.
 */
import { Check, KeyRound } from 'lucide-react';

import * as browserApi from '@/api/browser';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { useVaultStore } from '@/stores/vaultStore';

import { putSite } from '../../browserStore';
import type { BrowserSite } from '../../types';

export default function LoginTab({ site }: { site: BrowserSite }) {
  const { t } = useTranslation();
  const d = t.browser.detail;
  const credentials = useVaultStore((s) => s.credentials);
  const selected = credentials.find((c) => c.id === site.credential_id) ?? null;

  const bind = (credentialId: string | null) => {
    browserApi
      .bindSiteCredential(site.origin, credentialId)
      .then(putSite)
      .catch(toastCatch('browser bind credential', d.login_bind_failed));
  };

  return (
    <div className="space-y-3 min-w-0">
      <p className="typo-body text-foreground">{d.login_description}</p>

      <Listbox
        ariaLabel={d.login_select_label}
        itemCount={credentials.length + 1}
        onSelectFocused={(index) => bind(index === 0 ? null : (credentials[index - 1]?.id ?? null))}
        renderTrigger={({ isOpen, toggle }) => (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={isOpen}
            aria-haspopup="listbox"
            data-testid={`whitelist-credential-${site.origin}`}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 bg-background/50 border border-primary/20 rounded-input typo-body text-foreground focus-ring transition-all"
          >
            <KeyRound className="w-3.5 h-3.5 text-violet-400 shrink-0" />
            <span className="flex-1 text-left truncate">{selected ? selected.name : d.login_none}</span>
          </button>
        )}
      >
        {({ close, focusIndex }) => (
          <>
            <button
              type="button"
              role="option"
              aria-selected={!site.credential_id}
              onClick={() => {
                bind(null);
                close();
              }}
              className={`flex items-center gap-3 w-full px-3 py-2 typo-body text-foreground transition-colors ${
                focusIndex === 0 ? 'bg-secondary/60' : 'hover:bg-secondary/50'
              }`}
            >
              {d.login_unbind}
            </button>
            {credentials.map((cred, i) => (
              <button
                key={cred.id}
                type="button"
                role="option"
                aria-selected={cred.id === site.credential_id}
                onClick={() => {
                  bind(cred.id);
                  close();
                }}
                className={`flex items-center gap-3 w-full px-3 py-2 typo-body text-foreground transition-colors ${
                  focusIndex === i + 1 ? 'bg-secondary/60' : 'hover:bg-secondary/50'
                }`}
              >
                <span className="flex-1 text-left truncate">{cred.name}</span>
                <span className="typo-caption text-foreground">{cred.service_type}</span>
                {cred.id === site.credential_id && (
                  <Check className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                )}
              </button>
            ))}
            {credentials.length === 0 && (
              <div className="px-3 py-2 typo-body text-foreground">{d.login_no_credentials}</div>
            )}
          </>
        )}
      </Listbox>

      <div className="rounded-card border border-primary/10 bg-background/40 px-3 py-2">
        <div className="typo-caption uppercase tracking-wider text-foreground">
          {d.login_form_label}
        </div>
        <p className="typo-body text-foreground mt-1">
          {site.scan_report?.login_form ? d.login_form_found : d.login_form_missing}
        </p>
      </div>
    </div>
  );
}
