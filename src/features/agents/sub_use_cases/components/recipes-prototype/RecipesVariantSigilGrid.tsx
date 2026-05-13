import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Power, AlertTriangle, Plus, Sparkles, Play } from 'lucide-react';
import { CONNECTOR_META, ConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { getMemoryCount } from '@/api/overview/memories';
import { listManualReviews } from '@/api/overview/reviews';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { useSystemStore } from '@/stores/systemStore';
import { useSelectedCredentialLinks } from '@/stores/selectors/personaSelectors';
import { useTranslation } from '@/i18n/useTranslation';
import { useUseCasesTab } from '../../libs/useUseCasesTab';
import { useCapabilityToggle } from '../../libs/useCapabilityToggle';
import { CapabilityDisableDialog } from '../core/CapabilityDisableDialog';
import { UseCasesRefineCard } from '../core/UseCasesRefineCard';
import { MiniSigil, EmptyMiniSigil } from './shared/MiniSigil';
import { UseCaseDetailExpanded } from './shared/UseCaseDetailExpanded';
import { TilePolicyToggles } from './shared/TilePolicyToggles';
import { TileModelStrip } from './shared/TileModelStrip';
import {
  toDisplayUseCase, getHealthMeta, STATE_HEX, GRID_SLOT_COUNT,
  type DisplayUseCase, type UseCaseHealth,
} from './shared/displayUseCase';
import type { PersonaDraft } from '@/features/agents/sub_editor';
import type { CredentialMetadata } from '@/lib/types/types';

interface Props {
  draft: PersonaDraft;
  patch: (updates: Partial<PersonaDraft>) => void;
  modelDirty: boolean;
  credentials: CredentialMetadata[];
}

const RUN_LOCK_MS = 60_000;

/**
 * Variant — Sigil Grid (Round 3d — single top row + relocated run).
 *
 * Tile layout:
 *   ┌──── ●   Sonnet ▾   ⏸ ────────────────────┐ ← top row: status · model · power
 *   ├────────────────────────────────────────────┤
 *   │                                            │
 *   │              ╭─sigil─╮          [🧠]      │ ← memory toggle
 *   │              │       │          [👁]      │ ← review (3-state)
 *   │              ╰───────╯          [⚡]      │ ← event toggle
 *   │                                            │
 *   │  Needs attention                           │ ← status pip (when present)
 *   │  [▶] [logo] Daily morning briefing         │ ← run · connector · title
 *   └────────────────────────────────────────────┘
 *
 * Data flow: `useUseCasesTab` → DesignUseCase[] → `toDisplayUseCase()` →
 * DisplayUseCase[]. Toggle / run / simulate go through `useCapabilityToggle`
 * + `handleExecute`. Per-tile policy + model edits persist via the same
 * Tauri mutations the legacy Grid + Glyph baselines use, so any tab can
 * reflect changes made on any other.
 */
export function RecipesVariantSigilGrid({ credentials }: Props) {
  const {
    selectedPersona, isExecuting, personaId, useCases: rawUseCases,
    selectedUseCaseId, setSelectedUseCaseId, historyRefreshKey,
    handleExecute, handleRerun,
  } = useUseCasesTab();
  const {
    pendingUseCaseId, disableConfirmation, requestToggle, confirmDisable, cancelDisable, requestSimulate,
  } = useCapabilityToggle();

  const { t } = useTranslation();

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
    return () => { cancelled = true; };
  }, [personaId]);

  // Persona's wired connector slugs — fed into the adapter so it can flag
  // use cases whose tool_hints reference connectors that aren't wired
  // (typical scenario: user removed a credential, and a use case that used
  // it now needs attention).
  const credentialLinks = useSelectedCredentialLinks();
  const personaConnectors = useMemo(
    () => new Set(Object.keys(credentialLinks ?? {})),
    [credentialLinks],
  );

  const items = useMemo<DisplayUseCase[]>(
    () => rawUseCases.map((u) => toDisplayUseCase(u, { personaConnectors })),
    [rawUseCases, personaConnectors],
  );

  const personaDefaultModelProfile = selectedPersona?.model_profile ?? null;
  const activeUc = selectedUseCaseId ? items.find((u) => u.id === selectedUseCaseId) ?? null : null;

  const slots: (DisplayUseCase | null)[] = Array.from(
    { length: Math.max(GRID_SLOT_COUNT, items.length) },
    (_, i) => items[i] ?? null,
  );

  const handleToggle = (uc: DisplayUseCase) => {
    if (!personaId) return;
    requestToggle(personaId, uc.id, uc.title, uc.health === 'disabled');
  };
  const handleSimulate = (uc: DisplayUseCase) => {
    if (!personaId) return;
    requestSimulate(personaId, uc.id);
  };
  const handleRun = (uc: DisplayUseCase) => {
    handleExecute(uc.id, uc.raw.sample_input ?? undefined);
  };

  if (!selectedPersona) {
    return (
      <EmptyState
        title={t.agents.use_cases.no_persona_selected_title}
        description={t.agents.use_cases.no_persona_selected_desc}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <AnimatePresence mode="popLayout" initial={false}>
        {activeUc ? (
          <motion.div
            key="detail"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            className="flex-1 min-h-0 flex flex-col"
          >
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
              onToggle={() => handleToggle(activeUc)}
              onRun={() => handleRun(activeUc)}
              onSimulate={() => handleSimulate(activeUc)}
              onRerun={handleRerun}
            />
          </motion.div>
        ) : (
          <motion.div
            key="grid"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="flex-1 min-h-0 flex flex-col"
          >
            {items.length === 0 ? (
              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
                <EmptyState variant="use-cases-empty" />
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
                <ContainmentPanel
                  attentionCount={items.filter((u) => u.health === 'needs-attention').length}
                  openSlotCount={Math.max(0, GRID_SLOT_COUNT - items.length)}
                >
                  <div
                    className="grid gap-3"
                    style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
                  >
                    {slots.map((uc, i) => (
                      uc
                        ? (
                          <SigilTile
                            key={uc.id}
                            uc={uc}
                            personaId={personaId}
                            personaDefaultModelProfile={personaDefaultModelProfile}
                            memoriesDefault={memoriesDefault}
                            reviewsDefault={reviewsDefault}
                            isPending={pendingUseCaseId === uc.id}
                            onOpen={() => setSelectedUseCaseId(uc.id)}
                            onToggle={() => handleToggle(uc)}
                            onRun={() => handleRun(uc)}
                          />
                        )
                        : <EmptyTile key={`empty-${i}`} prominent={i === items.length} />
                    ))}
                  </div>
                </ContainmentPanel>

                {/* Refine card relocated to below the grid as a secondary
                    feature — only renders itself when a build session exists. */}
                {personaId && (
                  <div className="mt-4 max-w-[760px] mx-auto">
                    <UseCasesRefineCard personaId={personaId} />
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {disableConfirmation && personaId && (
        <CapabilityDisableDialog
          state={disableConfirmation}
          onConfirm={() => confirmDisable(personaId)}
          onCancel={cancelDisable}
        />
      )}
    </div>
  );
}

interface ContainmentPanelProps {
  attentionCount: number;
  openSlotCount: number;
  children: React.ReactNode;
}

function ContainmentPanel({ attentionCount, openSlotCount, children }: ContainmentPanelProps) {
  const { t, tx } = useTranslation();
  return (
    <div
      className="rounded-modal border border-card-border bg-secondary/15 mx-auto"
      style={{
        maxWidth: 760,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), inset 0 0 24px rgba(0,0,0,0.18)',
      }}
    >
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-card-border/60">
        <span className="typo-label uppercase tracking-wider text-foreground/65">
          {t.agents.use_cases.constellation_label}
        </span>
        {attentionCount > 0 && (
          <span className="typo-caption text-status-warning inline-flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            {tx(t.agents.use_cases.attention_count, { count: attentionCount })}
          </span>
        )}
        <span className="ml-auto typo-caption text-foreground/45">
          {openSlotCount === 1
            ? tx(t.agents.use_cases.open_slot_one, { count: openSlotCount })
            : tx(t.agents.use_cases.open_slot_other, { count: openSlotCount })}
        </span>
      </div>
      <div className="p-4">
        {children}
      </div>
    </div>
  );
}

interface SigilTileProps {
  uc: DisplayUseCase;
  personaId: string;
  personaDefaultModelProfile: string | null;
  memoriesDefault: boolean;
  reviewsDefault: boolean;
  isPending: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onRun: () => void;
}

function SigilTile({
  uc, personaId, personaDefaultModelProfile,
  memoriesDefault, reviewsDefault,
  isPending, onOpen, onToggle, onRun,
}: SigilTileProps) {
  const [hovered, setHovered] = useState(false);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const isRunning = runStartedAt !== null;
  const { t, tx } = useTranslation();

  const health = getHealthMeta(t)[uc.health];
  const isDisabled = uc.health === 'disabled';
  const isAttention = uc.health === 'needs-attention';
  const stateHex = STATE_HEX[uc.health];

  useEffect(() => {
    if (runStartedAt === null) return;
    const id = window.setTimeout(() => setRunStartedAt(null), RUN_LOCK_MS);
    return () => window.clearTimeout(id);
  }, [runStartedAt]);

  const handleRunClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRunning || isDisabled) return;
    setRunStartedAt(Date.now());
    onRun();
  };

  const handleToggleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPending) return;
    onToggle();
  };

  const connectorMeta = uc.connectorKey ? CONNECTOR_META[uc.connectorKey] : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`group relative aspect-square rounded-card border bg-secondary/30 transition-all cursor-pointer overflow-hidden ${
        isAttention
          ? 'border-status-warning/40 hover:border-status-warning/60'
          : isDisabled
            ? 'border-border/30 hover:border-border/50'
            : 'border-card-border hover:border-primary/40'
      }`}
      style={{
        boxShadow: hovered
          ? `0 0 0 1px ${isAttention ? '#fbbf24' : isDisabled ? 'rgba(148,163,184,0.5)' : 'var(--primary)'}33 inset`
          : undefined,
      }}
    >
      {/* Top row: status · model · power. Single justify-between flex row
          with a bottom border separating it from the sigil area. */}
      <div className="absolute top-0 inset-x-0 flex items-center gap-2 px-2 py-1.5 border-b border-card-border/60 bg-secondary/20 z-20">
        <StatusDot health={uc.health} />
        <TileModelStrip
          personaId={personaId}
          uc={uc}
          personaDefaultModelProfile={personaDefaultModelProfile}
        />
        <button
          type="button"
          onClick={handleToggleClick}
          disabled={isPending}
          className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full border transition-colors cursor-pointer disabled:opacity-50 ${
            isDisabled
              ? 'border-status-success/30 bg-status-success/10 text-status-success hover:bg-status-success/20'
              : 'border-card-border bg-secondary/80 text-foreground/80 hover:text-foreground hover:border-primary/40'
          }`}
          title={isDisabled ? t.agents.use_cases.activate_capability : t.agents.use_cases.pause_capability}
        >
          <Power className="w-3 h-3" />
        </button>
      </div>

      {/* Right edge: policy toggle column (memory · review · events).
          Vertically centered against the sigil rather than pinned to a fixed
          offset, so it stays balanced as the sigil resizes. */}
      <div className="absolute right-2 top-1/2 -translate-y-1/2 z-10">
        <TilePolicyToggles
          personaId={personaId}
          uc={uc}
          memoriesDefault={memoriesDefault}
          reviewsDefault={reviewsDefault}
        />
      </div>

      {/* Centre: sigil — wrapper carries layoutId for the morph; halo pulses
          only while the local run-lock is active (gated, not ambient). */}
      <div className="absolute inset-x-0 top-9 bottom-14 flex items-center justify-center pointer-events-none">
        <motion.div
          layoutId={`sigil-${uc.id}`}
          transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
          className="relative"
        >
          <MiniSigil uc={uc} size={130} isHovered={hovered} petalStyle="wedge" />
          <AnimatePresence>
            {isRunning && (
              <motion.span
                key="run-halo"
                aria-hidden
                className="absolute inset-0 m-auto rounded-full"
                style={{ width: 130, height: 130 }}
                initial={{ opacity: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.25 } }}
                animate={{
                  opacity: [0.85, 0],
                  boxShadow: [
                    `0 0 0 2px ${stateHex}77`,
                    `0 0 0 18px ${stateHex}00`,
                  ],
                }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  ease: [0.32, 0.72, 0, 1],
                }}
              />
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* Bottom: run button + (optional) connector icon + title. The
          needs-attention pip sits above as a lead line when present. */}
      <div className="absolute inset-x-0 bottom-0 px-2.5 py-2 bg-gradient-to-t from-background/85 via-background/55 to-transparent">
        {isAttention && (
          <div className="typo-label text-status-warning text-center mb-1 inline-flex items-center justify-center gap-1 w-full">
            <AlertTriangle className="w-2.5 h-2.5" />
            <span>{health.label}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleRunClick}
            disabled={isDisabled || isRunning}
            className={`shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full border transition-colors cursor-pointer disabled:cursor-not-allowed ${
              isRunning
                ? 'border-status-info/45 bg-status-info/15 text-status-info'
                : 'border-card-border bg-secondary/70 text-foreground/85 hover:text-status-info hover:border-status-info/45 hover:bg-status-info/10 disabled:opacity-40'
            }`}
            title={isRunning ? t.agents.use_cases.running_label : tx(t.agents.use_cases.run_title, { title: uc.title })}
          >
            {isRunning ? (
              <span className="relative flex h-3.5 w-3.5 items-center justify-center" aria-hidden>
                <span className="animate-ping absolute h-full w-full rounded-full bg-status-info opacity-50" />
                <span className="relative rounded-full h-2 w-2 bg-status-info" />
              </span>
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
          </button>
          {connectorMeta && (
            <span
              className="shrink-0 flex items-center justify-center rounded"
              style={{
                width: 18, height: 18,
                background: isDisabled ? 'rgba(148,163,184,0.16)' : `${connectorMeta.color}1f`,
                border: `1px solid ${isDisabled ? 'rgba(148,163,184,0.32)' : connectorMeta.color + '4d'}`,
                opacity: isDisabled ? 0.7 : 1,
              }}
              title={uc.connector}
            >
              <ConnectorIcon meta={connectorMeta} size="w-3 h-3" />
            </span>
          )}
          <div
            className="typo-heading font-medium leading-tight line-clamp-2 flex-1 min-w-0 transition-colors text-left"
            style={{ color: isDisabled ? 'rgb(var(--foreground) / 0.55)' : 'rgb(var(--foreground) / 0.95)' }}
          >
            {uc.title}
          </div>
        </div>
      </div>
    </button>
  );
}

function StatusDot({ health }: { health: UseCaseHealth }) {
  const colorClass =
    health === 'active'
      ? 'bg-status-success shadow-[0_0_8px_rgba(52,211,153,0.55)]'
      : health === 'needs-attention'
        ? 'bg-status-warning shadow-[0_0_8px_rgba(251,191,36,0.55)]'
        : 'bg-foreground/35';
  return <span className={`w-2 h-2 rounded-full shrink-0 ${colorClass}`} aria-hidden />;
}

function EmptyTile({ prominent }: { prominent: boolean }) {
  const [hovered, setHovered] = useState(false);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setTemplateTab = useSystemStore((s) => s.setTemplateTab);
  const { t } = useTranslation();

  const openRecipeCatalog = () => {
    // Navigate to Templates → Recipes. The user's selected persona stays
    // selected (agentStore is independent of the sidebar section), so the
    // catalog's eligibility chips and the Adopt flow stay anchored to
    // *this* persona — closing the loop from "empty tile here" to "adopt
    // a recipe and watch it land back here".
    setSidebarSection('design-reviews');
    setTemplateTab('recipes');
  };

  return (
    <button
      type="button"
      onClick={openRecipeCatalog}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`group relative aspect-square rounded-card border border-dashed transition-all cursor-pointer overflow-hidden ${
        prominent
          ? 'border-foreground/30 bg-secondary/15 hover:border-primary/50 hover:bg-primary/5'
          : 'border-border/30 bg-secondary/10 hover:border-foreground/30 hover:bg-secondary/20'
      }`}
    >
      <div className="absolute inset-x-0 top-9 bottom-14 flex items-center justify-center pointer-events-none">
        <EmptyMiniSigil size={130} isHovered={hovered} />
      </div>
      <div className={`absolute inset-x-0 bottom-0 px-3 py-2.5 ${prominent ? 'bg-gradient-to-t from-background/85 via-background/40 to-transparent' : ''}`}>
        {prominent ? (
          <>
            <div className="typo-heading text-center font-medium text-foreground/85 leading-tight inline-flex items-center justify-center gap-1.5 w-full">
              <Sparkles className="w-3.5 h-3.5 text-primary/85" />
              {t.agents.use_cases.adopt_a_recipe}
            </div>
            <div className="typo-label text-foreground/45 mt-0.5 text-center">{t.agents.use_cases.from_curated_catalog}</div>
          </>
        ) : (
          <div className="typo-caption text-foreground/45 inline-flex items-center justify-center gap-1 w-full">
            <Plus className="w-3.5 h-3.5" />
            {t.agents.use_cases.open_slot}
          </div>
        )}
      </div>
    </button>
  );
}
