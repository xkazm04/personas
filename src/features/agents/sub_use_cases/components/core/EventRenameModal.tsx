import { useEffect, useMemo, useState } from 'react';
import { X, Trash2, Plus, AlertTriangle } from 'lucide-react';
import {
  countEventListeners,
  renameEventListeners,
  setUseCaseGenerationSettings,
  type RenameConsumerAction,
  type UseCaseGenerationSettings,
} from '@/api/agents/useCases';
import type { DesignUseCase } from '@/lib/types/frontendTypes';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';

interface Props {
  personaId: string;
  useCase: DesignUseCase;
  settings: UseCaseGenerationSettings;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

interface Row {
  from: string;
  to: string;
  /** Consumer counts queried for the *original* alias `from` (i.e. what was
   *  in the alias map already). Empty for newly added rows. */
  existingCounts?: { subscriptions: number; triggers: number };
  /** Consumer counts queried for the new `to` value when from→to maps an
   *  event subscribers currently listen to. Drives the "harm" warning. */
  consumerCounts?: { subscriptions: number; triggers: number };
}

/**
 * Phase C5b — Event Rename Modal.
 *
 * Producer-side: stores the rename in `generation_settings.event_aliases`
 * (key = name LLM emits, value = name actually published).
 *
 * Consumer-side: when the user enters a `from` event name, we query how many
 * other personas/triggers currently listen for it. Renaming may break those
 * consumers. The user picks one of:
 *   - Update consumers to listen to the new name
 *   - Delete those consumer connections
 *   - Leave consumers (they'll silently stop receiving the event)
 */
export function EventRenameModal({ personaId, useCase, settings, onClose, onSaved }: Props) {
  const initialRows: Row[] = useMemo(() => {
    const aliases = settings.event_aliases ?? {};
    const entries = Object.entries(aliases);
    return entries.length > 0
      ? entries.map(([from, to]) => ({ from, to }))
      : [{ from: '', to: '' }];
  }, [settings.event_aliases]);

  const [rows, setRows] = useState<Row[]>(initialRows);
  const [action, setAction] = useState<RenameConsumerAction>('update');
  const [saving, setSaving] = useState(false);

  // Whenever the user finishes typing in either column, query consumer counts
  // for the FROM (existing-alias breakage) and for the TO (will-it-route).
  useEffect(() => {
    let cancelled = false;
    const queries = rows
      .map((r, i) => ({ row: r, index: i }))
      .filter(({ row }) => row.from.trim().length > 0);
    Promise.all(
      queries.flatMap(({ row, index }) => [
        countEventListeners(row.from.trim(), personaId).then((c) => ({ index, kind: 'from' as const, c })),
        row.to.trim().length > 0
          ? countEventListeners(row.to.trim(), personaId).then((c) => ({ index, kind: 'to' as const, c }))
          : Promise.resolve(null),
      ]),
    )
      .then((results) => {
        if (cancelled) return;
        setRows((prev) => {
          const next: Row[] = prev.map((r) => ({ ...r }));
          for (const r of results) {
            if (!r) continue;
            const target = next[r.index];
            if (!target) continue;
            if (r.kind === 'from') next[r.index] = { ...target, existingCounts: r.c };
            if (r.kind === 'to') next[r.index] = { ...target, consumerCounts: r.c };
          }
          return next;
        });
      })
      .catch(() => { /* silent — counts are advisory */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.map((r) => `${r.from}|${r.to}`).join(','), personaId]);

  const totalConsumers = rows.reduce(
    (sum, r) => sum + (r.existingCounts?.subscriptions ?? 0) + (r.existingCounts?.triggers ?? 0),
    0,
  );

  const setRow = (i: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };
  const addRow = () => setRows((prev) => [...prev, { from: '', to: '' }]);
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, j) => j !== i));

  const handleSave = async () => {
    setSaving(true);
    try {
      const aliasMap: Record<string, string> = {};
      for (const r of rows) {
        const from = r.from.trim();
        const to = r.to.trim();
        if (from && to) aliasMap[from] = to;
      }

      const next: UseCaseGenerationSettings = {
        ...settings,
        event_aliases: Object.keys(aliasMap).length > 0 ? aliasMap : undefined,
      };

      // 1. Persist the alias map onto the capability.
      await setUseCaseGenerationSettings(personaId, useCase.id, next);

      // 2. Reconcile consumers per the user's chosen action — only for rows
      //    that have an existing-from-name with consumers, and only when the
      //    chosen action isn't "leave".
      if (action !== 'leave') {
        const reconciles = rows
          .filter((r) => r.from.trim().length > 0 && r.to.trim().length > 0)
          .filter((r) => (r.existingCounts?.subscriptions ?? 0) + (r.existingCounts?.triggers ?? 0) > 0)
          .map((r) =>
            renameEventListeners(r.from.trim(), r.to.trim(), action, personaId),
          );
        if (reconciles.length > 0) {
          const results = await Promise.all(reconciles);
          const totalSubs = results.reduce((s, r) => s + r.subscriptions_touched, 0);
          const totalTrigs = results.reduce((s, r) => s + r.triggers_touched, 0);
          if (totalSubs + totalTrigs > 0) {
            useToastStore.getState().addToast(
              `${action === 'update' ? 'Updated' : 'Deleted'} ${totalSubs} subscription${totalSubs === 1 ? '' : 's'} and ${totalTrigs} trigger${totalTrigs === 1 ? '' : 's'}`,
              'success',
            );
          }
        }
      }

      useToastStore.getState().addToast('Event aliases saved', 'success');
      await onSaved();
      onClose();
    } catch (err) {
      toastCatch('EventRenameModal:save')(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 w-full max-w-2xl mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-primary/10 bg-secondary/20">
          <div>
            <h3 className="typo-heading text-foreground/95">Rename emitted events</h3>
            <p className="typo-caption text-foreground/60">
              Capability: <span className="text-foreground/85">{useCase.title}</span>
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-secondary/60 text-foreground/60">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 max-h-[65vh] overflow-y-auto space-y-3">
          <p className="typo-body text-foreground/70">
            Map each event the LLM emits to the name it should be published as. Subscribers listen to the published name.
          </p>

          <div className="space-y-2">
            <div className="flex items-center gap-2 typo-caption uppercase tracking-wider text-foreground/50">
              <span className="flex-1">Emit (LLM&rsquo;s name)</span>
              <span className="flex-1">Publish as</span>
              <span className="w-8" />
            </div>
            {rows.map((r, i) => {
              const fromConsumers =
                (r.existingCounts?.subscriptions ?? 0) + (r.existingCounts?.triggers ?? 0);
              const toConsumers =
                (r.consumerCounts?.subscriptions ?? 0) + (r.consumerCounts?.triggers ?? 0);
              return (
                <div key={i} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <input
                      value={r.from}
                      onChange={(e) => setRow(i, { from: e.target.value, existingCounts: undefined })}
                      placeholder="alert"
                      className="flex-1 px-2 py-1.5 rounded border border-primary/15 bg-secondary/20 typo-body text-foreground outline-none focus:border-primary/40"
                    />
                    <input
                      value={r.to}
                      onChange={(e) => setRow(i, { to: e.target.value, consumerCounts: undefined })}
                      placeholder="escalation"
                      className="flex-1 px-2 py-1.5 rounded border border-primary/15 bg-secondary/20 typo-body text-foreground outline-none focus:border-primary/40"
                    />
                    <button
                      onClick={() => removeRow(i)}
                      disabled={rows.length === 1}
                      className="p-1.5 rounded text-foreground/50 hover:text-red-400 disabled:opacity-30"
                      title="Remove row"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {r.from.trim() && (
                    <div className="flex items-center gap-3 text-foreground/55 typo-caption pl-1">
                      {fromConsumers > 0 ? (
                        <span className="inline-flex items-center gap-1 text-amber-400/80">
                          <AlertTriangle className="w-3 h-3" />
                          {fromConsumers} consumer{fromConsumers === 1 ? '' : 's'} currently listen for &ldquo;{r.from}&rdquo;
                        </span>
                      ) : (
                        <span>No external consumers listen for &ldquo;{r.from}&rdquo;</span>
                      )}
                      {r.to.trim() && toConsumers > 0 && (
                        <span>{toConsumers} already listen for &ldquo;{r.to}&rdquo;</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <button
              onClick={addRow}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-dashed border-primary/20 text-foreground/60 hover:text-primary hover:border-primary/40 typo-caption"
            >
              <Plus className="w-3 h-3" /> Add another rename
            </button>
          </div>

          {totalConsumers > 0 && (
            <div className="rounded border border-amber-500/25 bg-amber-500/5 p-3">
              <div className="flex items-center gap-2 typo-body text-amber-300/90 mb-2">
                <AlertTriangle className="w-4 h-4" />
                Consumers will be affected by this rename
              </div>
              <p className="typo-caption text-foreground/70 mb-2">
                Pick how to handle the {totalConsumers} existing consumer
                {totalConsumers === 1 ? '' : 's'}. (Excludes this persona.)
              </p>
              <div className="flex flex-col gap-1.5">
                {(['update', 'delete', 'leave'] as RenameConsumerAction[]).map((opt) => (
                  <label key={opt} className="flex items-start gap-2 typo-body text-foreground/85 cursor-pointer">
                    <input
                      type="radio"
                      name="rename-action"
                      value={opt}
                      checked={action === opt}
                      onChange={() => setAction(opt)}
                      className="mt-1"
                    />
                    <span>
                      <span className="font-medium capitalize">{opt}</span>
                      {opt === 'update' && (
                        <span className="text-foreground/60"> — rewrite consumers to listen for the new name</span>
                      )}
                      {opt === 'delete' && (
                        <span className="text-foreground/60"> — drop those subscriptions/triggers entirely</span>
                      )}
                      {opt === 'leave' && (
                        <span className="text-foreground/60"> — consumers will silently stop receiving the event</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-primary/10 bg-secondary/10">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-3 py-1.5 typo-body rounded border border-primary/15 bg-secondary/30 text-foreground hover:bg-secondary/50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 typo-body rounded bg-primary/85 text-primary-foreground hover:bg-primary disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save aliases'}
          </button>
        </div>
      </div>
    </div>
  );
}
