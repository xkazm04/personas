import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import { useSelectedCredentialLinks } from '@/stores/selectors/personaSelectors';
import type { GlyphDimension } from '@/features/shared/glyph';
import { PersonaLayout } from '@/features/shared/glyph/persona-layout';
import { PersonaSigilSummary } from '@/features/shared/glyph/persona-layout/PersonaSigilSummary';
import { SigilEditModal } from '@/features/shared/glyph/persona-layout/SigilEditModal';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { ListSkeleton } from '@/features/shared/components/layout/ListSkeleton';
import { resolvePersonaCapabilities } from '@/lib/personas/capabilities';
import { toastCatch } from '@/lib/silentCatch';
import { useCharters } from './libs/useCharters';
import { charterSummaryEntries, charterPetalStates } from './libs/charterSummary';
import { CharterFocusButton } from './components/CharterFocusButton';
import { CharterMasterHeader } from './components/CharterMasterHeader';
import type { CharterStatus } from './components/CharterStatusLadder';
import { CharterDetail } from './components/CharterDetail';
import { resolveCharterSigilBody } from './components/sigil/charterSigilBodies';
import type { CharterPatch } from './components/sigil/dimEditorShell';

/**
 * Persona editor -> Responsibilities. The consolidated capability surface:
 * charters are what a persona can do since migration `e19_agent_manifest`, so
 * this tab absorbed the former Use Cases tab (glyph master/detail), the former
 * Parameters tab (per-charter `{{param.*}}` knobs), and the flat charter table
 * that used to live under `sub_life`.
 *
 * Master = the persona hero sigil for the ACTIVE charter plus one row per
 * charter; detail = the full-surface `CharterDetail`. Petals are editable in
 * both halves through the same per-dimension bodies.
 */
export function ResponsibilitiesTab() {
  const { t } = useTranslation();
  const c = t.agents.responsibilities;
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const personaId = selectedPersona?.id ?? '';
  const { charters, isLoading, reload, patchCharter, retireCharter, setCharterStatus } =
    useCharters(personaId);

  const credentialLinks = useSelectedCredentialLinks();
  const personaConnectors = useMemo(() => new Set(Object.keys(credentialLinks)), [credentialLinks]);

  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingPetal, setEditingPetal] = useState<GlyphDimension | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  // Seeded with every rung so a status with no charters renders a REAL zero
  // the list was counted for, not an absent key coerced to one at the render
  // site. The `as` narrowing is guarded by the `in` test on the same line: the
  // seed's keys are exactly CHARTER_STATUSES, so a status that passes `in out`
  // is one of them — a row carrying an unknown status (only reachable if the
  // DB CHECK is widened ahead of this file) is skipped, not miscounted.
  const counts = useMemo<Record<CharterStatus, number>>(() => {
    const out: Record<CharterStatus, number> = { draft: 0, active: 0, suspended: 0, retired: 0 };
    for (const r of charters) if (r.status in out) out[r.status as CharterStatus] += 1;
    return out;
  }, [charters]);

  const visible = useMemo(
    () => (statusFilter ? charters.filter((r) => r.status === statusFilter) : charters),
    [charters, statusFilter],
  );

  const items = useMemo(
    () => resolvePersonaCapabilities({ charters: visible, personaConnectors, t }),
    [visible, personaConnectors, t],
  );

  const activeCapability = useMemo(
    () => items.find((i) => i.id === activeId) ?? items[0] ?? null,
    [items, activeId],
  );
  const activeCharter = activeCapability?.charter ?? null;
  const selectedCapability = selectedId ? items.find((i) => i.id === selectedId) ?? null : null;

  const heroPetalStates = useMemo(
    () => (activeCapability ? charterPetalStates(activeCapability) : undefined),
    [activeCapability],
  );

  const patch = useCallback(
    async (id: string, p: CharterPatch) => {
      try {
        await patchCharter(id, p);
      } catch (err) {
        toastCatch('responsibilities:patch', t.agents.life.save_failed)(err);
        throw err;
      }
    },
    [patchCharter, t],
  );

  if (!selectedPersona) {
    return (
      <EmptyState
        title={t.agents.use_cases.no_persona_selected_title}
        description={t.agents.use_cases.no_persona_selected_desc}
      />
    );
  }

  const detailNode =
    selectedCapability?.charter ? (
      <CharterDetail
        charter={selectedCapability.charter}
        capability={selectedCapability}
        personaId={personaId}
        onPatch={(p) => patch(selectedCapability.charter!.id, p)}
        onRetire={async () => {
          await retireCharter(selectedCapability.charter!.id);
        }}
        onSetStatus={async (status) => {
          await setCharterStatus(selectedCapability.charter!.id, status);
        }}
        onSaved={() => void reload()}
        onBack={() => setSelectedId(null)}
      />
    ) : null;

  const summaryEntries = activeCapability ? charterSummaryEntries(activeCapability, t) : {};

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="resp-tab">
      <div className="flex-1 min-h-0">
        <PersonaLayout
          mode="view"
          personaName={selectedPersona.name ?? ''}
          items={items}
          selectedItemId={selectedId}
          onRowOpen={(cap) => {
            setActiveId(cap.id);
            setSelectedId(cap.id);
          }}
          onRowToggle={(cap) => setActiveId(cap.id)}
          renderRowPolicySlot={(cap) => (
            <CharterFocusButton charterId={cap.id} onFocus={() => setActiveId(cap.id)} />
          )}
          hideMetadataBand
          topSlot={
            <CharterMasterHeader
              personaId={personaId}
              counts={counts}
              statusFilter={statusFilter}
              onStatusFilter={setStatusFilter}
              inboxOpen={inboxOpen}
              onToggleInbox={() => setInboxOpen((v) => !v)}
              creating={creating}
              onStartCreate={() => setCreating(true)}
              onCancelCreate={() => setCreating(false)}
              onChanged={() => void reload()}
            />
          }
          heroPetalStatesOverride={heroPetalStates}
          heroActiveDim={editingPetal}
          onHeroPetalClick={(dim) => {
            if (!activeCharter) return;
            setEditingPetal((prev) => (prev === dim ? null : dim));
          }}
          heroWideOverlay={
            editingPetal && activeCharter ? (
              <SigilEditModal
                dim={editingPetal}
                isActive={activeCapability?.dimensions.includes(editingPetal) ?? false}
                body={resolveCharterSigilBody(editingPetal, {
                  charter: activeCharter,
                  onPatch: (p) => patch(activeCharter.id, p),
                })}
                onToggleActive={() => setEditingPetal(null)}
                onClose={() => setEditingPetal(null)}
              />
            ) : undefined
          }
          leftSlot={
            Object.keys(summaryEntries).length > 0 ? (
              <PersonaSigilSummary
                entries={summaryEntries}
                heading={c.dimensions_label}
                onSelectDim={(dim) => {
                  if (!activeCharter) return;
                  setEditingPetal((prev) => (prev === dim ? null : dim));
                }}
              />
            ) : null
          }
          detailNode={detailNode}
          emptyNode={
            isLoading ? (
              <ListSkeleton rows={3} />
            ) : (
              <EmptyState title={c.empty_title} description={c.empty_body} />
            )
          }
        />
      </div>
    </div>
  );
}
