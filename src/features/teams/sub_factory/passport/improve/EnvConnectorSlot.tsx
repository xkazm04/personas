// One (dimension, environment) slot: what the codebase says is there, and which
// vault connector — if any — the operator has bound to it.
//
// Built as a standalone piece because the Database dimension needs three of
// them (local / test / production) and the Monitoring dimension needs one per
// capability per environment. Neither should re-implement "detected label +
// bound connector + reassign".
//
// The two halves are deliberately separate readings. DETECTED is what the
// evidence probe found in the repo and is never editable here — it is a fact
// about the code. BOUND is the operator's declaration of which credential
// watches that environment, and is the only thing this component writes. A slot
// can honestly be detected-but-unbound (we see Postgres, nothing is wired) or
// bound-but-undetected (a connector is wired, the code shows nothing yet).
import { useState } from 'react';
import { Check, ChevronDown, Plug, X } from 'lucide-react';

import { getConnectorMeta, ThemedConnectorIcon } from '@/lib/connectors/connectorMeta';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import { useTranslation } from '@/i18n/useTranslation';

import { TechInk } from '../passportInk';
import type { EnvKey } from '../passportModel';

export interface EnvConnectorSlotProps {
  env: EnvKey;
  /** Environment display label ("Local" / "Test" / "Prod"). */
  envLabel: string;
  /** What the codebase shows for this environment; null = nothing known. */
  detected: string | null;
  /** Optional second line under the detected label (ORM, version, …). */
  detectedSub?: string;
  /** The credential currently bound, if any. */
  bound: PersonaCredential | undefined;
  /** Healthcheck result for the bound credential (undefined = still checking). */
  boundHealth: boolean | null | undefined;
  /** Selectable credentials for this slot. */
  candidates: PersonaCredential[];
  health: Record<string, boolean | null>;
  busy: boolean;
  onAssign: (credentialId: string | null) => void;
}

export function EnvConnectorSlot({
  envLabel, detected, detectedSub, bound, boundHealth, candidates, health, busy, onAssign,
}: EnvConnectorSlotProps) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const [picking, setPicking] = useState(false);

  return (
    <section className="flex flex-col rounded-card border border-primary/12 bg-secondary/[0.14] overflow-hidden">
      <div className="px-3 py-1.5 border-b border-primary/10 bg-primary/[0.04]">
        <span className="typo-label text-foreground/50">{envLabel}</span>
      </div>

      <div className="px-3 py-2.5 space-y-3 flex-1 min-h-0">
        {/* DETECTED — read-only; a fact about the codebase. */}
        <div>
          <p className="typo-label text-foreground/35 mb-1">{d.envslot_detected}</p>
          {detected
            ? (
              <>
                <TechInk label={detected} />
                {detectedSub && <p className="typo-caption text-foreground/70 mt-1">{detectedSub}</p>}
              </>
            )
            : <p className="typo-caption text-foreground/40 italic">{d.envslot_detected_none}</p>}
        </div>

        {/* BOUND — the operator's declaration; the only writable half. */}
        <div>
          <p className="typo-label text-foreground/35 mb-1">{d.envslot_connector}</p>
          {bound ? (
            <div className="flex items-center gap-2 min-w-0">
              <ConnectorGlyph serviceType={bound.serviceType} size="w-4 h-4" />
              <span className="typo-caption text-foreground truncate flex-1 min-w-0">{bound.name}</span>
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{
                  background: boundHealth === true ? 'var(--status-success)'
                    : boundHealth === false ? 'var(--status-error)'
                      : 'var(--status-neutral)',
                }}
                aria-hidden
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => onAssign(null)}
                aria-label={d.envslot_unassign}
                title={d.envslot_unassign}
                className="p-0.5 rounded-interactive text-foreground/40 hover:text-[var(--status-error)] hover:bg-[var(--status-error)]/10 transition-colors disabled:opacity-40"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <p className="typo-caption text-foreground/40 italic">{d.envslot_connector_none}</p>
          )}
        </div>
      </div>

      <div className="px-3 py-2 border-t border-primary/10 bg-secondary/10">
        {picking ? (
          <ul className="space-y-0.5 max-h-32 overflow-y-auto">
            {candidates.length === 0 && (
              <li className="typo-caption text-foreground/40 italic px-1 py-1">{d.envslot_no_candidates}</li>
            )}
            {candidates.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { onAssign(c.id); setPicking(false); }}
                  className="w-full flex items-center gap-2 px-1.5 py-1 rounded-interactive hover:bg-primary/10 transition-colors focus-ring disabled:opacity-40"
                >
                  <ConnectorGlyph serviceType={c.serviceType} size="w-3.5 h-3.5" />
                  <span className="typo-caption text-foreground truncate flex-1 min-w-0 text-left">{c.name}</span>
                  {health[c.id] === false && (
                    <span className="typo-label text-[var(--status-error)] shrink-0">{d.envslot_unhealthy}</span>
                  )}
                  {bound?.id === c.id && <Check className="w-3 h-3 text-primary shrink-0" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => setPicking(true)}
            className="w-full inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded-interactive typo-caption text-primary bg-primary/10 hover:bg-primary/20 border border-primary/20 transition-colors disabled:opacity-40"
          >
            <Plug className="w-3 h-3" aria-hidden />
            {bound ? d.envslot_reassign : d.envslot_assign}
            <ChevronDown className="w-3 h-3" aria-hidden />
          </button>
        )}
      </div>
    </section>
  );
}

/** Connector brand mark from the catalog meta — `ThemedConnectorIcon` wants the
 *  resolved url/label/color, not a raw service type. */
function ConnectorGlyph({ serviceType, size }: { serviceType: string; size: string }) {
  const meta = getConnectorMeta(serviceType);
  return <ThemedConnectorIcon url={meta.iconUrl ?? ''} label={meta.label} color={meta.color} size={size} />;
}
