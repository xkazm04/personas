import { useState, useEffect, useCallback } from 'react';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { Radio, RefreshCw, Clipboard, FolderOpen, AppWindow, Zap, Plus, Trash2, Activity } from 'lucide-react';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { NumberStepper } from '@/features/shared/components/forms/NumberStepper';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import type { SensoryPolicy } from '@/lib/bindings/SensoryPolicy';
import type { ContextRule } from '@/lib/bindings/ContextRule';
import type { ContextAction } from '@/lib/bindings/ContextAction';
import { DEFAULT_SENSORY_POLICY } from '@/stores/slices/system/ambientContextSlice';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch, extractMessage } from '@/lib/silentCatch';
import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
import { resolveError } from '@/lib/errors/errorRegistry';
import Button from '@/features/shared/components/buttons/Button';

const SOURCE_ICONS: Record<string, typeof Clipboard> = {
  clipboard: Clipboard,
  file_watcher: FolderOpen,
  app_focus: AppWindow,
};

// Action labels are resolved at render time via useTranslation
const ACTION_LABEL_KEYS: Record<ContextAction, 'action_trigger' | 'action_emit' | 'action_log'> = {
  triggerExecution: 'action_trigger',
  emitEvent: 'action_emit',
  log: 'action_log',
};


export function AmbientContextPanel() {
  const selectedPersonaId = useAgentStore((s) => s.selectedPersonaId);
  const ambientSnapshot = useSystemStore((s) => s.ambientSnapshot);
  const ambientEnabled = useSystemStore((s) => s.ambientEnabled);
  const ambientPolicy = useSystemStore((s) => s.ambientPolicy);
  const ambientPolicyError = useSystemStore((s) => s.ambientPolicyError);
  const fetchAmbientSnapshot = useSystemStore((s) => s.fetchAmbientSnapshot);
  const toggleAmbientEnabled = useSystemStore((s) => s.toggleAmbientEnabled);
  const fetchSensoryPolicy = useSystemStore((s) => s.fetchSensoryPolicy);
  const updateSensoryPolicy = useSystemStore((s) => s.updateSensoryPolicy);
  const resetSensoryPolicy = useSystemStore((s) => s.resetSensoryPolicy);
  const contextRules = useSystemStore((s) => s.contextRules);
  const contextStreamStats = useSystemStore((s) => s.contextStreamStats);
  const fetchContextRules = useSystemStore((s) => s.fetchContextRules);
  const addContextRule = useSystemStore((s) => s.addContextRule);
  const removeContextRule = useSystemStore((s) => s.removeContextRule);
  const fetchContextStreamStats = useSystemStore((s) => s.fetchContextStreamStats);

  const [localPolicy, setLocalPolicy] = useState<SensoryPolicy>(DEFAULT_SENSORY_POLICY);
  const [filterInput, setFilterInput] = useState('');
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleName, setRuleName] = useState('');
  const [ruleSources, setRuleSources] = useState<string[]>([]);
  const [ruleSummaryContains, setRuleSummaryContains] = useState('');
  const [rulePathGlob, setRulePathGlob] = useState('');
  const [ruleAppFilter, setRuleAppFilter] = useState('');
  const [ruleAction, setRuleAction] = useState<ContextAction>('emitEvent');
  const [ruleCooldown, setRuleCooldown] = useState(60);
  const { t, tx } = useTranslation();
  const s = t.settings.ambient;

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
      const previous = localPolicy;
      const updated = { ...localPolicy, [field]: value };
      setLocalPolicy(updated);
      updateSensoryPolicy(selectedPersonaId, updated).catch((e: unknown) => {
        setLocalPolicy(previous);
        toastCatch('AmbientContextPanel:updatePolicy')(e);
      });
    },
    [localPolicy, selectedPersonaId, updateSensoryPolicy],
  );

  const handleAddFilter = useCallback(() => {
    if (!filterInput.trim() || !selectedPersonaId) return;
    const previous = localPolicy;
    const updated = {
      ...localPolicy,
      focusAppFilter: [...localPolicy.focusAppFilter, filterInput.trim()],
    };
    setLocalPolicy(updated);
    updateSensoryPolicy(selectedPersonaId, updated).catch((e: unknown) => {
      setLocalPolicy(previous);
      toastCatch('AmbientContextPanel:addFilter')(e);
    });
    setFilterInput('');
  }, [filterInput, localPolicy, selectedPersonaId, updateSensoryPolicy]);

  const handleRemoveFilter = useCallback(
    (index: number) => {
      if (!selectedPersonaId) return;
      const previous = localPolicy;
      const updated = {
        ...localPolicy,
        focusAppFilter: localPolicy.focusAppFilter.filter((_, i) => i !== index),
      };
      setLocalPolicy(updated);
      updateSensoryPolicy(selectedPersonaId, updated).catch((e: unknown) => {
        setLocalPolicy(previous);
        toastCatch('AmbientContextPanel:removeFilter')(e);
      });
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
    try {
      await addContextRule(rule);
      setRuleName('');
      setRuleSources([]);
      setRuleSummaryContains('');
      setRulePathGlob('');
      setRuleAppFilter('');
      setRuleAction('emitEvent');
      setRuleCooldown(60);
      setShowRuleForm(false);
    } catch (e) {
      toastCatch('AmbientContextPanel:addRule')(e);
    }
  }, [selectedPersonaId, ruleName, ruleSources, ruleSummaryContains, rulePathGlob, ruleAppFilter, ruleAction, ruleCooldown, addContextRule]);

  const toggleSource = useCallback((source: string) => {
    setRuleSources((prev) =>
      prev.includes(source) ? prev.filter((src) => src !== source) : [...prev, source],
    );
  }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-status-info" />
          <h3 className="typo-body text-foreground">{s.title}</h3>
        </div>
        <AccessibleToggle
          checked={ambientEnabled}
          onChange={handleToggleEnabled}
          label={s.toggle_aria}
        />
      </div>

      <p className="typo-caption text-foreground">
        {s.description}
      </p>

      {/* Context Stream Stats */}
      {ambientEnabled && contextStreamStats && (
        <div className="flex items-center gap-3 typo-caption text-foreground">
          <div className="flex items-center gap-1">
            <Activity className="w-3 h-3" />
            <span>{tx(s.events_broadcast, { count: Number(contextStreamStats.totalEventsBroadcast) })}</span>
          </div>
          <div className="flex items-center gap-1">
            <Zap className="w-3 h-3" />
            <span>{tx(Number(contextStreamStats.activeSubscribers) !== 1 ? s.subscribers_plural : s.subscribers, { count: Number(contextStreamStats.activeSubscribers) })}</span>
          </div>
        </div>
      )}

      {/* Live snapshot */}
      {ambientEnabled && ambientSnapshot && (
        <div className="border border-hair rounded-card bg-surface-1 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="typo-caption text-foreground">{s.live_context}</span>
            <div className="flex items-center gap-2 typo-caption text-foreground">
              <span>{tx(s.total_signals, { count: Number(ambientSnapshot.totalSignalsCaptured) })}</span>
              <Button
                type="button"
                onClick={() => selectedPersonaId && fetchAmbientSnapshot(selectedPersonaId)}
                variant="ghost"
                size="icon-sm"
              >
                <RefreshCw className="w-3 h-3" />
              </Button>
            </div>
          </div>

          {ambientSnapshot.activeApp && (
            <div className="flex items-center gap-1.5 typo-caption">
              <AppWindow className="w-3 h-3 text-role-agent" />
              <span className="text-foreground font-medium">
                {ambientSnapshot.activeApp}
                {ambientSnapshot.activeWindowTitle && (
                  <span className="text-foreground font-normal"> &mdash; {ambientSnapshot.activeWindowTitle}</span>
                )}
              </span>
            </div>
          )}

          {ambientSnapshot.signals.length === 0 ? (
            <ScenarioEmptyState art="stream" size="sm" title={s.no_signals} />
          ) : (
            <div className="max-h-40 overflow-y-auto space-y-1">
              {ambientSnapshot.signals.map((signal, i) => {
                const Icon = SOURCE_ICONS[signal.source] ?? Radio;
                const age =
                  signal.ageSecs < 60
                    ? `${signal.ageSecs}s`
                    : signal.ageSecs < 3600
                      ? `${Math.floor(Number(signal.ageSecs) / 60)}m`
                      : `${Math.floor(Number(signal.ageSecs) / 3600)}h`;

                return (
                  <div key={i} className="flex items-start gap-1.5 typo-caption">
                    <Icon className="w-3 h-3 text-foreground mt-0.5 shrink-0" />
                    <span className="text-foreground font-medium truncate flex-1">{signal.summary}</span>
                    <span className="text-foreground shrink-0">{age}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Sensory Policy: a failed read is shown as failed, never as defaults */}
      {ambientEnabled && ambientPolicy === null && ambientPolicyError != null && selectedPersonaId && (
        <ErrorBanner
          variant="inline"
          message={resolveError(extractMessage(ambientPolicyError)).message}
          onRetry={() => void fetchSensoryPolicy(selectedPersonaId)}
        />
      )}
      {ambientEnabled && !(ambientPolicy === null && ambientPolicyError != null) && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="typo-caption text-foreground">{s.sensory_policy}</span>
            <Button
              type="button"
              onClick={handleReset}
              variant="ghost"
              size="sm"
            >
              {s.reset_defaults}
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {([
              { key: 'clipboard' as const, label: s.clipboard, icon: Clipboard },
              { key: 'fileChanges' as const, label: s.file_changes, icon: FolderOpen },
              { key: 'appFocus' as const, label: s.app_focus, icon: AppWindow },
            ]).map(({ key, label, icon: Icon }) => (
              <Button
                type="button"
                key={key}
                onClick={() => handlePolicyChange(key, !localPolicy[key])}
                variant={localPolicy[key] ? 'accent' : 'secondary'}
                tone={localPolicy[key] ? 'info' : undefined}
                size="sm"
                icon={<Icon className="w-3.5 h-3.5" />}
              >
                <span>{label}</span>
              </Button>
            ))}
          </div>

          {/* Focus App Filter */}
          <div className="space-y-1.5">
            <span className="typo-caption text-foreground">{s.focus_filter}</span>
            <p className="typo-caption text-foreground">
              {s.focus_filter_hint}
            </p>
            <div className="flex gap-1.5">
              <input
                value={filterInput}
                onChange={(e) => setFilterInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddFilter()}
                placeholder={s.focus_filter_placeholder}
                className="flex-1 px-2 py-1 bg-surface-2 border border-hair rounded-interactive typo-caption text-foreground placeholder:text-ink-3"
              />
              <Button
                type="button"
                onClick={handleAddFilter}
                disabled={!filterInput.trim()}
                variant="ghost"
                size="xs"
              >
                {s.add}
              </Button>
            </div>
            {localPolicy.focusAppFilter.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {localPolicy.focusAppFilter.map((app, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-surface-1 rounded-interactive typo-caption text-foreground"
                  >
                    {app}
                    <Button
                      type="button"
                      onClick={() => handleRemoveFilter(i)}
                      variant="ghost"
                      size="sm"
                    >
                      &times;
                    </Button>
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
              <Zap className="w-3.5 h-3.5 text-status-warning" />
              <span className="typo-caption text-foreground">{s.context_rules}</span>
            </div>
            <Button
              type="button"
              onClick={() => setShowRuleForm(!showRuleForm)}
              variant="ghost"
              size="sm"
              icon={<Plus className="w-3 h-3" />}
            >
              {s.add_rule}
            </Button>
          </div>

          <p className="typo-caption text-foreground">
            {s.context_rules_hint}
          </p>

          {/* Rule creation form */}
          {showRuleForm && (
            <div className="border border-hair rounded-card bg-surface-1 p-3 space-y-2.5">
              <input
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                placeholder={s.rule_name_placeholder}
                className="w-full px-2 py-1 bg-surface-2 border border-hair rounded-interactive typo-caption text-foreground placeholder:text-ink-3"
              />

              <div className="space-y-1">
                <span className="typo-caption text-foreground">{s.match_sources}</span>
                <div className="flex gap-1.5">
                  {([
                    { src: 'clipboard' as const, label: s.clipboard },
                    { src: 'file_watcher' as const, label: s.file_changes },
                    { src: 'app_focus' as const, label: s.app_focus },
                  ]).map(({ src, label }) => (
                    <Button
                      type="button"
                      key={src}
                      onClick={() => toggleSource(src)}
                      variant={ruleSources.includes(src) ? 'accent' : 'secondary'}
                      tone={ruleSources.includes(src) ? 'warning' : undefined}
                      size="xs"
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>

              <input
                value={ruleSummaryContains}
                onChange={(e) => setRuleSummaryContains(e.target.value)}
                placeholder={s.summary_contains_placeholder}
                className="w-full px-2 py-1 bg-surface-2 border border-hair rounded-interactive typo-caption text-foreground placeholder:text-ink-3"
              />

              <div className="grid grid-cols-2 gap-2">
                <input
                  value={rulePathGlob}
                  onChange={(e) => setRulePathGlob(e.target.value)}
                  placeholder={s.file_glob_placeholder}
                  className="px-2 py-1 bg-surface-2 border border-hair rounded-interactive typo-caption text-foreground placeholder:text-ink-3"
                />
                <input
                  value={ruleAppFilter}
                  onChange={(e) => setRuleAppFilter(e.target.value)}
                  placeholder={s.app_filter_placeholder}
                  className="px-2 py-1 bg-surface-2 border border-hair rounded-interactive typo-caption text-foreground placeholder:text-ink-3"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-0.5">
                  <span className="typo-caption text-foreground">{s.action}</span>
                  <select
                    value={ruleAction}
                    onChange={(e) => setRuleAction(e.target.value as ContextAction)}
                    className="w-full px-2 py-1 bg-surface-2 border border-hair rounded-interactive typo-caption text-foreground"
                  >
                    <option value="triggerExecution">{s.action_trigger}</option>
                    <option value="emitEvent">{s.action_emit}</option>
                    <option value="log">{s.action_log}</option>
                  </select>
                </div>
                <div className="space-y-0.5">
                  <span className="typo-caption text-foreground">{s.cooldown}</span>
                  <NumberStepper
                    value={ruleCooldown}
                    onChange={(v) => setRuleCooldown(v ?? 0)}
                    min={0}
                    ariaLabel={s.cooldown}
                    className="w-full"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  onClick={() => setShowRuleForm(false)}
                  variant="ghost"
                  size="xs"
                >
                  {s.cancel}
                </Button>
                <Button
                  type="button"
                  onClick={handleAddRule}
                  disabled={!ruleName.trim()}
                  variant="ghost"
                  size="xs"
                >
                  {s.create_rule}
                </Button>
              </div>
            </div>
          )}

          {/* Existing rules list */}
          {contextRules.length === 0 ? (
            <ScenarioEmptyState art="shield" size="sm" title={s.no_rules} />
          ) : (
            <div className="space-y-1.5">
              {contextRules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center justify-between px-2.5 py-1.5 border border-hair rounded-card bg-secondary/10"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Zap className={`w-3 h-3 shrink-0 ${rule.enabled ? 'text-status-warning' : 'text-foreground'}`} />
                    <div className="min-w-0">
                      <span className="typo-caption text-foreground block truncate">{rule.name}</span>
                      <span className="typo-caption text-foreground block truncate">
                        {rule.pattern.sources.length > 0 ? rule.pattern.sources.join(', ') : s.all_sources}
                        {rule.pattern.summaryContains && ` / "${rule.pattern.summaryContains}"`}
                        {' '}&rarr; {s[ACTION_LABEL_KEYS[rule.action]]}
                      </span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    onClick={() => removeContextRule(rule.id)}
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 ml-2"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
