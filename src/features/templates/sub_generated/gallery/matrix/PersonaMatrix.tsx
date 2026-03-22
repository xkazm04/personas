import { useMemo, useRef, useState, useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

import { deriveArchCategories, type ArchCategory } from './architecturalCategories';
import {
  UseCasesIcon, ConnectorsIcon, TriggersIcon, HumanReviewIcon,
  MessagesIcon, MemoryIcon, ErrorsIcon, EventsIcon,
} from './MatrixIcons';
import type { AgentIR, SuggestedEventSubscription } from '@/lib/types/designTypes';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import type { CredentialMetadata } from '@/lib/types/types';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import type { DesignQuestion } from '@/lib/types/designTypes';
import type { CellBuildStatus, BuildQuestion, BuildPhase, ToolTestResult } from '@/lib/types/buildTypes';
import type { RequiredConnector } from '../../adoption/steps/connect/ConnectStep';
import type { MatrixEditState, MatrixEditCallbacks } from './EditableMatrixCells';
import { ConnectorEditCell, TriggerEditCell, ReviewEditCell, MemoryEditCell, MessagesEditCell, ErrorEditCell, UseCaseEditCell } from './EditableMatrixCells';
import { MatrixCommandCenter } from './MatrixCommandCenter';
import { CELL_LABELS } from '@/features/agents/components/matrix/cellVocabulary';
import { SpatialQuestionPopover } from '@/features/agents/components/matrix/SpatialQuestionPopover';
import { ConnectorsCellContent } from '@/features/agents/components/matrix/ConnectorsCellContent';
import { useMatrixCredentialGap } from '@/features/agents/components/matrix/useMatrixCredentialGap';
import { DimensionEditPanel, checkConnectorsHealth } from '@/features/agents/components/matrix/DimensionEditPanel';
import { extractProtocolCapabilities } from '@/features/templates/sub_n8n/edit/protocolParser';
import { useAgentStore } from '@/stores/agentStore';
import { useVaultStore } from '@/stores/vaultStore';

import { MatrixCellRenderer, CellBullets, type MatrixCell } from './MatrixCellRenderer';
import {
  extractTriggers, extractHumanReview, extractMemory, extractErrorStrategies,
  cellRevealVariants,
} from './personaMatrixHelpers';

/** @deprecated Single theme -- kept for backward compatibility */
export type MatrixTheme = 'neon';
/** @deprecated */
export type MatrixLayout = 'orbit';

interface PersonaMatrixBaseProps {
  designResult: AgentIR | null;
  flows?: UseCaseFlow[];
  hideHeader?: boolean;
  /** @deprecated Ignored */ theme?: MatrixTheme;
  /** @deprecated Ignored */ layout?: MatrixLayout;
  onLaunch?: () => void;
  launchDisabled?: boolean;
  launchLabel?: string;
  isRunning?: boolean;
  onNavigateCatalog?: () => void;
  /** Lock all interactive grid cells to view mode during build */
  buildLocked?: boolean;
  /** CLI questions during build */
  questions?: TransformQuestionResponse[] | null;
  /** Current user answers */
  userAnswers?: Record<string, string>;
  /** Question answer changed */
  onAnswerUpdated?: (questionId: string, answer: string) => void;
  /** Submit answers and continue build */
  onSubmitAnswers?: () => void;
  /** Whether build is completed (draft available) */
  buildCompleted?: boolean;
  /** User-facing build phase label */
  phaseLabel?: string;
  /** 'adoption' (template) or 'creation' (agent creation) flow */
  variant?: 'adoption' | 'creation';
  /** Creation mode: controlled intent text */
  intentText?: string;
  onIntentChange?: (text: string) => void;
  /** Creation mode: completeness 0-100 */
  completeness?: number;
  /** Creation mode: design result exists */
  hasDesignResult?: boolean;
  /** Creation mode: continue to next step */
  onContinue?: () => void;
  /** Creation mode: refine with feedback */
  onRefine?: (feedback: string) => void;
  /** Creation mode: directly create agent from matrix (bypasses IdentityStep) */
  onCreateAgent?: (name: string) => void;
  /** Creation mode: controlled agent name for finalization */
  agentName?: string;
  onAgentNameChange?: (name: string) => void;
  /** CLI output lines from design stream (shown during generation) */
  cliOutputLines?: string[];
  /** Design question awaiting user input */
  designQuestion?: DesignQuestion | null;
  /** Answer a design question */
  onAnswerQuestion?: (answer: string) => void;
  /** Cell build states from matrixBuildSlice, keyed by cell key */
  cellBuildStates?: Record<string, CellBuildStatus>;
  /** Pending Q&A questions for spatial popover anchoring */
  pendingQuestions?: BuildQuestion[];
  /** Answer a spatial question (cellKey, answer) */
  onAnswerBuildQuestion?: (cellKey: string, answer: string) => void;
  /** Current build phase for lifecycle state branching in command center */
  buildPhase?: BuildPhase;
  /** Lifecycle: start test run */
  onStartTest?: () => void;
  /** Lifecycle: approve test results */
  onApproveTest?: () => void;
  /** Lifecycle: reject test results */
  onRejectTest?: () => void;
  /** Lifecycle: streaming test output lines */
  testOutputLines?: string[];
  /** Lifecycle: test pass/fail result */
  testPassed?: boolean | null;
  /** Lifecycle: test error message */
  testError?: string | null;
  /** Lifecycle: per-tool test results */
  toolTestResults?: ToolTestResult[];
  /** Lifecycle: LLM-generated human-friendly test summary */
  testSummary?: string | null;
  /** Lifecycle: navigate to promoted agent */
  onViewAgent?: () => void;
  /** Rich activity description from build progress events */
  buildActivity?: string | null;
  /** Apply inline cell edits via CLI refine */
  onApplyEdits?: () => void;
  /** Discard inline cell edits */
  onDiscardEdits?: () => void;
  /** Submit all collected answers to CLI */
  onSubmitAllAnswers?: () => void;
}

interface PersonaMatrixViewProps extends PersonaMatrixBaseProps { mode?: 'view'; }
interface PersonaMatrixEditProps extends PersonaMatrixBaseProps {
  mode: 'edit';
  editState: MatrixEditState;
  editCallbacks: MatrixEditCallbacks;
  requiredConnectors: RequiredConnector[];
  credentials: CredentialMetadata[];
}

export type PersonaMatrixProps = PersonaMatrixViewProps | PersonaMatrixEditProps;

// -- Main Component ---------------------------------------------------

export function PersonaMatrix(props: PersonaMatrixProps) {
  const { designResult, flows = [], hideHeader = false, onLaunch, launchDisabled, launchLabel, isRunning, onNavigateCatalog, buildLocked = false, questions, userAnswers, onAnswerUpdated, onSubmitAnswers, buildCompleted, phaseLabel, variant, intentText, onIntentChange, completeness, hasDesignResult, onContinue, onRefine, onCreateAgent, agentName, onAgentNameChange, cliOutputLines, designQuestion, onAnswerQuestion, cellBuildStates, pendingQuestions, onAnswerBuildQuestion, buildPhase, onStartTest, onApproveTest, onRejectTest, testOutputLines, testPassed, testError, toolTestResults, testSummary, onViewAgent, buildActivity, onApplyEdits, onDiscardEdits, onSubmitAllAnswers } = props;
  const isEditMode = props.mode === 'edit';

  // Track which question modal is currently open (only one at a time)
  const [openQuestionKey, setOpenQuestionKey] = useState<string | null>(null);

  // Listen for cell clicks from MatrixCellRenderer (custom event)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.cellKey) {
        setOpenQuestionKey(detail.cellKey);
      }
    };
    window.addEventListener('matrix-cell-click', handler);
    return () => window.removeEventListener('matrix-cell-click', handler);
  }, []);

  // Ref map for cell DOM elements -- used by SpatialQuestionPopover anchoring
  const cellRefsRef = useRef<Record<string, HTMLElement | null>>({});
  const handleCellRef = (key: string, el: HTMLElement | null) => {
    cellRefsRef.current[key] = el;
  };

  // When cellBuildStates is provided (build mode), we create skeleton cells even without designResult
  const hasBuildStates = cellBuildStates && Object.keys(cellBuildStates).length > 0;
  const isCreationMode = variant === 'creation';

  // Build draft data for enhanced cell rendering (connectors, protocol badges)
  const buildDraft = useAgentStore((s) => s.buildDraft) as Record<string, unknown> | null;
  const { draftConnectors } = useMatrixCredentialGap();

  // Extract connectors from structured cell data (available before agent_ir)
  const connectorsCellRaw = useAgentStore((s) => s.buildCellData["connectors"]?.raw);
  const cellConnectors = useMemo(() => {
    if (draftConnectors.length > 0) return draftConnectors; // prefer agent_ir source
    const structured = connectorsCellRaw?.connectors;
    if (!Array.isArray(structured)) return [];
    return structured
      .filter((c: unknown): c is Record<string, unknown> => c != null && typeof c === 'object')
      .map((c: Record<string, unknown>) => ({
        name: (c.name as string) ?? '',
        has_credential: (c.has_credential as boolean) ?? false,
      }));
  }, [draftConnectors, connectorsCellRaw]);

  // Check connectors health — override cell state if credentials are unhealthy
  const vaultCredentials = useVaultStore((s) => s.credentials) ?? [];
  const buildConnectorLinks = useAgentStore((s) => s.buildConnectorLinks);
  const connectorsHealthy = useMemo(() => {
    if (cellConnectors.length === 0) return true;
    const { allHealthy } = checkConnectorsHealth(cellConnectors, vaultCredentials, buildConnectorLinks);
    return allHealthy;
  }, [cellConnectors, vaultCredentials, buildConnectorLinks]);

  // Build effective cell states — connectors shows "updated" (amber) if credentials unhealthy
  const effectiveCellStates = useMemo(() => {
    if (!cellBuildStates) return cellBuildStates;
    if (connectorsHealthy || cellBuildStates['connectors'] !== 'resolved') return cellBuildStates;
    return { ...cellBuildStates, connectors: 'updated' as const };
  }, [cellBuildStates, connectorsHealthy]);

  // Post-build inline editing state
  const editingCellKey = useAgentStore((s) => s.editingCellKey);
  const isDraftPhase = buildPhase === 'draft_ready' || buildPhase === 'test_complete';

  // Pre-build: creation mode before the build process has started — enlarge command hub, minimize dimension cells
  const isPreBuild = isCreationMode && !hasBuildStates && !designResult && (!buildPhase || buildPhase === 'initializing');

  // Handle cell click for editing in draft phase
  const handleCellEditClick = (cellKey: string) => {
    if (!isCreationMode || !isDraftPhase) return;
    const store = useAgentStore.getState();
    store.setEditingCell(editingCellKey === cellKey ? null : cellKey);
  };

  // Dirty handler for DimensionEditPanel
  const handleEditDirty = () => {
    useAgentStore.getState().markEditDirty();
  };

  // Extract protocol capabilities from build draft for cell badges
  const protocolCapabilities = useMemo(() => {
    if (!buildDraft) return [];
    const systemPrompt = (buildDraft.system_prompt as string) ?? '';
    const structuredPrompt = buildDraft.structured_prompt as Record<string, unknown> | undefined;
    return extractProtocolCapabilities(systemPrompt, structuredPrompt ?? null);
  }, [buildDraft]);

  // Map protocol types to cell keys for protocol active badges
  const protocolByCellKey: Record<string, string[]> = {};
  for (const cap of protocolCapabilities) {
    const cellKey =
      cap.type === 'manual_review' ? 'human-review' :
      cap.type === 'agent_memory' ? 'memory' :
      cap.type === 'user_message' ? 'messages' :
      cap.type === 'emit_event' ? 'events' : null;
    if (cellKey) {
      if (!protocolByCellKey[cellKey]) protocolByCellKey[cellKey] = [];
      protocolByCellKey[cellKey].push(cap.label);
    }
  }

  // Stagger reveal: animate cells in ripple order from center on first build start
  const hasRevealedRef = useRef(false);
  const prefersReducedMotion = useReducedMotion();
  const shouldAnimate = variant === 'creation' && hasBuildStates && !hasRevealedRef.current && !prefersReducedMotion;
  if (shouldAnimate) {
    hasRevealedRef.current = true;
  }

  const cells = useMemo<MatrixCell[]>(() => {
    // In creation mode or build mode with cellBuildStates, return skeleton cells
    // so the ghosted outlines are visible before CLI produces content
    if (!designResult && (hasBuildStates || isCreationMode)) {
      // Helper: render protocol badge if protocol capabilities are active for a cell
      const badge = (cellKey: string) => {
        const labels = protocolByCellKey[cellKey];
        if (!labels || labels.length === 0) return null;
        return (
          <div className="mt-1.5">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Protocol Active
            </span>
          </div>
        );
      };

      const editPanel = (key: string) => isDraftPhase
        ? () => <DimensionEditPanel cellKey={key} onDirty={handleEditDirty} />
        : undefined;

      return [
        { key: 'use-cases', label: CELL_LABELS['use-cases'] ?? 'Use Cases', watermark: UseCasesIcon, watermarkColor: 'text-violet-400', render: () => null, editRender: editPanel('use-cases') },
        { key: 'connectors', label: CELL_LABELS['connectors'] ?? 'Connectors', watermark: ConnectorsIcon, watermarkColor: 'text-cyan-400',
          render: () => cellConnectors.length > 0 ? <ConnectorsCellContent connectors={cellConnectors} /> : null,
          editRender: editPanel('connectors') },
        { key: 'triggers', label: CELL_LABELS['triggers'] ?? 'Triggers', watermark: TriggersIcon, watermarkColor: 'text-amber-400', render: () => null, editRender: editPanel('triggers') },
        { key: 'human-review', label: CELL_LABELS['human-review'] ?? 'Human Review', watermark: HumanReviewIcon, watermarkColor: 'text-rose-400', render: () => badge('human-review'), editRender: editPanel('human-review') },
        { key: 'messages', label: CELL_LABELS['messages'] ?? 'Messages', watermark: MessagesIcon, watermarkColor: 'text-blue-400', render: () => badge('messages'), editRender: editPanel('messages') },
        { key: 'memory', label: CELL_LABELS['memory'] ?? 'Memory', watermark: MemoryIcon, watermarkColor: 'text-purple-400', render: () => badge('memory'), editRender: editPanel('memory') },
        { key: 'error-handling', label: CELL_LABELS['error-handling'] ?? 'Error Handling', watermark: ErrorsIcon, watermarkColor: 'text-orange-400', render: () => null, editRender: editPanel('error-handling') },
        { key: 'events', label: CELL_LABELS['events'] ?? 'Events', watermark: EventsIcon, watermarkColor: 'text-teal-400', render: () => badge('events'), editRender: editPanel('events') },
      ];
    }

    if (!designResult) return [];
    const connectorNames = designResult.suggested_connectors?.map((c) => c.name) ?? [];
    const archCategories = deriveArchCategories(connectorNames);
    const triggers = extractTriggers(designResult.suggested_triggers ?? []);
    const review = extractHumanReview(designResult.protocol_capabilities);
    const memory = extractMemory(designResult.protocol_capabilities);
    const channels = designResult.suggested_notification_channels ?? [];
    const errorStrategies = extractErrorStrategies(designResult.structured_prompt?.errorHandling ?? '');
    const events: SuggestedEventSubscription[] = designResult.suggested_event_subscriptions ?? [];
    const editProps = isEditMode ? props as PersonaMatrixEditProps : null;

    return [
      { key: 'use-cases', label: CELL_LABELS['use-cases']!, watermark: UseCasesIcon, watermarkColor: 'text-violet-400', filled: flows.length > 0,
        render: () => flows.length === 0 ? <CellBullets items={['General-purpose agent']} color="text-muted-foreground/50" /> : <CellBullets items={flows.slice(0, 3).map((f) => f.name)} color="text-foreground/70" />,
        editRender: editProps ? () => (<UseCaseEditCell editState={editProps.editState} callbacks={editProps.editCallbacks} />) : undefined },
      { key: 'connectors', label: CELL_LABELS['connectors']!, watermark: ConnectorsIcon, watermarkColor: 'text-cyan-400', filled: archCategories.length > 0,
        render: () => {
          if (archCategories.length === 0) return <CellBullets items={['No external services']} color="text-muted-foreground/50" />;
          return (<div className="space-y-1.5">{archCategories.slice(0, 3).map((cat: ArchCategory) => { const CatIcon = cat.icon; return (<div key={cat.key} className="flex items-center gap-2"><CatIcon className="w-3.5 h-3.5 flex-shrink-0 opacity-70" style={{ color: cat.color }} /><span className="text-sm text-foreground/70 leading-snug">{cat.label}</span></div>); })}{archCategories.length > 3 && <span className="text-sm text-muted-foreground/40 pl-[22px]">+{archCategories.length - 3} more</span>}</div>);
        },
        editRender: editProps ? () => (<ConnectorEditCell requiredConnectors={editProps.requiredConnectors} credentials={editProps.credentials} editState={editProps.editState} callbacks={editProps.editCallbacks} onNavigateCatalog={onNavigateCatalog} />) : undefined },
      { key: 'triggers', label: CELL_LABELS['triggers']!, watermark: TriggersIcon, watermarkColor: 'text-amber-400', filled: triggers.length > 0,
        render: () => triggers.length === 0 ? <CellBullets items={['Manual execution only']} color="text-muted-foreground/50" /> : <CellBullets items={triggers.slice(0, 3).map((t) => t.label)} color="text-foreground/70" />,
        editRender: editProps ? () => (<TriggerEditCell designResult={designResult} editState={editProps.editState} callbacks={editProps.editCallbacks} />) : undefined },
      { key: 'human-review', label: CELL_LABELS['human-review']!, watermark: HumanReviewIcon, filled: review.level !== 'none',
        watermarkColor: review.level === 'required' ? 'text-rose-400' : review.level === 'optional' ? 'text-amber-400' : 'text-emerald-400',
        render: () => { const dotColor = review.level === 'required' ? 'bg-rose-400' : review.level === 'optional' ? 'bg-amber-400' : 'bg-emerald-400'; return (<div className="space-y-1.5"><div className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${dotColor} flex-shrink-0`} /><span className="text-sm font-medium text-foreground/80">{review.label}</span></div><p className="text-sm text-muted-foreground/60 leading-snug pl-[16px]">{review.context.length > 55 ? review.context.slice(0, 53) + '\u2026' : review.context}</p></div>); },
        editRender: editProps ? () => (<ReviewEditCell editState={editProps.editState} callbacks={editProps.editCallbacks} />) : undefined },
      { key: 'messages', label: CELL_LABELS['messages']!, watermark: MessagesIcon, watermarkColor: 'text-blue-400', filled: channels.length > 0,
        render: () => { if (channels.length === 0) return <CellBullets items={['In-app notifications only']} color="text-muted-foreground/50" />; const bullets = channels.slice(0, 3).map((ch) => { const prefix = ch.type.charAt(0).toUpperCase() + ch.type.slice(1); return ch.description.length > 3 && ch.description.length <= 40 ? `${prefix}: ${ch.description}` : `${prefix} channel`; }); return <CellBullets items={bullets} color="text-foreground/70" />; },
        editRender: editProps ? () => (<MessagesEditCell editState={editProps.editState} callbacks={editProps.editCallbacks} />) : undefined },
      { key: 'memory', label: CELL_LABELS['memory']!, watermark: MemoryIcon, filled: memory.active,
        watermarkColor: memory.active ? 'text-purple-400' : 'text-zinc-400',
        render: () => (<div className="space-y-1.5"><div className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${memory.active ? 'bg-purple-400' : 'bg-zinc-500'} flex-shrink-0`} /><span className="text-sm font-medium text-foreground/80">{memory.label}</span></div><p className="text-sm text-muted-foreground/60 leading-snug pl-[16px]">{memory.context}</p></div>),
        editRender: editProps ? () => (<MemoryEditCell editState={editProps.editState} callbacks={editProps.editCallbacks} />) : undefined },
      { key: 'error-handling', label: CELL_LABELS['error-handling']!, watermark: ErrorsIcon, watermarkColor: 'text-orange-400', filled: errorStrategies[0] !== 'Default error handling',
        render: () => <CellBullets items={errorStrategies} color="text-foreground/70" />,
        editRender: editProps ? () => (<ErrorEditCell editState={editProps.editState} callbacks={editProps.editCallbacks} />) : undefined },
      { key: 'events', label: CELL_LABELS['events']!, watermark: EventsIcon, filled: events.length > 0,
        watermarkColor: events.length > 0 ? 'text-teal-400' : 'text-muted-foreground',
        render: () => { if (events.length === 0) return <CellBullets items={['No event subscriptions']} color="text-muted-foreground/40" />; const bullets = events.slice(0, 3).map((ev) => ev.description.length > 3 && ev.description.length <= 40 ? ev.description : ev.event_type); return <CellBullets items={bullets} color="text-foreground/70" />; } },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designResult, flows, isEditMode, onNavigateCatalog, hasBuildStates, isCreationMode, draftConnectors, protocolByCellKey,
    isDraftPhase, buildDraft, cellConnectors, connectorsCellRaw, handleEditDirty,
    ...(isEditMode ? [(props as PersonaMatrixEditProps).editState, (props as PersonaMatrixEditProps).requiredConnectors, (props as PersonaMatrixEditProps).credentials] : [])]);

  // Creation mode is interactive (textarea + launch orb) even without mode="edit"
  const commandCenterEditMode = isEditMode || isCreationMode;
  const commandCenter = (<MatrixCommandCenter designResult={designResult} isEditMode={commandCenterEditMode} isRunning={isRunning} onLaunch={onLaunch} launchDisabled={launchDisabled} launchLabel={launchLabel} variant={variant} questions={questions} userAnswers={userAnswers} onAnswerUpdated={onAnswerUpdated} onSubmitAnswers={onSubmitAllAnswers ?? onSubmitAnswers} buildCompleted={buildCompleted} phaseLabel={phaseLabel} intentText={intentText} onIntentChange={onIntentChange} completeness={completeness} hasDesignResult={hasDesignResult} onContinue={onContinue} onRefine={onRefine} onCreateAgent={onCreateAgent} agentName={agentName} onAgentNameChange={onAgentNameChange} cliOutputLines={cliOutputLines} designQuestion={designQuestion} onAnswerQuestion={onAnswerQuestion} buildPhase={buildPhase} onStartTest={onStartTest} onApproveTest={onApproveTest} onRejectTest={onRejectTest} testOutputLines={testOutputLines} testPassed={testPassed} testError={testError} toolTestResults={toolTestResults} testSummary={testSummary} onViewAgent={onViewAgent} cellBuildStates={cellBuildStates} buildActivity={buildActivity} onApplyEdits={onApplyEdits} onDiscardEdits={onDiscardEdits} isPreBuild={isPreBuild} />);

  // When cellBuildStates are provided or in creation mode, render even without designResult (ghosted outlines)
  if ((!designResult && !hasBuildStates && !isCreationMode) || cells.length === 0) return (<div className="flex items-center justify-center py-12 text-sm text-muted-foreground/60">Matrix data unavailable.</div>);

  const firstFour = cells.slice(0, 4);
  const lastFour = cells.slice(4);

  return (
    <div className="flex flex-col gap-3 w-full h-full">
      {!hideHeader && (
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded bg-primary/20 flex items-center justify-center border border-primary/25 shadow-sm shadow-primary/20">
            <span className="text-[10px] font-bold text-foreground/60">M</span>
          </div>
          <h4 className="text-base font-bold text-foreground/80 uppercase tracking-wider">Persona Matrix</h4>
        </div>
      )}
      <div className={`grid grid-rows-[1fr_1fr_1fr] gap-2.5 flex-1 min-h-0 w-full min-w-[1100px] ${
        isPreBuild ? 'grid-cols-[1fr_4fr_1fr]' : 'grid-cols-[2fr_2.6fr_2fr]'
      }`}>
        {firstFour.map((cell) => (
          <motion.div key={cell.key} custom={cell.key} variants={cellRevealVariants} initial={shouldAnimate ? "hidden" : false} animate="visible">
            <MatrixCellRenderer cell={cell} isEditMode={isEditMode || editingCellKey === cell.key} buildLocked={buildLocked} cellBuildStatus={effectiveCellStates?.[cell.key]} onCellRef={handleCellRef} questionCount={pendingQuestions?.filter((q) => q.cellKey === cell.key).length ?? 0} onConfirmUpdate={(key) => useAgentStore.getState().confirmCellUpdate(key)} onCellClick={isDraftPhase && isCreationMode ? () => handleCellEditClick(cell.key) : undefined} isInlineEditing={editingCellKey === cell.key} compact={isPreBuild} />
          </motion.div>
        ))}
        <div className={`relative rounded-xl border border-primary/40 p-5 ${isPreBuild ? 'min-h-[280px]' : 'min-h-[200px]'} ring-1 ring-primary/15 shadow-2xl shadow-primary/5 bg-white/[0.05] backdrop-blur-lg overflow-hidden${buildPhase === 'awaiting_input' ? ' animate-pulse' : ''}`}>
          {/* Corner glows -- stronger at corners, thinner mid-lanes */}
          <div className="absolute inset-0 pointer-events-none matrix-center-corner-glow" />
          {/* Subtle mid-lane fill */}
          <div className="absolute inset-0 bg-card-bg" />
          <div className="absolute inset-0 opacity-[0.04] pointer-events-none matrix-center-midlane-fill" />
          <div className="relative z-10 h-full">{commandCenter}</div>
        </div>
        {lastFour.map((cell) => (
          <motion.div key={cell.key} custom={cell.key} variants={cellRevealVariants} initial={shouldAnimate ? "hidden" : false} animate="visible">
            <MatrixCellRenderer cell={cell} isEditMode={isEditMode || editingCellKey === cell.key} buildLocked={buildLocked} cellBuildStatus={effectiveCellStates?.[cell.key]} onCellRef={handleCellRef} questionCount={pendingQuestions?.filter((q) => q.cellKey === cell.key).length ?? 0} onConfirmUpdate={(key) => useAgentStore.getState().confirmCellUpdate(key)} onCellClick={isDraftPhase && isCreationMode ? () => handleCellEditClick(cell.key) : undefined} isInlineEditing={editingCellKey === cell.key} compact={isPreBuild} />
          </motion.div>
        ))}
      </div>

      {/* Spatial Q&A popovers anchored to cells with pending questions — only one open at a time */}
      {pendingQuestions?.map((q) => (
        <SpatialQuestionPopover
          key={q.cellKey}
          referenceElement={cellRefsRef.current[q.cellKey] ?? null}
          question={q}
          onAnswer={(cellKey, answer) => {
            setOpenQuestionKey(null);
            onAnswerBuildQuestion?.(cellKey, answer);
          }}
          isOpen={openQuestionKey === q.cellKey}
          onRequestOpen={() => setOpenQuestionKey(q.cellKey)}
          onRequestClose={() => setOpenQuestionKey(null)}
        />
      ))}
    </div>
  );
}
