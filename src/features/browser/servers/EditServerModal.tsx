/**
 * Edit a server's dev command and port.
 *
 * Validation mirrors `dev_server_configure` (`serverConfig.ts`) so the operator
 * never sends a command Rust is certain to refuse, and the message names the
 * rule that was broken. Rust still decides; its refusal is shown in the modal,
 * not as a toast, because the operator is looking at the field it is about.
 */
import { useEffect, useState } from 'react';

import * as api from '@/api/devServers';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { FormField } from '@/features/shared/components/forms/FormField';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevServerView } from '@/lib/bindings/DevServerView';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { extractMessage } from '@/lib/silentCatch';
import { BaseModal } from '@/lib/ui/BaseModal';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

import { checkServerConfig, SERVER_COMMAND_MAX } from './serverConfig';

interface EditServerModalProps {
  /** The server being edited; null keeps the modal closed. */
  server: DevServerView | null;
  onClose: () => void;
}

export default function EditServerModal({ server, onClose }: EditServerModalProps) {
  const { t } = useTranslation();
  const s = t.browser.servers;
  const [command, setCommand] = useState('');
  const [port, setPort] = useState('');
  const [touched, setTouched] = useState(false);
  /** The raw refusal; resolved to the product's sentence where it is rendered. */
  const [failure, setFailure] = useState<unknown>(null);

  useEffect(() => {
    if (!server) return;
    setCommand(server.devCommand ?? '');
    setPort(String(server.devPort));
    setTouched(false);
    setFailure(null);
  }, [server]);

  const check = checkServerConfig(command, port);
  const commandError =
    check.command === 'forbidden'
      ? s.command_invalid
      : check.command === 'too_long'
        ? s.command_too_long
        : check.command === 'placeholder'
          ? s.command_placeholder_invalid
          : undefined;
  const portError = check.port ? s.port_invalid : undefined;
  const valid = !commandError && !portError;

  const save = async () => {
    setTouched(true);
    if (!server || !valid || check.devPort === null) return;
    setFailure(null);
    try {
      await api.configureDevServer(server.projectId, check.devCommand, check.devPort);
      onClose();
    } catch (err) {
      setFailure(err);
    }
  };

  return (
    <BaseModal isOpen={server !== null} onClose={onClose} titleId="server-edit-title" size="md" portal>
      <div className="p-6 space-y-4" data-testid="server-edit-modal">
        <div className="space-y-1">
          <h2 id="server-edit-title" className="typo-title-lg">
            {s.edit_title}
          </h2>
          <p className="typo-body text-foreground">
            <span className="typo-heading text-foreground">{server?.projectName}</span>
            <span className="font-mono"> {server?.rootPath}</span>
          </p>
          <p className="typo-caption">{s.edit_subtitle}</p>
        </div>

        <FormField
          label={s.command_label}
          hint={s.command_port_hint}
          helpText={s.command_blank_hint}
          error={commandError}
          forceValidation={touched}
          validateOn="change"
        >
          {(inputProps) => (
            <input
              {...inputProps}
              type="text"
              value={command}
              maxLength={SERVER_COMMAND_MAX + 50}
              onChange={(e) => setCommand(e.target.value)}
              className={`${INPUT_FIELD} font-mono`}
              spellCheck={false}
              data-testid="server-edit-command"
            />
          )}
        </FormField>

        <FormField label={s.port_label} required error={portError} forceValidation={touched} validateOn="change">
          {(inputProps) => (
            <input
              {...inputProps}
              type="text"
              inputMode="numeric"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className={`${INPUT_FIELD} w-36 font-mono tabular-nums`}
              data-testid="server-edit-port"
            />
          )}
        </FormField>

        {failure !== null && (
          <div data-testid="server-edit-error">
            <InlineErrorBanner compact title={s.save_failed} message={resolveErrorTranslated(t, extractMessage(failure)).message} />
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <AsyncButton
            size="sm"
            variant="primary"
            onClick={save}
            disabled={!valid}
            disabledReason={commandError ?? portError}
            data-testid="server-edit-save"
          >
            {s.edit_save}
          </AsyncButton>
        </div>
      </div>
    </BaseModal>
  );
}
