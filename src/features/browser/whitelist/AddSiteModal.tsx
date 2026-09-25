/**
 * Add a website to the whitelist — or rename one that is already there.
 *
 * The origin field validates to `scheme://host[:port]` BEFORE submit so the
 * user never fires a call Rust is certain to refuse; Rust still normalises
 * through `url::Url::origin()` and is still the one that decides. On an edit
 * the origin is the row's identity and is shown read-only: changing it would
 * be adding a different site, not renaming this one.
 *
 * "Scan now" is offered because a site with no scan is a site nobody knows
 * anything about — it is enabled-but-blind. It is a checkbox, not a
 * requirement, because a scan opens a real page and the operator may not want
 * that this second.
 */
import { useEffect, useState } from 'react';

import { BaseModal } from '@/lib/ui/BaseModal';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { FormField } from '@/features/shared/components/forms/FormField';
import { useTranslation } from '@/i18n/useTranslation';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

import {
  browserOriginProblem,
  normalizeBrowserOrigin,
  type BrowserOriginProblem,
  type BrowserSite,
} from '../types';
import PatternHint from './PatternHint';

export interface AddSiteSubmit {
  origin: string;
  label: string;
  scanNow: boolean;
}

interface AddSiteModalProps {
  isOpen: boolean;
  /** The row being renamed, or null when adding. */
  editing: BrowserSite | null;
  onClose: () => void;
  onSubmit: (value: AddSiteSubmit) => Promise<void>;
}

export default function AddSiteModal({ isOpen, editing, onClose, onSubmit }: AddSiteModalProps) {
  const { t } = useTranslation();
  const a = t.browser.add_site;
  const [origin, setOrigin] = useState('');
  const [label, setLabel] = useState('');
  const [scanNow, setScanNow] = useState(true);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setOrigin(editing?.origin ?? '');
    setLabel(editing?.label ?? '');
    setScanNow(!editing);
    setTouched(false);
  }, [isOpen, editing]);

  // WHICH mistake, not just "that is wrong". A pasted URL and a misplaced `*`
  // are different errors and one message for both teaches neither.
  const problem: BrowserOriginProblem | null = editing ? null : browserOriginProblem(origin);
  const originValid = problem === null;
  const showError = touched && origin.length > 0 && !originValid;
  const errorCopy =
    problem === 'url_not_origin'
      ? a.origin_error_url
      : problem === 'wildcard_misplaced'
        ? a.origin_error_wildcard
        : a.origin_error;

  const submit = async () => {
    setTouched(true);
    if (!originValid) return;
    await onSubmit({
      origin: editing ? editing.origin : normalizeBrowserOrigin(origin),
      label: label.trim(),
      scanNow: scanNow && !editing,
    });
  };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} titleId="browser-add-site-title" size="sm" portal>
      <div className="p-6 space-y-4">
        <h2 id="browser-add-site-title" className="typo-title-lg text-foreground">
          {editing ? a.title_edit : a.title}
        </h2>

        <FormField
          label={a.origin_label}
          required
          hint={a.origin_hint}
          error={showError ? errorCopy : undefined}
          forceValidation={touched}
        >
          {(inputProps) => (
            <input
              {...inputProps}
              type="text"
              value={origin}
              readOnly={!!editing}
              onChange={(e) => setOrigin(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder={t.browser.webview.address_placeholder}
              className={`${INPUT_FIELD} ${editing ? 'opacity-60' : ''}`}
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
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className={INPUT_FIELD}
              data-testid="whitelist-add-label"
            />
          )}
        </FormField>

        {!editing && (
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
              <p className="typo-caption text-foreground">{a.scan_now_hint}</p>
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
            disabled={!editing && !originValid}
            disabledReason={errorCopy}
            data-testid="whitelist-add-submit"
          >
            {editing ? a.save : a.submit}
          </AsyncButton>
        </div>
      </div>
    </BaseModal>
  );
}
