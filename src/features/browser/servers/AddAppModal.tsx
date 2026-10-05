/**
 * Add an app to Server control: a repository folder and, optionally, the
 * workspace it belongs to.
 *
 * Submitting returns at once. Rust gets-or-creates the dev project, assigns a
 * free port and starts the AI scan; the new server arrives through
 * `dev-servers-changed` in state `scanning`, so the modal closes on success and
 * never waits for the scan itself.
 */
import { useEffect, useMemo, useState } from 'react';
import { FolderOpen, Sparkles } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';

import * as api from '@/api/devServers';
import { useWorkspaces } from '@/features/plugins/dev-tools/sub_workspaces/workspaceStore';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { FormField } from '@/features/shared/components/forms/FormField';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { extractMessage, silentCatch } from '@/lib/silentCatch';
import { BaseModal } from '@/lib/ui/BaseModal';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

/** ThemedSelect values are strings, so "no workspace" needs a sentinel. */
const NO_WORKSPACE = '';

interface AddAppModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AddAppModal({ isOpen, onClose }: AddAppModalProps) {
  const { t } = useTranslation();
  const s = t.browser.servers;
  const { workspaces } = useWorkspaces();
  const [rootPath, setRootPath] = useState('');
  const [workspaceId, setWorkspaceId] = useState(NO_WORKSPACE);
  /** The raw refusal; resolved to the product's sentence where it is rendered. */
  const [failure, setFailure] = useState<unknown>(null);

  useEffect(() => {
    if (!isOpen) return;
    setRootPath('');
    setWorkspaceId(NO_WORKSPACE);
    setFailure(null);
  }, [isOpen]);

  const options = useMemo(
    () => [{ value: NO_WORKSPACE, label: s.add_no_workspace }, ...workspaces.map((w) => ({ value: w.id, label: w.name }))],
    [workspaces, s.add_no_workspace],
  );

  const path = rootPath.trim();

  const browse = async () => {
    try {
      const picked = await open({ directory: true, multiple: false, title: s.add_browse_title });
      if (typeof picked === 'string' && picked) setRootPath(picked);
    } catch (err) {
      silentCatch('browser/servers/AddAppModal:browse')(err);
    }
  };

  const submit = async () => {
    if (path === '') return;
    setFailure(null);
    try {
      await api.addDevServerApp(path, workspaceId === NO_WORKSPACE ? null : workspaceId);
      onClose();
    } catch (err) {
      setFailure(err);
    }
  };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} titleId="server-add-app-title" size="md" portal>
      <div className="p-6 space-y-4" data-testid="server-add-app-modal">
        <h2 id="server-add-app-title" className="typo-title-lg">
          {s.add_title}
        </h2>

        <FormField label={s.add_folder} required>
          {(inputProps) => (
            <div className="flex items-center gap-2">
              <input
                {...inputProps}
                type="text"
                value={rootPath}
                onChange={(e) => setRootPath(e.target.value)}
                placeholder={s.add_folder_placeholder}
                className={`${INPUT_FIELD} font-mono flex-1 min-w-0`}
                spellCheck={false}
                data-testid="server-add-path"
              />
              <Button
                size="sm"
                variant="secondary"
                icon={<FolderOpen className="w-4 h-4" />}
                onClick={() => void browse()}
                data-testid="server-add-browse"
              >
                {s.add_browse}
              </Button>
            </div>
          )}
        </FormField>

        <FormField label={s.add_workspace}>
          {(inputProps) => (
            <ThemedSelect
              {...inputProps}
              filterable
              hideSearch
              options={options}
              value={workspaceId}
              onValueChange={setWorkspaceId}
              aria-label={s.add_workspace}
            />
          )}
        </FormField>

        <div className="flex items-start gap-3 rounded-card border border-primary/15 bg-primary/5 px-3 py-2.5">
          <Sparkles className="w-4 h-4 mt-0.5 flex-shrink-0 text-primary" aria-hidden />
          <p className="typo-body text-foreground">{s.add_scan_hint}</p>
        </div>

        {failure !== null && (
          <div data-testid="server-add-error">
            <InlineErrorBanner compact title={s.add_failed} message={resolveErrorTranslated(t, extractMessage(failure)).message} />
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <AsyncButton
            size="sm"
            variant="primary"
            onClick={submit}
            disabled={path === ''}
            disabledReason={s.add_folder_required}
            data-testid="server-add-submit"
          >
            {s.add_submit}
          </AsyncButton>
        </div>
      </div>
    </BaseModal>
  );
}
