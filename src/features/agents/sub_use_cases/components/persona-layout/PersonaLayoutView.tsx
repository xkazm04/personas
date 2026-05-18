import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { getMemoryCount } from '@/api/overview/memories';
import { listManualReviews } from '@/api/overview/reviews';
import { useSelectedCredentialLinks } from '@/stores/selectors/personaSelectors';
import { AddCapabilityRow, PersonaLayout } from '@/features/shared/glyph/persona-layout';
import { PersonaSigilSummary, type PersonaSigilSummaryEntry } from '@/features/shared/glyph/persona-layout/PersonaSigilSummary';
import type { GlyphDimension } from '@/features/shared/glyph';
import { Power, Play } from 'lucide-react';
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
  const { t, tx } = useTranslation();
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

  // Summary sidebar — one row per dim with at least one active capability
  // touching it, plus values aggregated from the matching use cases.
  // Disabled capabilities don't contribute (they're not part of the
  // persona's current behaviour). The label is colour-tinted by dim via
  // PersonaSigilSummary's DIM_META lookup.
  const summaryEntries = useMemo<Partial<Record<GlyphDimension, PersonaSigilSummaryEntry>>>(() => {
    const dimLabels = getDimLabels(t);
    const enabled = items.filter((u) => u.health !== 'disabled');
    const out: Partial<Record<GlyphDimension, PersonaSigilSummaryEntry>> = {};
    const triggers = new Set<string>();
    const connectors = new Set<string>();
    const channels = new Set<string>();
    const capabilityNames = new Set<string>();
    let touchesReview = 0;
    let touchesMemory = 0;
    let touchesEvent = 0;
    let touchesError = 0;
    for (const u of enabled) {
      capabilityNames.add(u.title);
      if (u.triggerLabel) triggers.add(u.triggerLabel);
      if (u.connector) connectors.add(u.connector);
      for (const c of u.notificationChannels) channels.add(c);
      for (const d of u.dimensions) {
        if (d === 'review') touchesReview += 1;
        else if (d === 'memory') touchesMemory += 1;
        else if (d === 'event') touchesEvent += 1;
        else if (d === 'error') touchesError += 1;
      }
    }
    if (triggers.size > 0) out.trigger = { label: dimLabels.trigger, value: [...triggers].join(' · ') };
    if (capabilityNames.size > 0) out.task = { label: dimLabels.task, value: tx(t.agents.use_cases.capabilities_active, { count: capabilityNames.size }) };
    if (connectors.size > 0) out.connector = { label: dimLabels.connector, value: [...connectors].join(' · ') };
    if (channels.size > 0) out.message = { label: dimLabels.message, value: [...channels].join(' · ') };
    if (touchesReview > 0) out.review = { label: dimLabels.review, value: tx(t.agents.use_cases.capabilities_active, { count: touchesReview }) };
    if (touchesMemory > 0) out.memory = { label: dimLabels.memory, value: tx(t.agents.use_cases.capabilities_active, { count: touchesMemory }) };
    if (touchesEvent > 0) out.event = { label: dimLabels.event, value: tx(t.agents.use_cases.capabilities_active, { count: touchesEvent }) };
    if (touchesError > 0) out.error = { label: dimLabels.error, value: tx(t.agents.use_cases.capabilities_active, { count: touchesError }) };
    return out;
  }, [items, t, tx]);

  // View-mode capability sidebar — a compact list version of UseCaseRow:
  // power toggle + name only, no description, single column. Lives in the
  // PersonaLayout.rightSlot so the main column can give the sigil all the
  // available width.
  const capabilitiesSidebar = items.length > 0 ? (
    <div className="flex flex-col gap-2">
      <span className="typo-label uppercase tracking-[0.18em] text-foreground/55 px-1">
        {t.agents.use_cases.persona_layout_capabilities_heading}
      </span>
      <ul className="flex flex-col gap-1.5">
        {items.map((uc) => {
          const isExecutingThis = isExecuting && selectedUseCaseId === uc.id;
          const isPending = pendingUseCaseId === uc.id;
          const isDisabled = uc.health === 'disabled';
          return (
            <li
              key={uc.id}
              className={`group flex items-center gap-1.5 px-2 py-2 rounded-card bg-secondary/20 border border-card-border hover:bg-secondary/35 transition-colors ${isDisabled ? 'opacity-60' : ''}`}
            >
              <button
                type="button"
                onClick={() => {
                  if (!personaId) return;
                  requestToggle(personaId, uc.id, uc.title, uc.health === 'disabled');
                }}
                disabled={isPending}
                className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full transition-colors disabled:opacity-50 ${isDisabled ? 'bg-foreground/10 text-foreground/45 hover:bg-foreground/20' : 'bg-status-success/15 text-status-success hover:bg-status-success/25'}`}
                title={isDisabled ? t.agents.use_cases.activate_capability : t.agents.use_cases.pause_capability}
              >
                <Power className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => setSelectedUseCaseId(uc.id)}
                className="flex-1 min-w-0 text-left typo-body text-foreground/85 truncate hover:text-foreground transition-colors cursor-pointer"
              >
                {uc.title}
              </button>
              {!isDisabled && (
                <button
                  type="button"
                  onClick={() => handleExecute(uc.id, uc.raw.sample_input ?? undefined)}
                  disabled={isExecuting}
                  className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/15 hover:bg-primary/30 text-primary disabled:opacity-50 transition-colors"
                  title={isExecutingThis ? t.agents.use_cases.running_label : tx(t.agents.use_cases.run_title, { title: uc.title })}
                >
                  <Play className="w-3 h-3" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <AddCapabilityRow onClick={openRecipeCatalog} />
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
        leftSlot={
          Object.keys(summaryEntries).length > 0 ? (
            <PersonaSigilSummary entries={summaryEntries} heading={null} />
          ) : null
        }
        rightSlot={capabilitiesSidebar}
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
