// VARIANT C — "Focus". A narrow rail plus one large pane — SkillsWorkbench's
// own two-pane workbench, applied to capabilities.
//
// Grid shape: the four capabilities compress into a ~230px index (name, state
// dot, one-line summary) and the remaining ~670 × 480 goes to ONE of them.
//
// What that much room buys, which neither of the other shapes can:
//   · the candidate list is ALWAYS open — not a flip, not an expansion. Picking
//     a connector is reading a list, not a mode you enter and leave;
//   · the `not_implemented` deploy gets a real block — the explanation, the
//     connector it would integrate, and the button — instead of one CTA whose
//     meaning you have to already know;
//   · the facts are laid out with headroom rather than squeezed to two lines.
//
// Cost of the shape: you see one capability at a time. The rail keeps the other
// three legible as state dots, but "which of the four is broken" is a glance in
// A and B and a read here.
import { useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import { TechInk } from '../passportInk';
import {
  Absent, BoundConnector, CandidateRow, CardAction, ConnectorGlyph, DeployNote, Fact, StateMark,
} from './monitoringCard';
import { STATE_INK } from './monitoringModel';
import type { MonitoringRow, MonitoringVariantProps } from './monitoringTypes';

export function MonitoringFocusVariant({ rows, busyKey, deploying, onAssign, onDeploy }: MonitoringVariantProps) {
  // Open on the capability that most needs a human, so the pane is never
  // arbitrary: something wired but unimplemented, else something undetected.
  const firstNeeding = rows.find((r) => r.state === 'not_implemented')
    ?? rows.find((r) => r.state !== 'ok')
    ?? rows[0];
  const [selected, setSelected] = useState<string | null>(firstNeeding?.def.key ?? null);
  const active = rows.find((r) => r.def.key === selected) ?? rows[0];

  return (
    <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,230px)_minmax(0,1fr)]">
      <nav className="min-h-0 overflow-y-auto border-r border-primary/10 p-2 space-y-1">
        {rows.map((row) => (
          <RailItem
            key={row.def.key}
            row={row}
            active={row.def.key === active?.def.key}
            onSelect={() => setSelected(row.def.key)}
          />
        ))}
      </nav>

      {active && (
        <Detail
          key={active.def.key}
          row={active}
          busy={busyKey === active.def.key}
          deploying={deploying === active.def.key}
          onAssign={(id) => onAssign(active.def.key, id)}
          onDeploy={() => onDeploy(active)}
        />
      )}
    </div>
  );
}

function RailItem({ row, active, onSelect }: { row: MonitoringRow; active: boolean; onSelect: () => void }) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const Icon = row.def.icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-interactive px-2.5 py-2 transition-colors focus-ring ${active ? 'bg-primary/10' : 'hover:bg-secondary/25'}`}
      data-testid={`monitoring-rail-${row.def.key}`}
    >
      <span className="flex items-center gap-2 min-w-0">
        <Icon className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
        <span className="typo-caption font-medium text-foreground truncate flex-1 min-w-0">
          {d[`monitoring_item_${row.def.labelKey}`]}
        </span>
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: STATE_INK[row.state] }} aria-hidden />
      </span>
      <span className="block pl-6 typo-caption text-foreground/45 truncate" style={{ fontWeight: 400 }}>
        {row.bound?.name ?? row.detected ?? d.monitoring_none_dash}
      </span>
    </button>
  );
}

function Detail({ row, busy, deploying, onAssign, onDeploy }: {
  row: MonitoringRow;
  busy: boolean;
  deploying: boolean;
  onAssign: (credentialId: string | null) => void;
  onDeploy: () => void;
}) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const Icon = row.def.icon;

  return (
    <div className="min-h-0 flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10">
        <Icon className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
        <span className="typo-body font-semibold text-foreground truncate flex-1 min-w-0">
          {d[`monitoring_item_${row.def.labelKey}`]}
        </span>
        <StateMark state={row.state} />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Fact label={d.envslot_detected}>
            {row.detected ? <TechInk label={row.detected} /> : <Absent />}
          </Fact>
          <Fact label={d.envslot_connector}>
            {row.bound
              ? <BoundConnector credential={row.bound} healthy={row.health[row.bound.id]} busy={busy} onUnbind={() => onAssign(null)} />
              : <Absent />}
          </Fact>
        </div>

        {/* The deploy gets a real block here: what is wrong, what it would use,
            and the button — rather than a lone CTA you must already understand. */}
        {row.state === 'not_implemented' && row.bound && (
          <div className="rounded-card border border-primary/20 bg-primary/[0.06] p-3 space-y-2">
            <DeployNote />
            <div className="flex items-center gap-2 min-w-0">
              <ConnectorGlyph serviceType={row.bound.serviceType} size="w-3.5 h-3.5" />
              <span className="typo-caption text-foreground truncate flex-1 min-w-0" style={{ fontWeight: 400 }}>{row.bound.name}</span>
              <CardAction row={row} busy={busy} deploying={deploying} onPick={() => {}} onDeploy={onDeploy} compact />
            </div>
          </div>
        )}

        {/* Always open — choosing is reading a list, not entering a mode. */}
        <div>
          <p className="typo-caption text-foreground/45 mb-1" style={{ fontWeight: 400 }}>
            {d.monitoring_vault_available} · {tx(d.monitoring_vault_count, { count: row.candidates.length })}
          </p>
          <div className="space-y-0.5">
            {row.candidates.length === 0 && (
              <p className="typo-caption text-foreground/45 px-1 py-1" style={{ fontWeight: 400 }}>{d.envslot_no_candidates}</p>
            )}
            {row.candidates.map((c) => (
              <CandidateRow
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
    </div>
  );
}
