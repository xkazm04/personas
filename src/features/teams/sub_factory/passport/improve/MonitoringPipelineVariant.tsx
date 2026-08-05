// VARIANT B — "Pipeline". Metaphor: a wiring diagram you can see the break in.
//
// Four rows, each drawn as a signal chain: what the CODE emits, a link, and what
// the VAULT is watching with. The state is not a chip you read — it is whether
// the link is joined. A dashed gap with an empty terminal on one side IS
// "unconfirmed"; a gap with an empty terminal on the other side IS "not
// implemented". The chip is a caption for what the drawing already said.
//
// The other difference from Console: acting routes through a shared detail rail
// on the right, so the four rows never change height or reflow. Selecting a row
// is a navigation, not a mutation of the row itself — which makes comparing all
// four while you work possible, and makes each individual action one more click.
import { Rocket, X } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { TechInk } from '../passportInk';
import { CandidateButton, ConnectorGlyph } from './MonitoringConsoleVariant';
import { STATE_INK } from './monitoringModel';
import type { MonitoringRow, MonitoringVariantProps } from './monitoringTypes';

const wash = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

export function MonitoringPipelineVariant({ rows, busyKey, deploying, onAssign, onDeploy, selected, onSelect }: MonitoringVariantProps & {
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const active = rows.find((r) => r.def.key === selected) ?? null;

  return (
    <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <div className="min-h-0 overflow-y-auto border-r border-primary/10 p-3 space-y-2">
        {rows.map((row) => (
          <PipelineRow
            key={row.def.key}
            row={row}
            active={selected === row.def.key}
            onSelect={() => onSelect(row.def.key)}
          />
        ))}
      </div>

      <div className="min-h-0 overflow-y-auto">
        {active ? (
          <DetailRail
            row={active}
            busy={busyKey === active.def.key}
            deploying={deploying === active.def.key}
            onAssign={(id) => onAssign(active.def.key, id)}
            onDeploy={() => onDeploy(active)}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-1 px-6 text-center">
            <p className="typo-title text-foreground/70">{d.monitoring_pick_title}</p>
            <p className="typo-caption text-foreground/70 max-w-[32ch]">{d.monitoring_pick_body}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** The chain: code terminal → link → vault terminal. A filled terminal means
 *  that side exists; the link is solid only when both do. */
function PipelineRow({ row, active, onSelect }: { row: MonitoringRow; active: boolean; onSelect: () => void }) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const ink = STATE_INK[row.state];
  const Icon = row.def.icon;
  const joined = row.state === 'ok';

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-card border px-3 py-2.5 transition-colors focus-ring ${active ? 'bg-primary/[0.07]' : 'hover:bg-secondary/20'}`}
      style={{ borderColor: active ? wash('var(--primary)', 35) : wash(ink, 22) }}
      data-testid={`monitoring-row-${row.def.key}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 flex-shrink-0" style={{ color: ink }} aria-hidden />
        <span className="typo-title truncate flex-1 min-w-0">{d[`monitoring_item_${row.def.labelKey}`]}</span>
        <span className="typo-label shrink-0" style={{ color: ink }}>{d[`monitoring_state_${row.state}`]}</span>
      </div>

      <div className="flex items-center gap-2 min-w-0">
        <Terminal filled={Boolean(row.detected)} ink={ink}>
          {row.detected
            ? <TechInk label={row.detected} />
            : <span className="typo-caption text-foreground/40 italic">{d.monitoring_chain_no_code}</span>}
        </Terminal>

        {/* the link — solid only when both terminals exist */}
        <span
          className="h-px w-8 shrink-0"
          style={joined
            ? { background: ink }
            : { backgroundImage: `repeating-linear-gradient(90deg, ${wash(ink, 55)} 0 3px, transparent 3px 6px)` }}
          aria-hidden
        />

        <Terminal filled={Boolean(row.bound)} ink={ink}>
          {row.bound
            ? (
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <ConnectorGlyph serviceType={row.bound.serviceType} size="w-3.5 h-3.5" />
                <span className="typo-caption text-foreground truncate">{row.bound.name}</span>
              </span>
            )
            : <span className="typo-caption text-foreground/40 italic">{d.monitoring_chain_no_connector}</span>}
        </Terminal>
      </div>
    </button>
  );
}

function Terminal({ filled, ink, children }: { filled: boolean; ink: string; children: React.ReactNode }) {
  return (
    <span
      className="flex-1 min-w-0 px-2 py-1 rounded-input border"
      style={filled
        ? { borderColor: wash(ink, 30), background: wash(ink, 8) }
        : { borderColor: wash('var(--muted-foreground)', 25), borderStyle: 'dashed' }}
    >
      {children}
    </span>
  );
}

function DetailRail({ row, busy, deploying, onAssign, onDeploy }: {
  row: MonitoringRow;
  busy: boolean;
  deploying: boolean;
  onAssign: (credentialId: string | null) => void;
  onDeploy: () => void;
}) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;

  return (
    <div className="p-3 space-y-3">
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

      {row.state === 'not_implemented' && (
        <div className="p-2.5 rounded-card bg-primary/[0.07] border border-primary/20 space-y-2">
          <p className="typo-caption text-foreground leading-snug">{d.monitoring_deploy_blurb}</p>
          <button
            type="button"
            disabled={deploying}
            onClick={onDeploy}
            className="w-full inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded-interactive typo-caption font-medium text-primary bg-primary/15 hover:bg-primary/25 border border-primary/25 transition-colors disabled:opacity-50"
          >
            <Rocket className="w-3 h-3" aria-hidden />
            {deploying ? d.monitoring_deploying : d.monitoring_deploy}
          </button>
        </div>
      )}

      <div>
        <p className="typo-label text-foreground/35 mb-1">{d.monitoring_candidates}</p>
        <div className="space-y-0.5">
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
              onClick={() => onAssign(c.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
