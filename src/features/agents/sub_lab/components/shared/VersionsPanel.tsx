import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  GitBranch, ArrowLeftRight, Shield,
  RotateCcw, ShieldCheck, Star, List, Clock,
} from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { VersionItem, DiffViewer, type VersionAction } from '@/features/agents/sub_lab/shared';
import ContentLoader from '@/features/shared/components/progress/ContentLoader';
import { ScoreTrendCard } from './ScoreTrendCard';
import { PromptTimeline } from './PromptTimeline';
import { useTranslation } from '@/i18n/useTranslation';
import { DebtText, debtText } from '@/i18n/DebtText';


type VersionView = 'list' | 'timeline';
const VIEW_KEY = 'dac-version-view';

export function VersionsPanel() {
  const { t } = useTranslation();
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const promptVersions = useAgentStore((s) => s.promptVersions);
  const healthErrorRate = useAgentStore((s) => s.healthErrorRate);
  const fetchVersions = useAgentStore((s) => s.fetchVersions);
  const tagVersion = useAgentStore((s) => s.tagVersion);
  const rollbackVersion = useAgentStore((s) => s.rollbackVersion);
  const fetchHealthRate = useAgentStore((s) => s.fetchHealthRate);
  const setLabMode = useAgentStore((s) => s.setLabMode);
  const setAbPreselect = useAgentStore((s) => s.setAbPreselect);
  const baselinePin = useAgentStore((s) => s.baselinePin);
  const pinBaseline = useAgentStore((s) => s.pinBaseline);
  const unpinBaseline = useAgentStore((s) => s.unpinBaseline);
  const loadBaseline = useAgentStore((s) => s.loadBaseline);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareAId, setCompareAId] = useState<string | null>(null);
  const [compareBId, setCompareBId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [healthLoading, setHealthLoading] = useState(false);
  const [activeActions, setActiveActions] = useState<Record<string, VersionAction>>({});
  const [actionErrors, setActionErrors] = useState<Record<string, string | null>>({});
  const [view, setView] = useState<VersionView>(() => (localStorage.getItem(VIEW_KEY) as VersionView) || 'timeline');

  const personaId = selectedPersona?.id;

  useEffect(() => {
    if (personaId) {
      setLoading(true);
      fetchVersions(personaId).finally(() => setLoading(false));
      fetchHealthRate(personaId);
      loadBaseline(personaId);
    }
  }, [personaId, fetchVersions, fetchHealthRate, loadBaseline]);

  const compareA = useMemo(
    () => promptVersions.find((v) => v.id === compareAId) ?? null,
    [promptVersions, compareAId],
  );
  const compareB = useMemo(
    () => promptVersions.find((v) => v.id === compareBId) ?? null,
    [promptVersions, compareBId],
  );

  const handleTag = useCallback(async (versionId: string, tag: string) => {
    const action: VersionAction = tag === 'production' ? 'promote' : tag === 'archived' ? 'archive' : 'unarchive';
    setActiveActions((p) => ({ ...p, [versionId]: action }));
    setActionErrors((p) => ({ ...p, [versionId]: null }));
    try {
      await tagVersion(versionId, tag);
    } catch (err) {
      setActionErrors((p) => ({ ...p, [versionId]: err instanceof Error ? err.message : 'Operation failed' }));
    } finally {
      setActiveActions((p) => ({ ...p, [versionId]: null }));
    }
  }, [tagVersion]);

  const handleRollback = useCallback(async (versionId: string) => {
    setActiveActions((p) => ({ ...p, [versionId]: 'rollback' }));
    setActionErrors((p) => ({ ...p, [versionId]: null }));
    try {
      await rollbackVersion(versionId);
    } catch (err) {
      setActionErrors((p) => ({ ...p, [versionId]: err instanceof Error ? err.message : 'Rollback failed' }));
    } finally {
      setActiveActions((p) => ({ ...p, [versionId]: null }));
    }
  }, [rollbackVersion]);

  const handleRefreshHealth = async () => {
    if (!personaId) return;
    setHealthLoading(true);
    await fetchHealthRate(personaId);
    setHealthLoading(false);
  };

  if (!personaId) {
    return <div className="typo-body text-foreground text-center py-8">{t.agents.lab.no_persona_selected}</div>;
  }

  const handleViewChange = (v: VersionView) => {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
  };

  if (view === 'timeline') {
    return (
      <div className="space-y-3">
        {/* View toggle */}
        <div className="flex items-center justify-end">
          <ViewToggle view={view} onChange={handleViewChange} />
        </div>
        <PromptTimeline />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 gap-4">
      {/* Left: Version list */}
      <div className="w-72 flex-shrink-0 flex flex-col min-h-0">
        <div className="flex items-center gap-2 mb-3 flex-shrink-0">
          <GitBranch className="w-4 h-4 text-primary/70" />
          <div>
            <h3 className="typo-body font-medium text-foreground">{t.agents.lab.persona_versions}</h3>
            <p className="text-[10px] text-foreground">{t.agents.lab.persona_versions_subtitle}</p>
          </div>
          <ViewToggle view={view} onChange={handleViewChange} />
          <span className="ml-auto typo-body text-foreground">{promptVersions.length}</span>
        </div>

        {loading ? (
          <ContentLoader variant="panel" hint="versions" />
        ) : promptVersions.length === 0 ? (
          <div className="text-center py-8 space-y-2">
            <GitBranch className="w-8 h-8 text-foreground mx-auto" />
            <p className="typo-body text-foreground">{t.agents.lab.no_versions}</p>
            <p className="typo-body text-foreground">{t.agents.lab.versions_auto_edit}</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
            {promptVersions.map((v) => (
              <VersionItem
                key={v.id}
                version={v}
                isSelected={selectedId === v.id}
                isCompareA={compareAId === v.id}
                isCompareB={compareBId === v.id}
                isBaseline={baselinePin?.versionId === v.id}
                onSelect={() => setSelectedId(selectedId === v.id ? null : v.id)}
                onTag={(tag) => void handleTag(v.id, tag)}
                onRollback={() => void handleRollback(v.id)}
                onSetCompareA={() => setCompareAId(compareAId === v.id ? null : v.id)}
                onSetCompareB={() => setCompareBId(compareBId === v.id ? null : v.id)}
                onPinBaseline={() => personaId && pinBaseline(personaId, v.id, v.version_number, '')}
                onUnpinBaseline={() => personaId && unpinBaseline(personaId)}
                activeAction={activeActions[v.id] ?? null}
                actionError={actionErrors[v.id] ?? null}
                onDismissError={() => setActionErrors((p) => ({ ...p, [v.id]: null }))}
              />
            ))}
          </div>
        )}
      </div>

      {/* Right: Detail panel */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0 space-y-4">
        {/* Diff viewer */}
        {compareA && compareB ? (
          <DiffViewer versionA={compareA} versionB={compareB} />
        ) : (
          <div className="text-center py-12 space-y-2">
            <ArrowLeftRight className="w-8 h-8 text-foreground mx-auto" />
            <p className="typo-body text-foreground">{t.agents.lab.select_two_compare}</p>
            <p className="typo-body text-foreground">
              <DebtText k="auto_click_the_4c521c2f" /> <span className="font-mono bg-blue-500/10 text-blue-400 px-1 rounded">A</span> and <span className="font-mono bg-violet-500/10 text-violet-400 px-1 rounded">B</span> <DebtText k="auto_buttons_on_any_version_1bdcaa1e" />
            </p>
          </div>
        )}

        {/* Compare in A/B button */}
        {compareA && compareB && (
          <button
            onClick={() => { setAbPreselect(compareAId, compareBId); setLabMode('ab'); }}
            className="flex items-center gap-2 px-4 py-2 rounded-modal bg-primary/10 text-primary/80 hover:bg-primary/15 transition-colors typo-body self-start"
          >
            {t.agents.lab.run_ab_versions}
          </button>
        )}

        {/* Regression nudge */}
        {baselinePin && promptVersions.some((v) => v.version_number > baselinePin.versionNumber && v.tag !== 'archived') && (
          <div className="animate-fade-slide-in flex items-center gap-3 px-4 py-3 rounded-modal border border-blue-500/15 bg-blue-500/5">
            <ShieldCheck className="w-5 h-5 text-blue-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="typo-heading text-blue-400"><DebtText k="auto_newer_versions_since_baseline_v_24ddb97b" />{baselinePin.versionNumber}</p>
              <p className="typo-caption text-foreground">
                <DebtText k="auto_run_a_regression_check_to_verify_the_new_p_34c1a639" />
              </p>
            </div>
            <button
              onClick={() => setLabMode('regression')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-card typo-caption bg-blue-500/15 text-blue-300 border border-blue-500/25 hover:bg-blue-500/25 transition-colors focus-ring flex-shrink-0"
            >
              <Star className="w-3 h-3" />
              {t.agents.lab.run_check}
            </button>
          </div>
        )}

        {/* Score trend */}
        <ScoreTrendCard personaId={personaId} />

        {/* Error rate monitor */}
        <div className="rounded-modal border border-primary/10 bg-secondary/20 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-400" />
            <h4 className="typo-body font-medium text-foreground">{t.agents.lab.error_rate_monitor}</h4>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="flex items-center justify-between typo-body text-foreground mb-1">
                <span>{t.agents.lab.last_10_execs}</span>
                <span>{healthLoading ? '...' : healthErrorRate != null ? `${(healthErrorRate * 100).toFixed(0)}%` : '--'}</span>
              </div>
              <div className="w-full h-2 rounded-full bg-secondary/60 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    healthErrorRate != null && healthErrorRate > 0.5
                      ? 'bg-red-400'
                      : healthErrorRate != null && healthErrorRate > 0.2
                        ? 'bg-amber-400'
                        : 'bg-emerald-400'
                  }`}
                  style={{ width: `${Math.min((healthErrorRate ?? 0) * 100, 100)}%` }}
                />
              </div>
            </div>
            <button
              onClick={() => void handleRefreshHealth()}
              disabled={healthLoading}
              className="p-1.5 rounded-card text-foreground hover:text-muted-foreground hover:bg-secondary/40 transition-colors"
              title={debtText("auto_refresh_error_rate_27711310")}
            >
              <RotateCcw className={`w-3.5 h-3.5 ${healthLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <p className="typo-body text-foreground">
            <DebtText k="auto_if_error_rate_exceeds_50_after_a_prompt_ch_aad3cf92" />
          </p>
        </div>
      </div>
    </div>
  );
}

// ── View toggle ───────────────────────────────────────────────────────

function ViewToggle({ view, onChange }: { view: VersionView; onChange: (v: VersionView) => void }) {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-card bg-secondary/30 border border-primary/[0.06]">
      <button
        onClick={() => onChange('timeline')}
        className={`p-1.5 rounded-input transition-colors ${
          view === 'timeline' ? 'bg-primary/12 text-primary' : 'text-foreground hover:text-muted-foreground/60'
        }`}
        title={debtText("auto_timeline_view_641aafe5")}
        aria-label={debtText("auto_timeline_view_641aafe5")}
      >
        <Clock className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => onChange('list')}
        className={`p-1.5 rounded-input transition-colors ${
          view === 'list' ? 'bg-primary/12 text-primary' : 'text-foreground hover:text-muted-foreground/60'
        }`}
        title={debtText("auto_list_view_694bbd75")}
        aria-label={debtText("auto_list_view_694bbd75")}
      >
        <List className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
