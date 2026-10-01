/**
 * The export choices behind the Detail header's Export button: what to
 * include (voice is always in), an optional passphrase that seals the
 * personal partitions, the format, then the OS save dialog and the export.
 *
 * The passphrase travels as its own command argument, never inside the
 * options struct (census `secret-as-bare-string-field`). A failure is answered
 * inline, where the user pressed Export; a success says where the file went
 * and, when no device identity could sign it, that it is unsigned.
 */
import { useState } from 'react';
import { CheckCircle2, Download, X } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { BaseModal } from '@/lib/ui/BaseModal';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { FormField } from '@/features/shared/components/forms/FormField';
import { PasswordToggleField } from '@/features/shared/components/forms/PasswordToggleField';
import { SettingRow } from '@/features/shared/components/forms/SettingRow';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { cardExport, type TwinCardFormat, type TwinCardPartition } from '@/api/twin/twinCard';
import type { TwinCardExportResult } from '@/lib/bindings/TwinCardExportResult';
import { CARD_PARTITIONS, MIN_PASSPHRASE, SEALABLE_PARTITIONS, cardFileName, partitionHint, partitionLabel } from './cardCopy';
import { describeTwinError } from './cardErrors';

const TITLE_ID = 'twin-card-export-title';
const FORMATS: readonly TwinCardFormat[] = ['twin-card', 'ccv3'];

interface TwinCardExportDialogProps {
  twinId: string;
  twinName: string;
  onClose: () => void;
}

export function TwinCardExportDialog({ twinId, twinName, onClose }: TwinCardExportDialogProps) {
  const { t, tx } = useTranslation();
  const c = t.twin.card;
  const [included, setIncluded] = useState<ReadonlySet<TwinCardPartition>>(() => new Set(CARD_PARTITIONS));
  const [seal, setSeal] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [format, setFormat] = useState<TwinCardFormat>('twin-card');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TwinCardExportResult | null>(null);

  const sealable = SEALABLE_PARTITIONS.some((p) => included.has(p));
  const sealing = seal && sealable;
  const passphraseShort = sealing && passphrase.length < MIN_PASSPHRASE;

  const toggle = (part: TwinCardPartition) =>
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(part)) next.delete(part);
      else next.add(part);
      return next;
    });

  const runExport = async () => {
    setError(null);
    try {
      const path = await save({
        defaultPath: cardFileName(twinName, format),
        filters: [{ name: format === 'ccv3' ? c.formatCcv3 : c.formatTwinCard, extensions: ['json'] }],
      });
      if (!path) return;
      const partitions = CARD_PARTITIONS.filter((p) => p === 'voice' || included.has(p));
      setResult(await cardExport(twinId, { partitions, format, path }, sealing ? passphrase : null));
    } catch (err) {
      silentCatch('twin:card:export')(err);
      setError(describeTwinError(err));
    }
  };

  return (
    <BaseModal isOpen onClose={onClose} titleId={TITLE_ID} portal size="md" staggerChildren={false}
      panelClassName="w-full max-h-[85vh] flex flex-col overflow-hidden rounded-modal glass-md shadow-elevation-3 border border-primary/20 bg-background">
      <div className="flex-shrink-0 flex items-start gap-3 px-6 py-4 border-b border-primary/15">
        <h2 id={TITLE_ID} className="flex-1 min-w-0 typo-section-title text-foreground">{c.exportTitle}</h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t.common.close} icon={<X className="w-4 h-4" />} />
      </div>

      {result ? (
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-2" data-testid="twin-card-export-done">
          <p className="flex items-start gap-2 typo-body text-foreground">
            <CheckCircle2 className="w-4 h-4 mt-1 shrink-0 text-status-success" aria-hidden="true" />
            <span className="min-w-0 break-all">{tx(c.exported, { path: result.path })}</span>
          </p>
          {!result.signed && <p className="typo-caption text-status-warning">{c.unsignedNote}</p>}
          {result.warnings.map((w) => <p key={w} className="typo-caption">{w}</p>)}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-5">
          <section aria-label={c.partitionsLabel}>
            <p className="typo-eyebrow text-foreground mb-1">{c.partitionsLabel}</p>
            {CARD_PARTITIONS.map((part) => (
              <SettingRow key={part} label={partitionLabel(c, part)} description={partitionHint(c, part)}
                checked={part === 'voice' || included.has(part)} disabled={part === 'voice'}
                onChange={() => toggle(part)} testId={`twin-card-part-${part}`} />
            ))}
          </section>

          <section className="space-y-2">
            <SettingRow label={c.sealLabel} checked={sealing} disabled={!sealable} onChange={() => setSeal((v) => !v)}
              testId="twin-card-seal" />
            {sealing && (
              <FormField label={c.passphrase} helpText={c.passphraseHint}>
                {(inputProps) => (
                  <PasswordToggleField {...inputProps} value={passphrase} autoComplete="new-password"
                    onChange={(e) => setPassphrase(e.target.value)} data-testid="twin-card-passphrase" />
                )}
              </FormField>
            )}
          </section>

          <section className="space-y-2">
            <p className="typo-eyebrow text-foreground">{c.formatLabel}</p>
            <div role="group" aria-label={c.formatLabel} className="flex items-center gap-2">
              {FORMATS.map((f) => (
                <Button key={f} size="sm" variant={format === f ? 'accent' : 'secondary'} tone={format === f ? 'agent' : undefined}
                  aria-pressed={format === f} onClick={() => setFormat(f)} data-testid={`twin-card-format-${f}`}>
                  {f === 'ccv3' ? c.formatCcv3 : c.formatTwinCard}
                </Button>
              ))}
            </div>
          </section>
          {error && <p role="alert" className="typo-caption text-status-error" data-testid="twin-card-export-error">{error}</p>}
        </div>
      )}

      <div className="flex-shrink-0 flex items-center justify-end gap-2 px-6 py-3 border-t border-primary/15">
        <Button variant="ghost" size="sm" onClick={onClose}>{result ? t.common.close : t.common.cancel}</Button>
        {!result && (
          <AsyncButton variant="accent" tone="agent" size="sm" icon={<Download className="w-4 h-4" />}
            disabled={passphraseShort} onClick={runExport} data-testid="twin-card-export-run">
            {c.exportAction}
          </AsyncButton>
        )}
      </div>
    </BaseModal>
  );
}
