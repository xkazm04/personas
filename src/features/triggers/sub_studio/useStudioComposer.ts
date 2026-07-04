/**
 * useStudioComposer — the Chain Studio "compose" brain, backing the unified
 * ledger (`StudioPatchbay`), which fuses the compose draft with the live
 * routing inventory in one surface.
 *
 * Owns: the localStorage draft, the armed source/target/system-op patch state,
 * the two arming effects (source+target → draft link; source+system-op → commit
 * modal), and the commit path (persona→persona link → real `chain` trigger).
 * Live routing state (existing triggers/events/subscriptions) is NOT here — it
 * stays in `routing/layouts/useRoutingState`; the ledger composes both.
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
import {
  commitBlocker, draftLinkToTriggerInput, formConfigToTriggerInput, linkCommitsViaForm,
} from './libs/studioCommit';
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
  // Signal-source link being committed through the configure-&-commit modal
  // (the full trigger form, locked to the source's type).
  const [formCommit, setFormCommit] = useState<DraftLink | null>(null);
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
    // Signal-source links need per-type config — route to the
    // configure-&-commit modal instead of committing directly.
    if (linkCommitsViaForm(link)) {
      setFormCommit(link);
      return false;
    }
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

  /**
   * Create the trigger for the modal-hosted signal-source commit. Returns an
   * error string for the form's inline error slot (undefined = success), so
   * failures render where the user is looking instead of as a toast behind
   * the modal.
   */
  const commitFormLink = async (
    triggerType: string,
    config: Record<string, unknown>,
  ): Promise<string | undefined> => {
    const link = formCommit;
    if (!link) return undefined;
    try {
      await createTrigger(formConfigToTriggerInput(link, triggerType, config));
      setDraft((d) => ({ ...d, links: d.links.filter((l) => l.id !== link.id) }));
      setFormCommit(null);
      addToast(st.route_committed, 'success');
      onRouteCommitted?.();
      return undefined;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };

  /** Update the JSONPath params backing a link's `output_match` condition. */
  const setLinkOutputMatch = (id: string, path: string, expected: string) =>
    setDraft((d) => ({
      ...d,
      links: d.links.map((l) => (l.id === id ? { ...l, outputMatch: { path, expected } } : l)),
    }));

  // Direct-committable links only (persona sources) — signal-source links
  // need the interactive modal, so "Save all" can't include them.
  const committableLinks = draft.links.filter(
    (l) => commitBlocker(l) === null && !linkCommitsViaForm(l),
  );

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
    formCommit, setFormCommit, commitFormLink, setLinkOutputMatch,
    systemOpKinds: systemOps.kinds,
    automations: systemOps.automations,
    refreshAutomations: systemOps.refresh,
    toggleAutomation: systemOps.toggle,
    removeAutomation: systemOps.remove,
    runAutomationNow: systemOps.runNow,
  };
}

export type StudioComposer = ReturnType<typeof useStudioComposer>;
