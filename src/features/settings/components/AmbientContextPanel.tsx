import { useState, useEffect, useCallback } from 'react';
import { Radio, RefreshCw, Clipboard, FolderOpen, AppWindow, Zap, Plus, Trash2, Activity } from 'lucide-react';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import type { SensoryPolicy } from '@/lib/bindings/SensoryPolicy';
import type { ContextRule } from '@/lib/bindings/ContextRule';
import type { ContextAction } from '@/lib/bindings/ContextAction';
import { DEFAULT_SENSORY_POLICY } from '@/stores/slices/system/ambientContextSlice';

const SOURCE_ICONS: Record<string, typeof Clipboard> = {
  clipboard: Clipboard,
  file_watcher: FolderOpen,
  app_focus: AppWindow,
};

const ACTION_LABELS: Record<ContextAction, string> = {
  TriggerExecution: 'Trigger Execution',
  EmitEvent: 'Emit Event',
  Log: 'Log Only',
};


export function AmbientContextPanel() {
  const selectedPersonaId = useAgentStore((s) => s.selectedPersonaId);
  const {
    ambientSnapshot,
    ambientEnabled,
    ambientPolicy,
    fetchAmbientSnapshot,
    toggleAmbientEnabled,
    fetchSensoryPolicy,
    updateSensoryPolicy,
    resetSensoryPolicy,
    contextRules,
    contextStreamStats,
    fetchContextRules,
    addContextRule,
    removeContextRule,
    fetchContextStreamStats,
  } = useSystemStore();

  const [localPolicy, setLocalPolicy] = useState<SensoryPolicy>(DEFAULT_SENSORY_POLICY);
  const [filterInput, setFilterInput] = useState('');
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleName, setRuleName] = useState('');
  const [ruleSources, setRuleSources] = useState<string[]>([]);
  const [ruleSummaryContains, setRuleSummaryContains] = useState('');
  const [rulePathGlob, setRulePathGlob] = useState('');
  const [ruleAppFilter, setRuleAppFilter] = useState('');
  const [ruleAction, setRuleAction] = useState<ContextAction>('EmitEvent');
  const [ruleCooldown, setRuleCooldown] = useState(60);

  // Fetch ambient state on mount and when persona changes
  useEffect(() => {
    if (selectedPersonaId) {
      fetchAmbientSnapshot(selectedPersonaId);
      fetchSensoryPolicy(selectedPersonaId);
      fetchContextRules(selectedPersonaId);
      fetchContextStreamStats();
    }
  }, [selectedPersonaId, fetchAmbientSnapshot, fetchSensoryPolicy, fetchContextRules, fetchContextStreamStats]);

  // Sync local policy when store updates
  useEffect(() => {
    if (ambientPolicy) setLocalPolicy(ambientPolicy);
  }, [ambientPolicy]);

  // Auto-refresh snapshot every 5 seconds
  useEffect(() => {
    if (!selectedPersonaId || !ambientEnabled) return;
    const id = setInterval(() => {
      fetchAmbientSnapshot(selectedPersonaId);
      fetchContextStreamStats();
    }, 5000);
    return () => clearInterval(id);
  }, [selectedPersonaId, ambientEnabled, fetchAmbientSnapshot, fetchContextStreamStats]);

  const handleToggleEnabled = useCallback(async () => {
    await toggleAmbientEnabled(!ambientEnabled);
  }, [ambientEnabled, toggleAmbientEnabled]);

  const handlePolicyChange = useCallback(
    (field: keyof SensoryPolicy, value: boolean) => {
      if (!selectedPersonaId) return;
      const updated = { ...localPolicy, [field]: value };
      setLocalPolicy(updated);
      updateSensoryPolicy(selectedPersonaId, updated);
    },
    [localPolicy, selectedPersonaId, updateSensoryPolicy],
  );

  const handleAddFilter = useCallback(() => {
    if (!filterInput.trim() || !selectedPersonaId) return;
    const updated = {
      ...localPolicy,
      focusAppFilter: [...localPolicy.focusAppFilter, filterInput.trim()],
    };
    setLocalPolicy(updated);
    updateSensoryPolicy(selectedPersonaId, updated);
    setFilterInput('');
  }, [filterInput, localPolicy, selectedPersonaId, updateSensoryPolicy]);

  const handleRemoveFilter = useCallback(
    (index: number) => {
      if (!selectedPersonaId) return;
      const updated = {
        ...localPolicy,
        focusAppFilter: localPolicy.focusAppFilter.filter((_, i) => i !== index),
      };
      setLocalPolicy(updated);
      updateSensoryPolicy(selectedPersonaId, updated);
    },
    [localPolicy, selectedPersonaId, updateSensoryPolicy],
  );

  const handleReset = useCallback(async () => {
    if (!selectedPersonaId) return;
    await resetSensoryPolicy(selectedPersonaId);
    setLocalPolicy(DEFAULT_SENSORY_POLICY);
  }, [selectedPersonaId, resetSensoryPolicy]);

  const handleAddRule = useCallback(async () => {
    if (!selectedPersonaId || !ruleName.trim()) return;
    const rule: ContextRule = {
      id: `cr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      personaId: selectedPersonaId,
      name: ruleName.trim(),
      pattern: {
        sources: ruleSources,
        summaryContains: ruleSummaryContains,
        pathGlob: rulePathGlob,
        appFilter: ruleAppFilter,
      },
      action: ruleAction,
      enabled: true,
      cooldownSecs: ruleCooldown,
    };
    await addContextRule(rule);
    setRuleName('');
    setRuleSources([]);
    setRuleSummaryContains('');
    setRulePathGlob('');
    setRuleAppFilter('');
    setRuleAction('EmitEvent');
    setRuleCooldown(60);
    setShowRuleForm(false);
  }, [selectedPersonaId, ruleName, ruleSources, ruleSummaryContains, rulePathGlob, ruleAppFilter, ruleAction, ruleCooldown, addContextRule]);

  const toggleSource = useCallback((source: string) => {
    setRuleSources((prev) =>
      prev.includes(source) ? prev.filter((s) => s !== source) : [...prev, source],
    );
  }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-medium text-foreground">Ambient Context Fusion</h3>
        </div>
        <AccessibleToggle
          checked={ambientEnabled}
          onChange={handleToggleEnabled}
          label="Ambient context fusion"
        />
      </div>

      <p className="text-xs text-muted-foreground/60">
        Ambient context captures clipboard, file changes, and app focus signals to give personas
        awareness of your desktop workflow.
      </p>

      {/* Context Stream Stats */}
      {ambientEnabled && contextStreamStats && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground/60">
          <div className="flex items-center gap-1">
            <Activity className="w-3 h-3" />
            <span>{contextStreamStats.totalEventsBroadcast} events broadcast</span>
          </div>
          <div className="flex items-center gap-1">
            <Zap className="w-3 h-3" />
            <span>{contextStreamStats.activeSubscribers} subscriber{contextStreamStats.activeSubscribers !== 1 ? 's' : ''}</span>
          </div>
        </div>
      )}

      {/* Live snapshot */}
      {ambientEnabled && ambientSnapshot && (
        <div className="border border-primary/10 rounded-lg bg-secondary/20 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground/80">Live Context Window</span>
            <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
              <span>{ambientSnapshot.totalSignalsCaptured} total signals</span>
              <button
                onClick={() => selectedPersonaId && fetchAmbientSnapshot(selectedPersonaId)}
                className="hover:text-foreground/80 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>
          </div>

          {ambientSnapshot.activeApp && (
            <div className="flex items-center gap-1.5 text-xs">
              <AppWindow className="w-3 h-3 text-purple-400" />
              <span className="text-foreground/80">
                {ambientSnapshot.activeApp}
                {ambientSnapshot.activeWindowTitle && (
                  <span className="text-muted-foreground/60"> &mdash; {ambientSnapshot.activeWindowTitle}</span>
                )}
              </span>
            </div>
          )}

          {ambientSnapshot.signals.length === 0 ? (
            <p className="text-xs text-muted-foreground/40 italic">No recent signals captured</p>
          ) : (
            <div className="max-h-40 overflow-y-auto space-y-1">
              {ambientSnapshot.signals.map((signal, i) => {
                const Icon = SOURCE_ICONS[signal.source] ?? Radio;
                const age =
                  signal.ageSecs < 60
                    ? `${signal.ageSecs}s`
                    : signal.ageSecs < 3600
                      ? `${Math.floor(signal.ageSecs / 60)}m`
                      : `${Math.floor(signal.ageSecs / 3600)}h`;

                return (
                  <div key={i} className="flex items-start gap-1.5 text-xs">
                    <Icon className="w-3 h-3 text-muted-foreground/60 mt-0.5 shrink-0" />
                    <span className="text-muted-foreground/70 truncate flex-1">{signal.summary}</span>
                    <span className="text-muted-foreground/40 shrink-0">{age}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Sensory Policy */}
      {ambientEnabled && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground/80">Sensory Policy</span>
            <button
              onClick={handleReset}
              className="text-xs text-muted-foreground/60 hover:text-foreground/80 transition-colors"
            >
              Reset to defaults
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {([
              { key: 'clipboard' as const, label: 'Clipboard', icon: Clipboard },
              { key: 'fileChanges' as const, label: 'File Changes', icon: FolderOpen },
              { key: 'appFocus' as const, label: 'App Focus', icon: AppWindow },
            ]).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => handlePolicyChange(key, !localPolicy[key])}
                className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-xs transition-colors ${
                  localPolicy[key]
                    ? 'border-blue-500/30 bg-blue-500/5 text-blue-400'
                    : 'border-primary/10 bg-secondary/20 text-muted-foreground/60'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {/* Focus App Filter */}
          <div className="space-y-1.5">
            <span className="text-xs text-muted-foreground/70">Focus App Filter</span>
            <p className="text-[10px] text-muted-foreground/40">
              Only capture signals when these apps are in focus. Empty = capture from any app.
            </p>
            <div className="flex gap-1.5">
              <input
                value={filterInput}
                onChange={(e) => setFilterInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddFilter()}
                placeholder="e.g. Code.exe"
                className="flex-1 px-2 py-1 bg-secondary/40 border border-primary/15 rounded text-xs text-foreground/80 placeholder:text-muted-foreground/40"
              />
              <button
                onClick={handleAddFilter}
                disabled={!filterInput.trim()}
                className="px-2 py-1 bg-secondary/40 hover:bg-secondary/60 text-xs rounded text-foreground/80 disabled:opacity-50"
              >
                Add
              </button>
            </div>
            {localPolicy.focusAppFilter.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {localPolicy.focusAppFilter.map((app, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-secondary/30 rounded text-xs text-muted-foreground/70"
                  >
                    {app}
                    <button
                      onClick={() => handleRemoveFilter(i)}
                      className="text-muted-foreground/40 hover:text-foreground/80"
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Context Rules */}
      {ambientEnabled && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs font-medium text-foreground/80">Context Rules</span>
            </div>
            <button
              onClick={() => setShowRuleForm(!showRuleForm)}
              className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              <Plus className="w-3 h-3" />
              Add Rule
            </button>
          </div>

          <p className="text-[10px] text-muted-foreground/40">
            Define patterns that trigger proactive persona actions when desktop context matches.
          </p>

          {/* Rule creation form */}
          {showRuleForm && (
            <div className="border border-primary/10 rounded-lg bg-secondary/20 p-3 space-y-2.5">
              <input
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                placeholder="Rule name (e.g. &quot;Crash debug helper&quot;)"
                className="w-full px-2 py-1 bg-secondary/40 border border-primary/15 rounded text-xs text-foreground/80 placeholder:text-muted-foreground/40"
              />

              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground/60">Match sources (empty = all)</span>
                <div className="flex gap-1.5">
                  {(['clipboard', 'file_watcher', 'app_focus'] as const).map((src) => (
                    <button
                      key={src}
                      onClick={() => toggleSource(src)}
                      className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
                        ruleSources.includes(src)
                          ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                          : 'border-primary/15 bg-secondary/30 text-muted-foreground/60'
                      }`}
                    >
                      {src}
                    </button>
                  ))}
                </div>
              </div>

              <input
                value={ruleSummaryContains}
                onChange={(e) => setRuleSummaryContains(e.target.value)}
                placeholder="Summary contains (e.g. &quot;error&quot;, &quot;Code.exe&quot;)"
                className="w-full px-2 py-1 bg-secondary/40 border border-primary/15 rounded text-xs text-foreground/80 placeholder:text-muted-foreground/40"
              />

              <div className="grid grid-cols-2 gap-2">
                <input
                  value={rulePathGlob}
                  onChange={(e) => setRulePathGlob(e.target.value)}
                  placeholder="File glob (e.g. *.rs)"
                  className="px-2 py-1 bg-secondary/40 border border-primary/15 rounded text-xs text-foreground/80 placeholder:text-muted-foreground/40"
                />
                <input
                  value={ruleAppFilter}
                  onChange={(e) => setRuleAppFilter(e.target.value)}
                  placeholder="App filter (e.g. Code.exe)"
                  className="px-2 py-1 bg-secondary/40 border border-primary/15 rounded text-xs text-foreground/80 placeholder:text-muted-foreground/40"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-0.5">
                  <span className="text-[10px] text-muted-foreground/60">Action</span>
                  <select
                    value={ruleAction}
                    onChange={(e) => setRuleAction(e.target.value as ContextAction)}
                    className="w-full px-2 py-1 bg-secondary/40 border border-primary/15 rounded text-xs text-foreground/80"
                  >
                    <option value="TriggerExecution">Trigger Execution</option>
                    <option value="EmitEvent">Emit Event</option>
                    <option value="Log">Log Only</option>
                  </select>
                </div>
                <div className="space-y-0.5">
                  <span className="text-[10px] text-muted-foreground/60">Cooldown (sec)</span>
                  <input
                    type="number"
                    min={0}
                    value={ruleCooldown}
                    onChange={(e) => setRuleCooldown(Number(e.target.value))}
                    className="w-full px-2 py-1 bg-secondary/40 border border-primary/15 rounded text-xs text-foreground/80"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowRuleForm(false)}
                  className="px-2.5 py-1 text-xs text-muted-foreground/70 hover:text-foreground/80 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddRule}
                  disabled={!ruleName.trim()}
                  className="px-2.5 py-1 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 text-xs rounded-md transition-colors disabled:opacity-50"
                >
                  Create Rule
                </button>
              </div>
            </div>
          )}

          {/* Existing rules list */}
          {contextRules.length === 0 ? (
            <p className="text-xs text-muted-foreground/40 italic">No context rules defined</p>
          ) : (
            <div className="space-y-1.5">
              {contextRules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center justify-between px-2.5 py-1.5 border border-primary/10 rounded-lg bg-secondary/10"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Zap className={`w-3 h-3 shrink-0 ${rule.enabled ? 'text-amber-400' : 'text-muted-foreground/40'}`} />
                    <div className="min-w-0">
                      <span className="text-xs text-foreground/80 block truncate">{rule.name}</span>
                      <span className="text-[10px] text-muted-foreground/40 block truncate">
                        {rule.pattern.sources.length > 0 ? rule.pattern.sources.join(', ') : 'all sources'}
                        {rule.pattern.summaryContains && ` / "${rule.pattern.summaryContains}"`}
                        {' '}&rarr; {ACTION_LABELS[rule.action]}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => removeContextRule(rule.id)}
                    className="text-muted-foreground/40 hover:text-red-400 transition-colors shrink-0 ml-2"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
