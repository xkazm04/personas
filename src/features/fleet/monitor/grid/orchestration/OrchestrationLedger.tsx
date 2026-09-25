// OrchestrationLedger — the Orchestration panel's table.
//
// Was `ScheduleOrchestration` on the Schedules page (and `LedgerVariant`
// before that, the winner of the 2026-09-14 prototype round). It moved to the
// Monitor's Activity board with the rest of the autonomous-agent layer.
//
// Metaphor: a ledger. Every input the admission ladder reads is a column —
// persona, charters, interval floor, last served, wake, lane — and the next
// tick's verdict is the last column, so the operator can see WHY a persona
// waits (its floor, its cap, its budget) in the same row as the fact that it
// does. Numerals are tabular. Four big counters above the table say what the
// tick would do in aggregate.
//
// READ-ONLY (2026-09-17): the drag column, the ↑/↓ buttons and the rank mark
// left with the dispatch-order editor — order editing is being replaced by
// the board queue. Rows sit in the order the loop will walk them.
//
// THE ACTIVE SWITCH (2026-09-15) is the first cell: the same
// `personas.enabled` the editor header and the Monitor tile flip, through
// `set_persona_enabled`. A switched-off persona stays in the table, in its
// place, dimmed and with the `disabled` verdict — the preview lists it
// precisely so it can be switched back on here. The switch paints the new
// value at once and holds it until the preview agrees; a failed write drops
// the held value, so the row falls back to what the server says.

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import { toastCatch } from '@/lib/silentCatch';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useOffProjectForPersona } from '@/features/plugins/dev-tools/sub_projects/projectSwitch/useProjectSwitch';
import type { DispatchPreviewRow } from '@/lib/bindings/DispatchPreviewRow';
import type { DispatchPreviewView } from '@/lib/bindings/DispatchPreviewView';
import { countHeld, type DispatchPreviewState } from './useDispatchPreview';
import { LaneChip, PersonaIdentity, VerdictChip } from './parts';

const TH = 'px-3 py-2 text-left typo-label text-foreground';
const TD = 'px-3 py-2 align-middle typo-caption text-foreground';

function Counter({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="flex flex-col rounded-card border border-border bg-secondary/10 px-4 py-3">
      <span className={`typo-data-lg ${tone}`}>{value}</span>
      <span className="typo-label text-foreground">{label}</span>
    </div>
  );
}

function OrchestrationRow({
  row, enabled, busy, onToggle,
}: {
  row: DispatchPreviewRow;
  /** The switch as painted — the held value while a write settles. */
  enabled: boolean;
  busy: boolean;
  onToggle: (row: DispatchPreviewRow, next: boolean) => void;
}) {
  const { t, tx } = useTranslation();
  const s = t.monitor;
  // A switched-off project overrules the persona's switch (the preview already
  // reports the row as disabled): hold the toggle and say why on hover.
  const offProject = useOffProjectForPersona(row.personaId);
  // Everything but the switch steps back on an Off row: it stays operable, the
  // rest is a record of a persona that is not running.
  const cell = `${TD} ${enabled ? '' : 'opacity-50'}`;
  return (
    <tr
      className="group border-t border-border/60 bg-background hover:bg-secondary/20"
      data-testid={`ledger-row-${row.personaId}`}
      data-enabled={enabled}
    >
      <td className={`${TD} w-12`}>
        {offProject ? (
          <Tooltip content={tx(t.plugins.dev_projects.project_off_hint, { project: offProject.name })} triggerFocusable>
            <span className="inline-flex pointer-events-none opacity-60" data-project-off>
              <AccessibleToggle
                size="sm"
                checked={false}
                onChange={() => {}}
                label={tx(s.orch_toggle_aria, { name: row.personaName })}
                disabled
                data-testid={`orchestration-toggle-${row.personaId}`}
              />
            </span>
          </Tooltip>
        ) : (
          <AccessibleToggle
            size="sm"
            checked={enabled}
            onChange={() => onToggle(row, !enabled)}
            label={tx(s.orch_toggle_aria, { name: row.personaName })}
            disabled={busy}
            data-testid={`orchestration-toggle-${row.personaId}`}
          />
        )}
      </td>
      <td className={`${cell} min-w-[12rem]`}>
        <PersonaIdentity row={row} dense />
      </td>
      <td className={`${cell} tabular-nums`}>{row.charters}</td>
      <td className={`${cell} tabular-nums`}>
        {tx(s.orch_interval, { minutes: row.intervalMinutes })}
        {row.selfPaced && <span className="ml-1 opacity-60">{s.orch_self_paced}</span>}
      </td>
      <td className={cell}>{row.lastServedAt ? <RelativeTime timestamp={row.lastServedAt} /> : s.orch_never_served}</td>
      <td className={cell}>{row.wakePending ? s.orch_wake_pending : '—'}</td>
      <td className={cell}>
        <LaneChip lane={row.lane} />
      </td>
      <td className={cell}>
        <VerdictChip row={row} />
      </td>
    </tr>
  );
}

export function OrchestrationLedger({ state, view }: { state: DispatchPreviewState; view: DispatchPreviewView }) {
  const { t } = useTranslation();
  const s = t.monitor;
  const { rows, refresh } = state;
  const held = countHeld(rows);
  const setPersonaEnabled = useAgentStore((st) => st.setPersonaEnabled);

  // Per-row, not a scalar: two switches flipped in quick succession are two
  // writes, and one settling must not re-enable the other.
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [heldValue, setHeldValue] = useState<ReadonlyMap<string, boolean>>(() => new Map());

  // A held value is released once the preview agrees with it — not when the
  // write resolves, because the preview that lands first may predate it.
  useEffect(() => {
    setHeldValue((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      for (const r of rows) if (next.get(r.personaId) === r.enabled) next.delete(r.personaId);
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  const onToggle = useCallback(
    (row: DispatchPreviewRow, next: boolean) => {
      const id = row.personaId;
      setPending((p) => new Set(p).add(id));
      setHeldValue((h) => new Map(h).set(id, next));
      setPersonaEnabled(id, next)
        .then(() => refresh())
        .catch((err: unknown) => {
          setHeldValue((h) => {
            const n = new Map(h);
            n.delete(id);
            return n;
          });
          toastCatch('monitor/OrchestrationLedger:toggle', s.orch_toggle_failed)(err);
        })
        .finally(() => {
          setPending((p) => {
            const n = new Set(p);
            n.delete(id);
            return n;
          });
        });
    },
    [setPersonaEnabled, refresh, s.orch_toggle_failed],
  );

  return (
    <div className="space-y-3" data-testid="orchestration-ledger">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Counter value={view.preview.budget} label={s.orch_budget_starts} tone="text-foreground" />
        <Counter value={view.preview.wouldStart} label={s.orch_would_start} tone="text-status-success" />
        <Counter value={view.preview.waiting} label={s.orch_waiting} tone="text-status-warning" />
        <Counter value={held} label={s.orch_band_held} tone="text-status-error" />
      </div>
      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full border-collapse">
          <thead className="bg-secondary/20">
            <tr>
              <th className={TH}>{s.orch_col_active}</th>
              <th className={TH}>{s.orch_col_persona}</th>
              <th className={TH}>{s.orch_col_charters}</th>
              <th className={TH}>{s.orch_col_interval}</th>
              <th className={TH}>{s.orch_col_last_served}</th>
              <th className={TH}>{s.orch_col_wake}</th>
              <th className={TH}>{s.orch_col_lane}</th>
              <th className={TH}>{s.orch_col_next_tick}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <OrchestrationRow
                key={row.personaId}
                row={row}
                enabled={heldValue.get(row.personaId) ?? row.enabled}
                busy={pending.has(row.personaId)}
                onToggle={onToggle}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default OrchestrationLedger;
