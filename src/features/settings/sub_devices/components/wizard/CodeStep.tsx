/**
 * Code (this PC asked): the six digits the other PC must TYPE. Shown large and
 * grouped, never truncated. There is nothing to press here except Cancel: the
 * step moves on by itself when the other PC acts.
 */
import { Button } from '@/features/shared/components/buttons';
import { Ghost } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

interface CodeStepProps {
  displayName: string;
  /** `NNN-NNN`; null only in the instant before the request echoed back. */
  fingerprint: string | null;
  busy: boolean;
  onCancel: () => void;
}

export function CodeStep({ displayName, fingerprint, busy, onCancel }: CodeStepProps) {
  const { t, tx } = useTranslation();
  const st = t.sharing;
  const groups = fingerprint ? fingerprint.split(/[-\s]/).filter(Boolean) : [];

  return (
    <div data-testid="pairing-code-dialog" className="space-y-5 text-center">
      <div className="space-y-1">
        <h3 className="typo-heading text-foreground">{tx(st.wizard_code_title, { device: displayName })}</h3>
        <p className="typo-body text-foreground">{tx(st.wizard_code_body, { device: displayName })}</p>
      </div>

      <div className="rounded-card border border-border bg-secondary/20 py-6">
        {fingerprint ? (
          <p
            data-testid="pairing-fingerprint"
            aria-label={`${st.wizard_code_label}: ${fingerprint}`}
            className="flex items-center justify-center gap-4 typo-heading-lg font-mono text-foreground select-all"
          >
            {groups.map((group, i) => (
              <span key={i}>{group}</span>
            ))}
          </p>
        ) : (
          <Ghost width="12rem" height="2.5rem" inline />
        )}
      </div>

      <p className="typo-caption text-foreground">{st.wizard_code_next}</p>

      <Button variant="secondary" block loading={busy} data-testid="pairing-code-cancel" onClick={onCancel}>
        {st.pairing_cancel}
      </Button>
    </div>
  );
}
