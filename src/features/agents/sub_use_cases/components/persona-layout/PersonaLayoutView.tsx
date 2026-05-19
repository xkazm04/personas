import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { updatePersona, buildUpdateInput } from '@/api/agents/personas';
import { silentCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { getMemoryCount } from '@/api/overview/memories';
import { listManualReviews } from '@/api/overview/reviews';
import { useSelectedCredentialLinks } from '@/stores/selectors/personaSelectors';
import { AddCapabilityRow, PersonaLayout } from '@/features/shared/glyph/persona-layout';
import { PersonaSigilSummary, type PersonaSigilSummaryEntry } from '@/features/shared/glyph/persona-layout/PersonaSigilSummary';
import { CapabilityTabBar } from '@/features/shared/glyph/persona-layout/CapabilityTabBar';
import { SigilEditModal } from '@/features/shared/glyph/persona-layout/SigilEditModal';
import { resolveSigilEditBody } from '@/features/shared/glyph/persona-layout/sigilEditBodies';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { GLYPH_DIMENSIONS } from '@/features/shared/glyph';
import type { GlyphDimension } from '@/features/shared/glyph';
import type { PetalState } from '@/features/shared/glyph/persona-sigil';
import { useSystemStore } from '@/stores/systemStore';
import type { CredentialMetadata } from '@/lib/types/types';
import { useUseCasesTab } from '../../libs/useUseCasesTab';
import { useCapabilityToggle } from '../../libs/useCapabilityToggle';
import { CapabilityDisableDialog } from '../core/CapabilityDisableDialog';
import { UseCaseDetailExpanded } from '../recipes-prototype/shared/UseCaseDetailExpanded';
import { TilePolicyToggles } from '../recipes-prototype/shared/TilePolicyToggles';
import {
  toDisplayUseCase,
  getDimLabels,
  type DisplayUseCase,
} from '../recipes-prototype/shared/displayUseCase';

interface PersonaLayoutViewProps {
  credentials: CredentialMetadata[];
}

/**
 * View-mode wrapper around the shared PersonaLayout. Owns the
 * use-cases-tab hooks, derives DisplayUseCase[] from the persona's design
 * context, and supplies UseCaseDetailExpanded as the detail node when a
 * row is selected. The disable-confirmation dialog also lives here.
 *
 * The shared layout itself is mode-agnostic and lives under
 * src/features/shared/glyph/persona-layout/. Adoption + scratch wrappers
 * compose the same layout with mode-specific data sources.
 */
export function PersonaLayoutView({ credentials }: PersonaLayoutViewProps) {
  const { t } = useTranslation();
  const {
    selectedPersona,
    isExecuting,
    personaId,
    useCases: rawUseCases,
    selectedUseCaseId,
    setSelectedUseCaseId,
    historyRefreshKey,
    handleExecute,
    handleRerun,
  } = useUseCasesTab();
  const {
    pendingUseCaseId,
    disableConfirmation,
    requestToggle,
    confirmDisable,
    cancelDisable,
    requestSimulate,
  } = useCapabilityToggle();

  // Open Templates → Recipes catalog. The selected persona stays
  // anchored (agentStore is independent of the sidebar section), so
  // adoption from the catalog lands back in this Use Cases tab — same
  // navigation pattern the legacy SigilGrid's "recipe" empty-tile uses.
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setTemplateTab = useSystemStore((s) => s.setTemplateTab);
  const openRecipeCatalog = () => {
    setSidebarSection('design-reviews');
    setTemplateTab('recipes');
  };

  const [memoriesDefault, setMemoriesDefault] = useState(true);
  const [reviewsDefault, setReviewsDefault] = useState(true);
  useEffect(() => {
    if (!personaId) return;
    let cancelled = false;
    Promise.all([
      getMemoryCount(personaId).catch(() => 0),
      listManualReviews(personaId).then((rs) => rs.length).catch(() => 0),
    ]).then(([memCount, revCount]) => {
      if (cancelled) return;
      setMemoriesDefault(memCount > 0);
      setReviewsDefault(revCount > 0);
    });
    return () => {
      cancelled = true;
    };
  }, [personaId]);

  const credentialLinks = useSelectedCredentialLinks();
  const personaConnectors = useMemo(
    () => new Set(Object.keys(credentialLinks ?? {})),
    [credentialLinks],
  );

  const items = useMemo<DisplayUseCase[]>(
    () => rawUseCases.map((u) => toDisplayUseCase(u, { personaConnectors })),
    [rawUseCases, personaConnectors],
  );

  // Active capability for the per-capability View — drives the hero
  // glyph + left summary derivation. Defaults to the first capability
  // (no aggregate "All" view per the 2026-05-17 design directive). The
  // ID is local UI state, separate from `selectedUseCaseId` which is
  // the "drilled into detail" navigation lever — that's still useful
  // for the expanded UseCaseDetail surface (opened from the hero core
  // or a detail button), but it doesn't drive the per-cap tab strip.
  const [activeCapabilityId, setActiveCapabilityId] = useState<string | null>(null);

  // Petal click → open the SigilEditModal for that dim of the active
  // capability. `editingPetal` is local UI state; closes on X / Escape
  // / backdrop. The modal's toggle writes into `disabledDims` below.
  const [editingPetal, setEditingPetal] = useState<GlyphDimension | null>(null);

  // Phase 4 — `disabledDimsByCap` is persisted to the persona row's
  // `disabled_dims_json` column so toggles survive across navigations,
  // re-builds, and runtime executions. Shape on the wire is
  // `{ [use_case_id]: GlyphDimension[] }`. Hydration runs once per
  // persona selection (the effect below); the toggle handler writes
  // back optimistically and silentCatches the network error (toast
  // would be too loud for a UI affordance).
  const [disabledDimsByCap, setDisabledDimsByCap] = useState<Record<string, Set<GlyphDimension>>>({});

  // Hydrate disabledDimsByCap from the persona row on persona change.
  // The persona's `disabled_dims_json` column carries the persisted shape;
  // parse it into the Set-of-dim map this component drives the modal off.
  // Failures (malformed JSON, missing column on a legacy row) leave the
  // map empty — strictly degrade to "no disables" rather than blocking
  // the panel.
  const hydratedForPersonaRef = useRef<string | null>(null);
  useEffect(() => {
    if (!personaId) {
      setDisabledDimsByCap({});
      hydratedForPersonaRef.current = null;
      return;
    }
    if (hydratedForPersonaRef.current === personaId) return;
    hydratedForPersonaRef.current = personaId;
    const rawJson = (selectedPersona as { disabled_dims_json?: string | null } | null)?.disabled_dims_json;
    if (!rawJson) {
      setDisabledDimsByCap({});
      return;
    }
    try {
      const parsed = JSON.parse(rawJson) as Record<string, string[]>;
      const next: Record<string, Set<GlyphDimension>> = {};
      for (const [capId, dims] of Object.entries(parsed)) {
        if (Array.isArray(dims)) {
          next[capId] = new Set(dims as GlyphDimension[]);
        }
      }
      setDisabledDimsByCap(next);
    } catch {
      setDisabledDimsByCap({});
    }
  }, [personaId, selectedPersona]);
  const disabledDimsForActive = useMemo(() => {
    if (!activeCapabilityId) return new Set<GlyphDimension>();
    return disabledDimsByCap[activeCapabilityId] ?? new Set<GlyphDimension>();
  }, [activeCapabilityId, disabledDimsByCap]);

  const toggleDimDisabled = useCallback(
    (dim: GlyphDimension, nextActive: boolean) => {
      if (!activeCapabilityId || !personaId) return;
      setDisabledDimsByCap((prev) => {
        const cur = new Set(prev[activeCapabilityId] ?? []);
        if (nextActive) cur.delete(dim);
        else cur.add(dim);
        const next = { ...prev, [activeCapabilityId]: cur };
        // Persist the new shape to the persona row. Serialise to the
        // wire shape `{ [capId]: dim[] }`. Empty sets are kept in the
        // map but stripped on serialise so we don't carry forever the
        // capability ids the user briefly opened.
        const wire: Record<string, GlyphDimension[]> = {};
        for (const [capId, set] of Object.entries(next)) {
          if (set.size > 0) wire[capId] = [...set];
        }
        const json = Object.keys(wire).length > 0 ? JSON.stringify(wire) : null;
        void updatePersona(personaId, buildUpdateInput({ disabled_dims_json: json }))
          .catch(silentCatch('PersonaLayoutView:toggleDimDisabled'));
        return next;
      });
    },
    [activeCapabilityId, personaId],
  );
  useEffect(() => {
    // Re-anchor when items load or the first capability changes. Don't
    // reset if the current pick is still valid — switching personas /
    // re-fetching design preserves the user's tab choice when possible.
    if (items.length === 0) {
      setActiveCapabilityId(null);
      return;
    }
    if (!activeCapabilityId || !items.some((u) => u.id === activeCapabilityId)) {
      setActiveCapabilityId(items[0]!.id);
    }
  }, [items, activeCapabilityId]);

  const activeCapability = useMemo(
    () => items.find((u) => u.id === activeCapabilityId) ?? null,
    [items, activeCapabilityId],
  );

  const activeUc = selectedUseCaseId
    ? items.find((u) => u.id === selectedUseCaseId) ?? null
    : null;

  if (!selectedPersona) {
    return (
      <EmptyState
        title={t.agents.use_cases.no_persona_selected_title}
        description={t.agents.use_cases.no_persona_selected_desc}
      />
    );
  }

  // Summary sidebar — derived from the ACTIVE capability only, not
  // aggregated across the persona. Each row shows the saved value for
  // a single dim of `activeCapability`. Empty when no active cap (yet)
  // — the PersonaSigilSummary renders nothing in that case.
  const summaryEntries = useMemo<Partial<Record<GlyphDimension, PersonaSigilSummaryEntry>>>(() => {
    if (!activeCapability) return {};
    const dimLabels = getDimLabels(t);
    const u = activeCapability;
    const out: Partial<Record<GlyphDimension, PersonaSigilSummaryEntry>> = {};
    const connectorKeys = new Set<string>();
    const connectorFallbackNames = new Set<string>();
    if (u.connectorKey) connectorKeys.add(u.connectorKey);
    else if (u.connector) connectorFallbackNames.add(u.connector);
    const channels = new Set(u.notificationChannels);
    const triggers = u.triggerLabel ? [u.triggerLabel] : [];
    const touches = new Set(u.dimensions);
    if (triggers.length > 0) out.trigger = { label: dimLabels.trigger, value: triggers.join(' · ') };
    out.task = { label: dimLabels.task, value: u.title };

    // Apps row: render brand icons for each unique connector (matched
    // through getConnectorMeta) so the row visually reads "Gmail, Slack,
    // GitHub" without the text labels. Unknown connectors (no
    // CONNECTOR_META entry) fall through to a name list so the user
    // still sees *something*.
    if (connectorKeys.size > 0 || connectorFallbackNames.size > 0) {
      out.connector = {
        label: dimLabels.connector,
        value: (
          <span className="inline-flex items-center gap-2 flex-wrap align-middle">
            {[...connectorKeys].map((key) => {
              const meta = getConnectorMeta(key);
              return (
                <span
                  key={key}
                  title={meta.label}
                  className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-foreground/5 border border-card-border/40"
                >
                  <ConnectorIcon meta={meta} size="w-4 h-4" />
                </span>
              );
            })}
            {connectorFallbackNames.size > 0 && (
              <span className="typo-body text-foreground/65">{[...connectorFallbackNames].join(' · ')}</span>
            )}
          </span>
        ),
      };
    }

    if (channels.size > 0) out.message = { label: dimLabels.message, value: [...channels].join(' · ') };
    // Boolean-shaped dims: render "Activated" when the active capability
    // touches the dim (i.e. memory/review/event/error_handling is on for
    // this capability). The dim sigil's lit state already conveys the
    // same signal visually; the sidebar word lets users read the state
    // without parsing the petal colour.
    // TODO i18n: the `dim_status_activated` key landed in a parallel
    // session's en.json edit (in flight at commit time); fall back to a
    // local literal so this works regardless of which session merges
    // first. Replace with `t.agents.use_cases.dim_status_activated`
    // once the key is in the generated types.
    const activatedLabel = 'Activated';
    if (touches.has('review')) out.review = { label: dimLabels.review, value: activatedLabel };
    if (touches.has('memory')) out.memory = { label: dimLabels.memory, value: activatedLabel };
    if (touches.has('event')) out.event = { label: dimLabels.event, value: activatedLabel };
    if (touches.has('error')) out.error = { label: dimLabels.error, value: activatedLabel };
    return out;
  }, [activeCapability, t]);

  // Per-capability hero petal states. The hero glyph now reflects the
  // ACTIVE capability's dim coverage (resolved petals where the cap
  // touches the dim, idle where it doesn't), not the persona-wide union.
  // Returning `undefined` lets PersonaHero fall back to its built-in
  // useCases-derived computation when no active cap is selected yet —
  // briefly happens during the items-load tick before the effect picks
  // the first cap.
  const heroPetalStates = useMemo<Record<GlyphDimension, PetalState> | undefined>(() => {
    if (!activeCapability) return undefined;
    const touches = new Set(activeCapability.dimensions);
    const out = {} as Record<GlyphDimension, PetalState>;
    for (const dim of GLYPH_DIMENSIONS) {
      if (disabledDimsForActive.has(dim)) {
        // Disabled dim renders as idle regardless of whether the
        // capability declares it — the user has explicitly turned it
        // off via the SigilEditModal. Once persistence lands the
        // backend gating will skip the bound questions too.
        out[dim] = 'idle';
      } else {
        out[dim] = touches.has(dim) ? 'resolved' : 'idle';
      }
    }
    return out;
  }, [activeCapability, disabledDimsForActive]);

  // Header tab strip + Add-capability affordance. Replaces the
  // right-side compact list — capabilities live in the header now so
  // the hero column owns the full content width.
  const capabilityTabs = items.length > 0 ? (
    <div className="flex items-end gap-3">
      <div className="flex-1 min-w-0">
        <CapabilityTabBar
          items={items}
          activeId={activeCapabilityId}
          onActiveChange={setActiveCapabilityId}
        />
      </div>
      <div className="shrink-0 pb-1">
        <AddCapabilityRow onClick={openRecipeCatalog} />
      </div>
    </div>
  ) : null;

  const detailNode = activeUc ? (
    <UseCaseDetailExpanded
      uc={activeUc}
      personaId={personaId}
      credentials={credentials}
      memoriesDefault={memoriesDefault}
      reviewsDefault={reviewsDefault}
      isExecuting={isExecuting}
      isThisExecuting={isExecuting && selectedUseCaseId === activeUc.id}
      pendingToggleId={pendingUseCaseId}
      historyRefreshKey={historyRefreshKey}
      onBack={() => setSelectedUseCaseId(null)}
      onToggle={() => {
        if (!personaId) return;
        requestToggle(personaId, activeUc.id, activeUc.title, activeUc.health === 'disabled');
      }}
      onRun={() => handleExecute(activeUc.id, activeUc.raw.sample_input ?? undefined)}
      onSimulate={() => {
        if (!personaId) return;
        requestSimulate(personaId, activeUc.id);
      }}
      onRerun={handleRerun}
    />
  ) : null;

  return (
    <>
      <PersonaLayout
        mode="view"
        personaName={selectedPersona.name ?? ''}
        items={items}
        selectedItemId={selectedUseCaseId}
        pendingToggleId={pendingUseCaseId}
        onRowOpen={(uc) => setSelectedUseCaseId(uc.id)}
        onRowToggle={(uc) => {
          if (!personaId) return;
          requestToggle(personaId, uc.id, uc.title, uc.health === 'disabled');
        }}
        onRowRun={(uc) => handleExecute(uc.id, uc.raw.sample_input ?? undefined)}
        renderRowPolicySlot={
          personaId
            ? (uc) => (
                <TilePolicyToggles
                  personaId={personaId}
                  uc={uc}
                  memoriesDefault={memoriesDefault}
                  reviewsDefault={reviewsDefault}
                />
              )
            : undefined
        }
        hideMetadataBand
        hideCapabilityRows
        topSlot={capabilityTabs}
        heroPetalStatesOverride={heroPetalStates}
        onHeroPetalClick={(dim) => {
          // Only opens when an active capability exists — the empty
          // state has no dim semantics to edit. Clicking the same
          // petal twice toggles closed (matches the adoption petal
          // toggle UX).
          if (!activeCapability) return;
          setEditingPetal((prev) => (prev === dim ? null : dim));
        }}
        heroActiveDim={editingPetal}
        heroWideOverlay={
          editingPetal && activeCapability ? (
            <SigilEditModal
              dim={editingPetal}
              isActive={
                activeCapability.dimensions.includes(editingPetal) &&
                !disabledDimsForActive.has(editingPetal)
              }
              body={resolveSigilEditBody(editingPetal, { uc: activeCapability })}
              onToggleActive={(next) => toggleDimDisabled(editingPetal, next)}
              onClose={() => setEditingPetal(null)}
            />
          ) : undefined
        }
        leftSlot={
          Object.keys(summaryEntries).length > 0 ? (
            <PersonaSigilSummary entries={summaryEntries} heading={null} />
          ) : null
        }
        detailNode={detailNode}
        emptyNode={<EmptyState variant="use-cases-empty" />}
      />

      {disableConfirmation && personaId && (
        <CapabilityDisableDialog
          state={disableConfirmation}
          onConfirm={() => confirmDisable(personaId)}
          onCancel={cancelDisable}
        />
      )}
    </>
  );
}
