/**
 * Import a twin from a Twin Card file (spark twin-portable-blueprint), opened
 * from the Profiles roster's "Import twin" beside "New twin".
 *
 * Choose a file -> the card is inspected (nothing written) and shown: name,
 * version, signature, partitions -> a passphrase when a part is sealed -> what
 * to do when a twin with that name already exists -> Import. A newer major
 * version or an invalid file stops at the inspection; a hash mismatch is shown
 * per part and left to the user. On success the roster refreshes and a toast
 * names the imported twin.
 */
import { FileUp, X } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { FormField } from '@/features/shared/components/forms/FormField';
import { PasswordToggleField } from '@/features/shared/components/forms/PasswordToggleField';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import type { TwinCardConflict } from '@/api/twin/twinCard';
import { CardInspectionView } from './CardInspectionView';
import { useTwinCardImport } from './useTwinCardImport';

const TITLE_ID = 'twin-card-import-title';
const CONFLICTS: readonly TwinCardConflict[] = ['duplicate', 'replace', 'skip'];

export function TwinCardImportDialog({ onClose }: { onClose: () => void }) {
  const { t, tx } = useTranslation();
  const c = t.twin.card;
  const addToast = useToastStore((s) => s.addToast);
  const flow = useTwinCardImport();
  const { inspection } = flow;
  const conflictLabel = { duplicate: c.conflictDuplicate, replace: c.conflictReplace, skip: c.conflictSkip };

  const submit = async () => {
    const result = await flow.runImport();
    if (!result) return;
    // A skipped collision imports nothing, so there is nothing to announce.
    if (result.imported.length > 0) addToast(tx(c.imported, { name: inspection?.name ?? '' }), 'success');
    onClose();
  };

  return (
    <BaseModal isOpen onClose={onClose} titleId={TITLE_ID} portal size="md" staggerChildren={false}
      panelClassName="w-full max-h-[85vh] flex flex-col overflow-hidden rounded-modal glass-md shadow-elevation-3 border border-primary/20 bg-background">
      <div className="flex-shrink-0 flex items-start gap-3 px-6 py-4 border-b border-primary/15">
        <h2 id={TITLE_ID} className="flex-1 min-w-0 typo-section-title text-foreground">{c.importTitle}</h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t.common.close} icon={<X className="w-4 h-4" />} />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
        <div className="flex items-center gap-3 min-w-0">
          <AsyncButton variant={inspection ? 'secondary' : 'accent'} tone={inspection ? undefined : 'agent'} size="sm"
            icon={<FileUp className="w-4 h-4" />} loadingText={c.inspecting} onClick={flow.pick} data-testid="twin-card-import-pick">
            {c.importPick}
          </AsyncButton>
          {flow.path && <span className="typo-code text-foreground truncate min-w-0">{flow.path}</span>}
        </div>

        {inspection && <CardInspectionView inspection={inspection} />}

        {inspection && !flow.blocked && flow.sealed && (
          <FormField label={c.passphrase} helpText={c.sealedNeedsPass}>
            {(inputProps) => (
              <PasswordToggleField {...inputProps} value={flow.passphrase} autoComplete="off"
                onChange={(e) => flow.setPassphrase(e.target.value)} data-testid="twin-card-import-passphrase" />
            )}
          </FormField>
        )}

        {inspection && !flow.blocked && flow.conflictName && (
          <section className="space-y-2" data-testid="twin-card-conflict">
            <p className="typo-body text-foreground">{tx(c.conflictTitle, { name: flow.conflictName })}</p>
            <div role="group" aria-label={tx(c.conflictTitle, { name: flow.conflictName })} className="flex items-center gap-2 flex-wrap">
              {CONFLICTS.map((choice) => (
                <Button key={choice} size="sm" variant={flow.conflict === choice ? 'accent' : 'secondary'}
                  tone={flow.conflict === choice ? 'agent' : undefined} aria-pressed={flow.conflict === choice}
                  onClick={() => flow.setConflict(choice)} data-testid={`twin-card-conflict-${choice}`}>
                  {conflictLabel[choice]}
                </Button>
              ))}
            </div>
          </section>
        )}

        {flow.error && <p role="alert" className="typo-caption text-status-error" data-testid="twin-card-import-error">{flow.error}</p>}
      </div>

      <div className="flex-shrink-0 flex items-center justify-end gap-2 px-6 py-3 border-t border-primary/15">
        <Button variant="ghost" size="sm" onClick={onClose}>{t.common.cancel}</Button>
        <AsyncButton variant="accent" tone="agent" size="sm" disabled={!inspection || flow.blocked}
          onClick={submit} data-testid="twin-card-import-run">
          {c.importAction}
        </AsyncButton>
      </div>
    </BaseModal>
  );
}

export default TwinCardImportDialog;
