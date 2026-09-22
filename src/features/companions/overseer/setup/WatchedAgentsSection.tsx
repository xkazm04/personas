// Overseer > Setup - the roster he watches, and the two ways to change it.
//
// Starring IS the scope. There is no second list to keep in step: the star on
// a persona is what puts it in Overseer's roster, and the copy says so out
// loud (`overseer_scope_desc`) because the same star also marks a favourite
// elsewhere in the app - a shared meaning the operator should learn from the
// control rather than discover from the consequence.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Star, UserPlus } from 'lucide-react';

import { setPersonaStarred } from '@/api/agents/personas';
import { AddToScopeModal } from '@/features/companions/overseer/components/AddToScopeModal';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { useAgentStore } from '@/stores/agentStore';

export function WatchedAgentsSection() {
  const { t } = useTranslation();
  const personas = useAgentStore((s) => s.personas);
  const [addOpen, setAddOpen] = useState(false);

  const watched = useMemo(() => personas.filter((p) => p.starred), [personas]);

  // Companions is its own section, so the agent roster may never have been
  // fetched when this page is the first thing opened. Without this the page
  // would state "no agent is starred yet" over a roster it has not read — the
  // one sentence that must never be a guess, since it is also Overseer's
  // prerequisite. Fetched only when the store is empty; a loaded roster is
  // kept current by the star writes below.
  useEffect(() => {
    if (personas.length > 0) return;
    useAgentStore
      .getState()
      .fetchPersonas()
      .catch(silentCatch('overseer_setup:fetchPersonas'));
    // Runs once on mount: re-running it as the roster arrives would refetch
    // for an install that genuinely has no agents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Both directions go through the same door, so the `companions://status-changed`
  // event the backend emits on a star reaches the switch above either way.
  const setStar = useCallback(async (personaId: string, starred: boolean) => {
    try {
      await setPersonaStarred(personaId, starred);
      await useAgentStore.getState().fetchPersonas();
    } catch (err) {
      toastCatch('overseer_setup:setPersonaStarred')(err);
    }
  }, []);

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="typo-title">{t.companions.setup.overseer_scope_title}</h3>
          <p className="typo-caption mt-1">{t.companions.setup.overseer_scope_desc}</p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          icon={<UserPlus className="w-3.5 h-3.5" />}
          onClick={() => setAddOpen(true)}
        >
          {t.companions.setup.overseer_scope_add}
        </Button>
      </div>

      {watched.length === 0 ? (
        <EmptyState icon={Star} title={t.companions.setup.overseer_scope_empty} />
      ) : (
        <ul className="rounded-card border border-primary/10 divide-y divide-foreground/5">
          {watched.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2.5">
              <PersonaIcon icon={p.icon} color={p.color} size="w-4 h-4" />
              <span className="typo-body text-foreground truncate flex-1">{p.name}</span>
              {/* AsyncButton, not Button: this is a per-ROW mutation, so the
                  busy state has to belong to the row that was pressed. It
                  self-disables synchronously at click time, which is what stops
                  a double-click unstarring and re-starring. */}
              <AsyncButton size="xs" variant="ghost" onClick={() => setStar(p.id, false)}>
                {t.companions.setup.overseer_scope_remove}
              </AsyncButton>
            </li>
          ))}
        </ul>
      )}

      <AddToScopeModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        personas={personas}
        onAdd={(personaId) => void setStar(personaId, true)}
      />
    </section>
  );
}
