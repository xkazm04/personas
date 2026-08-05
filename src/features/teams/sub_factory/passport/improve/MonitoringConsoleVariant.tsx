// VARIANT A — "Console". Metaphor: a control panel where every tile is a switch.
//
// A 2×2 grid of equal tiles, one per capability. The STATE is the loudest thing
// on each tile — a tinted band across the top, a state chip, and the tile's own
// wash — because the question the operator opens this modal with is "which of
// these four is not okay". Everything else (detected tool, bound connector) is
// supporting evidence underneath.
//
// Acting happens IN PLACE: a tile flips into its own candidate list rather than
// navigating to a picker, so clearing three unwired capabilities never changes
// what is on screen. That is the difference from the Pipeline variant, which
// routes every action through a shared detail rail.
import { useState } from 'react';
import { Check, ChevronLeft, Plug, Rocket, X } from 'lucide-react';

import { getConnectorMeta, ThemedConnectorIcon } from '@/lib/connectors/connectorMeta';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import { useTranslation } from '@/i18n/useTranslation';

import { TechInk } from '../passportInk';
import type { MonitoringVariantProps, MonitoringRow } from './monitoringTypes';
import { STATE_INK } from './monitoringModel';

const wash = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

export function MonitoringConsoleVariant({ rows, busyKey, deploying, onAssign, onDeploy }: MonitoringVariantProps) {
  return (
    <div className="flex-1 min-h-0 grid grid-cols-2 grid-rows-2 gap-3 p-4">
      {rows.map((row) => (
        <ConsoleTile
          key={row.def.key}
          row={row}
          busy={busyKey === row.def.key}
          deploying={deploying === row.def.key}
          onAssign={(id) => onAssign(row.def.key, id)}
          onDeploy={() => onDeploy(row)}
        />
      ))}
    </div>
  );
}

function ConsoleTile({ row, busy, deploying, onAssign, onDeploy }: {
  row: MonitoringRow;
  busy: boolean;
  deploying: boolean;
  onAssign: (credentialId: string | null) => void;
  onDeploy: () => void;
}) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const [picking, setPicking] = useState(false);
  const ink = STATE_INK[row.state];
  const Icon = row.def.icon;

  return (
    <section
      className="flex flex-col rounded-card border overflow-hidden transition-colors"
      style={{ borderColor: wash(ink, 28), background: wash(ink, 5) }}
    >
      {/* state band — the tile's loudest reading */}
      <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: wash(ink, 18), background: wash(ink, 9) }}>
        <Icon className="w-4 h-4 flex-shrink-0" style={{ color: ink }} aria-hidden />
        <span className="typo-title truncate flex-1 min-w-0">{d[`monitoring_item_${row.def.labelKey}`]}</span>
        <span className="typo-label shrink-0 px-1.5 py-0.5 rounded-interactive" style={{ color: ink, background: wash(ink, 14) }}>
          {d[`monitoring_state_${row.state}`]}
        </span>
      </div>

      {picking ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-0.5">
            {row.candidates.length === 0 && (
              <p className="typo-caption text-foreground/40 italic px-1 py-1">{d.envslot_no_candidates}</p>
            )}
            {row.candidates.map((c) => (
              <CandidateButton
                key={c.id}
                credential={c}
                healthy={row.health[c.id]}
                selected={row.bound?.id === c.id}
                busy={busy}
                onClick={() => { onAssign(c.id); setPicking(false); }}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => setPicking(false)}
            className="inline-flex items-center gap-1 px-3 py-1.5 border-t border-primary/10 typo-caption text-foreground/60 hover:text-foreground hover:bg-primary/[0.06] transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" aria-hidden /> {t.common.cancel}
          </button>
        </div>
      ) : (
        <>
          <div className="flex-1 min-h-0 px-3 py-2.5 space-y-2.5 overflow-y-auto">
            <div>
              <p className="typo-label text-foreground/35 mb-1">{d.envslot_detected}</p>
              {row.detected
                ? <TechInk label={row.detected} />
                : <p className="typo-caption text-foreground/40 italic">{d.envslot_detected_none}</p>}
            </div>
            <div>
              <p className="typo-label text-foreground/35 mb-1">{d.envslot_connector}</p>
              {row.bound ? (
                <div className="flex items-center gap-2 min-w-0">
                  <ConnectorGlyph serviceType={row.bound.serviceType} size="w-4 h-4" />
                  <span className="typo-caption text-foreground truncate flex-1 min-w-0">{row.bound.name}</span>
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

          <div className="px-3 py-2 border-t flex items-center gap-2" style={{ borderColor: wash(ink, 15) }}>
            {/* NOT_IMPLEMENTED is the only state with a code action: the intent
                is declared, the codebase owes the work. */}
            {row.state === 'not_implemented' ? (
              <button
                type="button"
                disabled={deploying}
                onClick={onDeploy}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded-interactive typo-caption font-medium text-primary bg-primary/15 hover:bg-primary/25 border border-primary/25 transition-colors disabled:opacity-50"
              >
                <Rocket className="w-3 h-3" aria-hidden />
                {deploying ? d.monitoring_deploying : d.monitoring_deploy}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => setPicking(true)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded-interactive typo-caption text-primary bg-primary/10 hover:bg-primary/20 border border-primary/20 transition-colors disabled:opacity-40"
              >
                <Plug className="w-3 h-3" aria-hidden />
                {row.bound ? d.envslot_reassign : d.envslot_assign}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export function CandidateButton({ credential, healthy, selected, busy, onClick }: {
  credential: PersonaCredential;
  healthy: boolean | null | undefined;
  selected: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="w-full flex items-center gap-2 px-1.5 py-1 rounded-interactive hover:bg-primary/10 transition-colors focus-ring disabled:opacity-40"
    >
      <ConnectorGlyph serviceType={credential.serviceType} size="w-3.5 h-3.5" />
      <span className="typo-caption text-foreground truncate flex-1 min-w-0 text-left">{credential.name}</span>
      {healthy === false && <span className="typo-label text-[var(--status-error)] shrink-0">{d.envslot_unhealthy}</span>}
      {selected && <Check className="w-3 h-3 text-primary shrink-0" aria-hidden />}
    </button>
  );
}

export function ConnectorGlyph({ serviceType, size }: { serviceType: string; size: string }) {
  const meta = getConnectorMeta(serviceType);
  return <ThemedConnectorIcon url={meta.iconUrl ?? ''} label={meta.label} color={meta.color} size={size} />;
}
