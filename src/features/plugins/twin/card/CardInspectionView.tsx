/**
 * What `twin_card_inspect` found, read-only: the twin's name and spec version,
 * the signature, each partition (sealed or open, and whether its hash still
 * matches), and the two reasons a card cannot be imported at all.
 *
 * An unsigned card is reported as unsigned, never as invalid (the operator's
 * condition for lite builds without a device identity).
 */
import { AlertTriangle, Lock, Shield, ShieldAlert, ShieldCheck, type LucideIcon } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { TwinCardInspection } from '@/lib/bindings/TwinCardInspection';
import { CARD_PARTITIONS, partitionLabel } from './cardCopy';

type SignatureState = 'valid' | 'invalid' | 'unsigned';

const SIGNATURE: Record<SignatureState, { Icon: LucideIcon; tone: string }> = {
  valid: { Icon: ShieldCheck, tone: 'text-status-success' },
  invalid: { Icon: ShieldAlert, tone: 'text-status-error' },
  unsigned: { Icon: Shield, tone: 'text-foreground' },
};

/** Known partitions in spec order, then anything newer as written. */
function ordered(inspection: TwinCardInspection) {
  const rank = (name: string) => {
    const i = (CARD_PARTITIONS as readonly string[]).indexOf(name);
    return i < 0 ? CARD_PARTITIONS.length : i;
  };
  return [...inspection.partitions].sort((a, b) => rank(a.name) - rank(b.name));
}

export function CardInspectionView({ inspection }: { inspection: TwinCardInspection }) {
  const { t, tx } = useTranslation();
  const c = t.twin.card;
  const signature: SignatureState =
    inspection.signature === 'valid' || inspection.signature === 'invalid' ? inspection.signature : 'unsigned';
  const sig = SIGNATURE[signature];
  const sigLabel = { valid: c.signatureValid, invalid: c.signatureInvalid, unsigned: c.signatureUnsigned }[signature];

  return (
    <div className="space-y-3" data-testid="twin-card-inspection">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="typo-heading text-foreground min-w-0 truncate">{inspection.name ?? t.twin.detail.noTwin}</p>
        <span className="typo-code text-foreground">{inspection.specVersion}</span>
        <span className={`ml-auto flex items-center gap-1.5 typo-label ${sig.tone}`} data-testid="twin-card-signature" data-signature={signature}>
          <sig.Icon className="w-3.5 h-3.5" aria-hidden="true" />
          {sigLabel}
        </span>
      </div>

      {!inspection.supported && (
        <p role="alert" className="typo-caption text-status-error" data-testid="twin-card-unsupported">
          {tx(c.unsupported, { version: inspection.specVersion })}
        </p>
      )}
      {inspection.supported && !inspection.valid && (
        <p role="alert" className="typo-caption text-status-error" data-testid="twin-card-invalid">{c.invalid}</p>
      )}

      <ul className="space-y-1" aria-label={c.partitionsLabel}>
        {ordered(inspection).map((part) => {
          const label = partitionLabel(c, part.name);
          return (
            <li key={part.name} className="flex items-center gap-2 min-w-0" data-testid={`twin-card-partition-${part.name}`}>
              {part.sealed && (
                <Tooltip content={c.sealedPart}>
                  <span role="img" aria-label={c.sealedPart} className="shrink-0 text-foreground">
                    <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                  </span>
                </Tooltip>
              )}
              <span className="typo-body text-foreground truncate">{label}</span>
              {part.hashOk === false && (
                <span className="ml-auto flex items-center gap-1 typo-caption text-status-warning" data-testid="twin-card-hash-mismatch">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  {tx(c.hashMismatch, { part: label })}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {inspection.warnings.map((w) => <p key={w} className="typo-caption">{w}</p>)}
    </div>
  );
}
