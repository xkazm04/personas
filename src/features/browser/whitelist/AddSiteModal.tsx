/**
 * Add a website to the whitelist, or edit one that is already there.
 *
 * ADD. The origin field validates to `scheme://host[:port]` BEFORE submit so
 * the user never fires a call Rust is certain to refuse; Rust still normalises
 * through `url::Url::origin()` and is still the one that decides. "Scan now" is
 * offered because a site with no scan is enabled-but-blind; it is a choice, not
 * a requirement, because a scan opens a real page.
 *
 * EDIT. The origin is the row's identity and is read-only: changing it would be
 * adding a different site. Since spark server-control the edit also carries
 * what the retired Detail layout's tabs did (credential, ask-first overrides,
 * budget), as a draft with one Save. The modal plans the writes
 * (`siteEdit.ts`) and the page sends them.
 */
import { useEffect, useState } from 'react';

import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { FormField } from '@/features/shared/components/forms/FormField';
import { useTranslation } from '@/i18n/useTranslation';
import { BaseModal } from '@/lib/ui/BaseModal';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

import { browserOriginProblem, normalizeBrowserOrigin, type BrowserSite } from '../types';
import PatternHint from './PatternHint';
import SiteCredentialField from './SiteCredentialField';
import SitePolicyFields from './SitePolicyFields';
import { draftFromSite, parseBudget, planSiteWrites, type SiteEditDraft, type SiteWrite } from './siteEdit';

export type AddSiteSubmit =
  | { mode: 'add'; origin: string; label: string; scanNow: boolean }
  | { mode: 'edit'; site: BrowserSite; writes: SiteWrite[] };

interface AddSiteModalProps {
  isOpen: boolean;
  /** The row being edited, or null when adding. */
  editing: BrowserSite | null;
  onClose: () => void;
  onSubmit: (value: AddSiteSubmit) => Promise<void>;
}

const BLANK: SiteEditDraft = { label: '', budget: '', credentialId: null, gated: {} };

export default function AddSiteModal({ isOpen, editing, onClose, onSubmit }: AddSiteModalProps) {
  const { t } = useTranslation();
  const a = t.browser.add_site;
  const [origin, setOrigin] = useState('');
  const [draft, setDraft] = useState<SiteEditDraft>(BLANK);
  const [scanNow, setScanNow] = useState(true);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setOrigin(editing?.origin ?? '');
    setDraft(editing ? draftFromSite(editing) : BLANK);
    setScanNow(!editing);
    setTouched(false);
  }, [isOpen, editing]);

  // WHICH mistake, not just "that is wrong". A pasted URL and a misplaced `*`
  // are different errors and one message for both teaches neither.
  const problem = editing ? null : browserOriginProblem(origin);
  const showError = touched && origin.length > 0 && problem !== null;
  const errorCopy =
    problem === 'url_not_origin' ? a.origin_error_url : problem === 'wildcard_misplaced' ? a.origin_error_wildcard : a.origin_error;
  const budgetError = editing && parseBudget(draft.budget) === null ? a.budget_invalid : undefined;
  const blocked = editing ? budgetError : problem !== null ? errorCopy : undefined;

  const submit = async () => {
    setTouched(true);
    if (blocked) return;
    if (editing) await onSubmit({ mode: 'edit', site: editing, writes: planSiteWrites(editing, draft) });
    else await onSubmit({ mode: 'add', origin: normalizeBrowserOrigin(origin), label: draft.label.trim(), scanNow });
  };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} titleId="browser-add-site-title" size={editing ? 'md' : 'sm'} portal>
      <div className="p-6 space-y-4">
        <h2 id="browser-add-site-title" className="typo-title-lg">
          {editing ? a.title_edit : a.title}
        </h2>

        <FormField label={a.origin_label} required hint={a.origin_hint} error={showError ? errorCopy : undefined} forceValidation={touched}>
          {(inputProps) => (
            <input
              {...inputProps}
              type="text"
              value={origin}
              readOnly={!!editing}
              onChange={(e) => setOrigin(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder={t.browser.webview.address_placeholder}
              className={`${INPUT_FIELD} font-mono ${editing ? 'bg-secondary/40 cursor-default' : ''}`}
              data-testid="whitelist-add-origin"
            />
          )}
        </FormField>

        {!editing && <PatternHint />}

        <FormField label={a.label_label} helpText={a.label_hint}>
          {(inputProps) => (
            <input
              {...inputProps}
              type="text"
              value={draft.label}
              onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
              className={INPUT_FIELD}
              data-testid="whitelist-add-label"
            />
          )}
        </FormField>

        {editing ? (
          <>
            <SiteCredentialField
              site={editing}
              value={draft.credentialId}
              onChange={(credentialId) => setDraft((d) => ({ ...d, credentialId }))}
            />
            <SitePolicyFields
              gated={draft.gated}
              onGatedChange={(tool, gated) => setDraft((d) => ({ ...d, gated: { ...d.gated, [tool]: gated } }))}
              budget={draft.budget}
              onBudgetChange={(budget) => setDraft((d) => ({ ...d, budget }))}
              budgetError={budgetError}
            />
          </>
        ) : (
          <div className="flex items-start gap-3">
            <AccessibleToggle
              checked={scanNow}
              onChange={() => setScanNow((v) => !v)}
              label={a.scan_now_label}
              size="sm"
              data-testid="whitelist-add-scan-now"
            />
            <div className="min-w-0">
              <div className="typo-body text-foreground">{a.scan_now_label}</div>
              <p className="typo-caption">{a.scan_now_hint}</p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            {a.cancel}
          </Button>
          <AsyncButton
            size="sm"
            variant="primary"
            onClick={submit}
            disabled={blocked !== undefined}
            disabledReason={blocked}
            data-testid="whitelist-add-submit"
          >
            {editing ? a.save : a.submit}
          </AsyncButton>
        </div>
      </div>
    </BaseModal>
  );
}
