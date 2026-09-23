// Features - the roster of what this codebase claims to do, and the ground
// each claim is staked on.
//
// Two standalone contents behind one tab bar, never a three-way split: the MAP
// (the context map seen through the features that claim it) and one FEATURE
// (its rating, its slice, its branches and its history). Selecting a feature
// keeps the tab you are on, because moving the reader is not the same as
// answering them.
//
// The whole page is ONE read. `getFeatureBoard` returns 50-100 features over
// 200+ contexts in a single payload; a per-feature round trip would be a
// hundred IPC calls to paint one screen.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layers, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { ContentBody, ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { SegmentedTabs, segmentedTabPanelProps, type SegmentedTab } from '@/features/shared/components/layout/SegmentedTabs';
import { DispatchChooserModal, type DispatchRequest } from '@/features/shared/dispatch/DispatchChooser';
import { navigateToCompanions } from '@/features/companions/navigation';
import { arriveAtDevTools } from '@/features/plugins/pluginArrival';
import { LifecycleProjectPicker } from '@/features/plugins/dev-tools/sub_lifecycle/LifecycleProjectPicker';
import { buildCouncilDispatch } from '@/features/plugins/dev-tools/sub_context/councilDispatch';
import { isCouncilRunning, useCouncilStates } from '@/features/plugins/dev-tools/sub_context/useCouncilStates';
import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { isTypingTarget } from '@/lib/keyboard/KeyboardNavMode';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { useTranslation } from '@/i18n/useTranslation';
import type { FeatureBoard } from '@/lib/bindings/FeatureBoard';
import type { UpsertScenarioInput } from '@/lib/bindings/UpsertScenarioInput';
import { matchesQuery } from '@/lib/text/search';
import { extractMessage, toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import { BoardBand, type BandFilter } from './band/BoardBand';
import { removeScenario, saveScenario, toggleTier } from './featureActions';
import { FeatureColumn } from './column/FeatureColumn';
import { FeatureTab } from './feature/FeatureTab';
import { buildFeaturesModel } from './featuresModel';
import type { FeatureRow, FeatureSort } from './featureRules';
import { IS_DEV, loadFeaturesFixture } from './fixture/featuresFixture';
import { MapTab } from './map/MapTab';
import { useFeatureBoard } from './useFeatureBoard';
import { CadastrePage } from './cadastre/CadastrePage';
import { FEATURES_VARIANTS, FEATURES_VARIANT_TAB_PREFIX, useFeaturesVariant, type FeaturesVariant } from './featuresVariant';

type ContentTab = 'map' | 'feature';

export default function FeaturesPage() {
  const { t, tx, language } = useTranslation();
  const f = t.features;
  const tDev = t.plugins.dev_tools;

  const activeProject = useSystemStore((s) => s.projects.find((p) => p.id === s.activeProjectId));
  const devToolsReachable = useSystemStore((s) => s.enabledPlugins.has('dev-tools'));
  const setPendingCouncilSubjectId = useSystemStore((s) => s.setPendingCouncilSubjectId);

  const [fixture, setFixture] = useState<{ boards: FeatureBoard[]; runningSlugs: Set<string> } | null>(null);
  /* Board or Cadastre: two surfaces behind one persisted switch while the
     contest winner is promoted (`featuresVariant.ts`). */
  const [variant, setVariant] = useFeaturesVariant();
  const [tab, setTab] = useState<ContentTab>('map');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<FeatureSort>('move');
  const [bandFilter, setBandFilter] = useState<BandFilter | null>(null);
  const [columnOpen, setColumnOpen] = useState(true);
  const [request, setRequest] = useState<DispatchRequest | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const fixtureBoard = fixture?.boards[0] ?? null;
  const projectId = activeProject?.id ?? null;
  const { board, loading, error, refresh } = useFeatureBoard(projectId, fixtureBoard);
  const councilStates = useCouncilStates(fixtureBoard ? null : projectId, activeProject?.root_path ?? null);

  const runningSlugs = useMemo(() => {
    if (fixture) return fixture.runningSlugs;
    if (!projectId) return new Set<string>();
    const live = new Set<string>();
    for (const feature of board?.features ?? []) {
      if (isCouncilRunning(councilStates.runningKeys, projectId, feature.slug)) live.add(feature.slug);
    }
    return live;
  }, [fixture, projectId, board, councilStates.runningKeys]);

  const model = useMemo(
    () => (board ? buildFeaturesModel(board, runningSlugs) : null),
    [board, runningSlugs],
  );

  // `/` focuses the filter, exactly as it does in every other list in the app.
  useAppKeyboard(
    useCallback((e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return false;
      if (e.key !== '/') return false;
      filterRef.current?.focus();
      return true;
    }, []),
    { priority: ROUTE_DECISION_PRIORITY },
  );

  // A project change drops the selection: a feature id from another project
  // resolves to nothing, and a stale detail tab is worse than no tab.
  useEffect(() => { setSelectedId(null); }, [projectId, fixtureBoard]);

  const rows = useMemo(() => {
    if (!model) return [];
    let visible = model.rows;
    if (query) visible = visible.filter((r) => matchesQuery(r.feature.name, query, language));
    if (bandFilter === 'waiting') visible = visible.filter((r) => r.move === 'waiting');
    if (bandFilter === 'trouble') visible = visible.filter((r) => r.move === 'trouble');
    return visible;
  }, [model, query, bandFilter, language]);

  const selected = selectedId ? model?.rowById.get(selectedId) ?? null : null;
  const selectedContextIds = useMemo(
    () => new Set(selected?.feature.contextIds ?? []),
    [selected],
  );
  const groupNameById = useMemo(
    () => new Map((board?.groups ?? []).map((g) => [g.id, g.name])),
    [board?.groups],
  );

  /* Typed navigation through the shared GATED door: the plugin and the
     dev-tools tab are members of their own closed unions, so nothing is parsed
     out of a label on the way and a rename is a compile error - and the door
     reads `enabledPlugins` first, so a person who has switched Dev Tools off is
     never landed on it. The affordance is hidden when it would refuse. */
  const openContext = useCallback(() => {
    arriveAtDevTools('context-map');
  }, []);

  const openDecision = useCallback((subjectId: string) => {
    setPendingCouncilSubjectId(subjectId);
    navigateToCompanions('curator:council');
  }, [setPendingCouncilSubjectId]);

  const runCouncil = useCallback((row: FeatureRow) => {
    if (!activeProject) return;
    setRequest(
      buildCouncilDispatch({
        target: {
          projectId: activeProject.id,
          projectName: activeProject.name,
          rootPath: activeProject.root_path,
        },
        slug: row.feature.slug,
        featureName: row.feature.name,
        roundNo: row.feature.council?.roundNo ?? null,
      }),
    );
  }, [activeProject]);

  /* Every write is refused outright while the fixture is on: the fixture is a
     comparison view over checked-in bytes, and nothing it shows has a row
     behind it to update. */
  const doToggleTier = useCallback(async (row: FeatureRow) => {
    if (fixtureBoard) return;
    await toggleTier(row.feature.id, row.feature.tier, refresh);
  }, [fixtureBoard, refresh]);

  const doUpsert = useCallback(async (input: UpsertScenarioInput) => {
    if (fixtureBoard) return;
    await saveScenario(input, refresh);
  }, [fixtureBoard, refresh]);

  const doDelete = useCallback(async (id: string) => {
    if (fixtureBoard) return;
    await removeScenario(id, refresh);
  }, [fixtureBoard, refresh]);

  const pickFeature = useCallback((featureId: string) => setSelectedId(featureId), []);
  const openFeature = useCallback((featureId: string) => {
    setSelectedId(featureId);
    setTab('feature');
  }, []);

  const tabs: SegmentedTab<ContentTab>[] = [
    { id: 'map', label: f.tab_map },
    { id: 'feature', label: f.tab_feature },
  ];

  return (
    <ContentBox data-testid="features-page">
      <ContentHeader
        icon={<Layers className="h-5 w-5 text-primary" />}
        iconColor="primary"
        title={t.sidebar.features}
        subtitle={board?.projectName}
        fitWidth
        actions={
          <div className="flex items-center gap-2">
            <SegmentedTabs<FeaturesVariant>
              tabs={FEATURES_VARIANTS.map((id) => ({
                id,
                label: id === 'board' ? f.variant_board : f.variant_cadastre,
                testId: `features-variant-${id}`,
              }))}
              activeTab={variant}
              onTabChange={setVariant}
              ariaLabel={f.variant_switcher_aria}
              idPrefix={FEATURES_VARIANT_TAB_PREFIX}
              size="sm"
              fullWidth={false}
            />
            {IS_DEV ? (
              <Tooltip content={f.fixture_note}>
                <span>
                  <AccessibleToggle
                    checked={fixture != null}
                    label={f.fixture_toggle}
                    onChange={() => {
                      if (fixture) { setFixture(null); return; }
                      void loadFeaturesFixture()
                        .then(setFixture)
                        .catch(toastCatch('features:loadFixture'));
                    }}
                  />
                </span>
              </Tooltip>
            ) : null}
            <LifecycleProjectPicker />
          </div>
        }
      />

      <ContentBody flex>
        <div className="flex min-h-0 flex-1 flex-col" data-testid="features-stage">
          {/* Permanent chrome: the band renders whether or not the read landed,
              so a fetch never blanks the page (loading pattern v2, law 1). */}
          {board ? (
            <BoardBand
              totals={board.totals}
              moves={model?.rows.map((r) => r.move) ?? []}
              unclaimedContexts={model?.unclaimed.length ?? 0}
              untouchedGroups={model?.untouched.length ?? 0}
              filter={bandFilter}
              onFilter={setBandFilter}
              t={f}
              tx={tx}
            />
          ) : null}

          {error != null ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <ScenarioEmptyState
                title={f.unreadable_title}
                subtitle={resolveErrorTranslated(t, extractMessage(error)).message}
                action={{ label: f.unreadable_retry, onClick: refresh }}
              />
            </div>
          ) : !projectId && !fixtureBoard ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <ScenarioEmptyState title={f.no_project_title} subtitle={f.no_project_subtitle} />
            </div>
          ) : loading && !board ? (
            /* A calm ghost UNDER the chrome, never a spinner for a surface. */
            <div className="flex-1 p-4" aria-hidden="true" data-testid="features-ghost">
              <div className="h-full rounded-card border border-primary/15 bg-primary/5 shadow-elevation-1 bg-secondary/25" />
            </div>
          ) : board?.neverScanned ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <ScenarioEmptyState
                title={f.never_scanned_title}
                subtitle={f.never_scanned_subtitle}
                action={devToolsReachable ? { label: f.never_scanned_action, onClick: openContext } : undefined}
              />
            </div>
          ) : board && board.features.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <ScenarioEmptyState
                title={f.no_features_title}
                subtitle={f.no_features_subtitle}
                action={devToolsReachable ? { label: f.no_features_action, onClick: openContext } : undefined}
              />
            </div>
          ) : model && board && variant === 'cadastre' ? (
            <CadastrePage
              board={board}
              model={model}
              fixture={fixtureBoard != null}
              filterRef={filterRef}
              onOpenContext={openContext}
              onOpenDecision={openDecision}
              onRunCouncil={runCouncil}
              onToggleTier={doToggleTier}
              onUpsertScenario={doUpsert}
              onDeleteScenario={doDelete}
              t={f}
              tDev={tDev}
              tCommon={{ save: t.common.save, cancel: t.common.cancel, delete: t.common.delete }}
              tx={tx}
              language={language}
            />
          ) : model && board ? (
            <div className="flex min-h-0 flex-1">
              {columnOpen ? (
                <aside className="flex w-[312px] flex-none flex-col border-r border-border">
                  <FeatureColumn
                    rows={rows}
                    sort={sort}
                    onSort={setSort}
                    query={query}
                    onQuery={setQuery}
                    filterRef={filterRef}
                    selectedId={selectedId}
                    onSelect={pickFeature}
                    onOpen={openFeature}
                    totalGroups={board.groups.length}
                    t={f}
                    tDev={tDev}
                    tx={tx}
                  />
                </aside>
              ) : null}

              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                  <Tooltip content={columnOpen ? f.collapse_column : f.expand_column}>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={columnOpen ? f.collapse_column : f.expand_column}
                      data-testid="features-column-toggle"
                      onClick={() => setColumnOpen((v) => !v)}
                      icon={columnOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
                    />
                  </Tooltip>
                  <SegmentedTabs
                    tabs={tabs}
                    activeTab={tab}
                    onTabChange={setTab}
                    ariaLabel={f.tabs_label}
                    idPrefix="features-tab"
                  />
                </div>

                {/* The strip promises it selects among mutually exclusive
                    regions, so the region DECLARES that it is one of them:
                    `segmentedTabPanelProps` closes the aria-controls the strip
                    emits, which would otherwise dangle. */}
                <div
                  {...segmentedTabPanelProps('features-tab', tab)}
                  className="min-h-0 flex-1 overflow-y-auto"
                >
                  {tab === 'map' ? (
                    <MapTab
                      model={model}
                      selectedContextIds={selectedContextIds}
                      hasSelection={selected != null}
                      onPickFeature={pickFeature}
                      onOpenContext={openContext}
                      t={f}
                      tx={tx}
                    />
                  ) : selected ? (
                    <FeatureTab
                      row={selected}
                      sliceCells={selected.feature.contextIds
                        .map((id) => model.cellById.get(id))
                        .filter((c): c is NonNullable<typeof c> => c != null)}
                      groupNameById={groupNameById}
                      onOpenContext={openContext}
                      onOpenDecision={openDecision}
                      onRunCouncil={runCouncil}
                      onToggleTier={doToggleTier}
                      onUpsertScenario={doUpsert}
                      onDeleteScenario={doDelete}
                      t={f}
                      tDev={tDev}
                      tCommon={{ save: t.common.save, cancel: t.common.cancel, delete: t.common.delete }}
                      tx={tx}
                      language={language}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center p-6">
                      <ScenarioEmptyState title={f.pick_title} subtitle={f.pick_subtitle} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </ContentBody>

      {request && <DispatchChooserModal request={request} onClose={() => setRequest(null)} />}
    </ContentBox>
  );
}
