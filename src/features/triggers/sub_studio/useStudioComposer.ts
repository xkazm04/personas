/**
 * useStudioComposer — the Chain Studio "compose" brain, lifted out of
 * StudioSwitchboard so the deep-merge variants (which fuse the compose draft
 * with the live routing inventory in one ledger) can share it.
 *
 * Owns: the localStorage draft, the armed source/target/system-op patch state,
 * the two arming effects (source+target → draft link; source+system-op → commit
 * modal), and the commit path (persona→persona link → real `chain` trigger).
 * Live routing state (existing triggers/events/subscriptions) is NOT here — it
 * stays in `routing/layouts/useRoutingState`; the variants compose both.
 */
import { useEffect, useMemo, useState } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { attentionFor } from '@/features/home/sub_cockpit/widgets/personaStats';
import { createTrigger } from '@/api/pipeline/triggers';
import { toastCatch } from '@/lib/silentCatch';
import {
  loadDraft, saveDraft, newLinkId, LINK_CONDITION_PRESETS,
  type ChainDraft, type DraftSource, type DraftLink,
} from './libs/studioDraftModel';
import { commitBlocker, draftLinkToTriggerInput } from './libs/studioCommit';
import { useSystemOpStudio } from './system_ops/useSystemOpStudio';

export function useStudioComposer(onRouteCommitted?: () => void) {
  const { t, tx } = useTranslation();
  const st = t.triggers.studio;
  const personas = useAgentStore((s) => s.personas);
  const addToast = useToastStore((s) => s.addToast);
  const systemOps = useSystemOpStudio();

  const [draft, setDraft] = useState<ChainDraft>(() => loadDraft());
  const [armedSource, setArmedSource] = useState<DraftSource | null>(null);
  const [armedTarget, setArmedTarget] = useState<string | null>(null);
  const [armedSystemOp, setArmedSystemOp] = useState<string | null>(null);
  const [commit, setCommit] = useState<{ opKind: string; triggerType: string } | null>(null);
  const [committing, setCommitting] = useState<Set<string>>(new Set());

  useEffect(() => { saveDraft(draft); }, [draft]);

  // source + target persona → a draft link.
  useEffect(() => {
    if (armedSource && armedTarget) {
      setDraft((d) => ({
        ...d,
        links: [...d.links, { id: newLinkId(), source: armedSource, targetPersonaId: armedTarget, condition: null }],
      }));
      setArmedSource(null);
      setArmedTarget(null);
    }
  }, [armedSource, armedTarget]);

  // source + system-op → commit modal (system ops need a trigger, not a persona).
  useEffect(() => {
    if (armedSource && armedSystemOp) {
      const ok = armedSource.kind === 'trigger'
        && (armedSource.triggerType === 'schedule' || armedSource.triggerType === 'event_listener');
      if (ok && armedSource.kind === 'trigger') {
        setCommit({ opKind: armedSystemOp, triggerType: armedSource.triggerType });
      } else {
        addToast(st.system_event_needs_trigger, 'error');
      }
      setArmedSource(null);
      setArmedSystemOp(null);
    }
  }, [armedSource, armedSystemOp, addToast, st.system_event_needs_trigger]);

  const healthyPersonas = useMemo(() => personas.filter((p) => attentionFor(p) === null), [personas]);

  const removeLink = (id: string) =>
    setDraft((d) => ({ ...d, links: d.links.filter((l) => l.id !== id) }));
  const clearAll = () => setDraft({ version: 1, links: [] });
  const cycleCondition = (id: string) =>
    setDraft((d) => ({
      ...d,
      links: d.links.map((l) => {
        if (l.id !== id) return l;
        const i = LINK_CONDITION_PRESETS.indexOf(l.condition);
        return { ...l, condition: LINK_CONDITION_PRESETS[(i + 1) % LINK_CONDITION_PRESETS.length] ?? null };
      }),
    }));

  const commitLink = async (link: DraftLink, opts?: { silent?: boolean }): Promise<boolean> => {
    const input = draftLinkToTriggerInput(link);
    if (!input) return false;
    setCommitting((s) => new Set(s).add(link.id));
    try {
      await createTrigger(input);
      setDraft((d) => ({ ...d, links: d.links.filter((l) => l.id !== link.id) }));
      if (!opts?.silent) { addToast(st.route_committed, 'success'); onRouteCommitted?.(); }
      return true;
    } catch (e) {
      toastCatch('useStudioComposer:commitLink', st.route_commit_failed)(e);
      return false;
    } finally {
      setCommitting((s) => { const n = new Set(s); n.delete(link.id); return n; });
    }
  };

  const committableLinks = draft.links.filter((l) => commitBlocker(l) === null);

  const commitAll = async () => {
    let n = 0;
    for (const link of committableLinks) {
      if (await commitLink(link, { silent: true })) n += 1;
    }
    if (n > 0) { addToast(tx(st.routes_committed, { count: n }), 'success'); onRouteCommitted?.(); }
  };

  return {
    t, tx, st,
    personas, healthyPersonas, addToast,
    draft, removeLink, clearAll, cycleCondition,
    armedSource, setArmedSource,
    armedTarget, setArmedTarget,
    armedSystemOp, setArmedSystemOp,
    committing, commitLink, commitAll, committableLinks,
    commit, setCommit,
    systemOpKinds: systemOps.kinds,
    automations: systemOps.automations,
    refreshAutomations: systemOps.refresh,
    toggleAutomation: systemOps.toggle,
    removeAutomation: systemOps.remove,
    runAutomationNow: systemOps.runNow,
  };
}

export type StudioComposer = ReturnType<typeof useStudioComposer>;
