import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck, Plus } from 'lucide-react';
import {
  listOutputAssertions,
  deleteOutputAssertion,
} from '@/api/agents/outputAssertions';
import type { OutputAssertion } from '@/lib/bindings/OutputAssertion';
import { Button } from '@/features/shared/components/buttons';
import { toastCatch } from '@/lib/silentCatch';
import { createLatestWins } from '@/stores/util/latestWins';
import { useTranslation } from '@/i18n/useTranslation';
import { AssertionAddForm } from './AssertionAddForm';
import { AssertionRow } from './AssertionRow';

/**
 * Quality gates — declarative output assertions attached to a persona and
 * evaluated on every run. The backend (`create_output_assertion` +
 * `engine::output_assertions`) supported this end to end, but no UI ever called
 * `outputAssertions.ts` (UAT 2026-07-20, FA-RRE-03: the only configurable
 * quality gate was unreachable). This surfaces the two highest-value types
 * ("must contain" / "must not contain") with an on-failure action; richer types
 * (regex / json_path / json_schema / length) can extend the type ThemedSelect
 * and the typeLabel map later.
 */
export function PersonaAssertionsSection({ personaId }: { personaId: string }) {
  const { t } = useTranslation();
  const a = t.agents.assertions;
  const [assertions, setAssertions] = useState<OutputAssertion[]>([]);
  // Loading, failed and truly empty must not render alike: the empty line is
  // only said after a load succeeded with zero rows.
  const [loadState, setLoadState] = useState<'loading' | 'failed' | 'loaded'>('loading');
  // The form is open only for the persona it was opened on: the section stays
  // mounted across a persona switch, so a bare boolean would carry a half-typed
  // draft to the next persona and Create it there.
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const adding = addingFor === personaId;

  // The section stays mounted across a persona switch, so a slower response for
  // the previous persona must not paint (or become deletable) under the new one.
  const latestWins = useRef(createLatestWins()).current;
  const refresh = useCallback(async () => {
    const token = latestWins.next();
    try {
      const rows = await listOutputAssertions(personaId);
      if (!latestWins.isCurrent(token)) return;
      setAssertions(rows);
      setLoadState('loaded');
    } catch (err) {
      if (!latestWins.isCurrent(token)) return;
      setLoadState((prev) => (prev === 'loaded' ? prev : 'failed'));
      toastCatch('assertions:list')(err);
    }
  }, [personaId, latestWins]);

  useEffect(() => {
    setLoadState('loading');
    setAssertions([]);
    void refresh();
    // A persona switch or unmount retires every response still in flight.
    return () => { latestWins.next(); };
  }, [refresh, latestWins]);

  const handleDelete = async (id: string) => {
    try {
      await deleteOutputAssertion(id);
      await refresh();
    } catch (err) {
      toastCatch('assertions:delete')(err);
    }
  };

  return (
    <div className="space-y-3 relative z-10">
      <h4 className="flex items-center gap-2.5 typo-submodule-header">
        <ShieldCheck className="w-4 h-4 text-primary/70" />
        {a.title}
      </h4>
      <div className="bg-secondary/40 border border-primary/20 rounded-modal p-3 space-y-2.5">
        <p className="typo-caption text-foreground">{a.subtitle}</p>

        {loadState === 'loaded' && assertions.length === 0 && !adding && (
          <p className="typo-body text-foreground py-1">{a.empty}</p>
        )}

        {loadState === 'failed' && (
          <div className="flex items-center gap-2 py-1">
            <p className="typo-body text-status-error">{a.load_failed}</p>
            <Button variant="ghost" size="sm" onClick={() => void refresh()}>
              {t.common.retry}
            </Button>
          </div>
        )}

        {assertions.map((row) => (
          <AssertionRow key={row.id} row={row} onDelete={handleDelete} />
        ))}

        {adding ? (
          <AssertionAddForm personaId={personaId} onCreated={refresh} onClose={() => setAddingFor(null)} />
        ) : (
          <Button variant="secondary" size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setAddingFor(personaId)}>
            {a.add}
          </Button>
        )}
      </div>
    </div>
  );
}
