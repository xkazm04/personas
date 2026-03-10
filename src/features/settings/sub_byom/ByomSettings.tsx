import { useEffect, useState, useCallback } from 'react';
import { Network, Shield, Route, ScrollText, Plus, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import {
  getByomPolicy,
  setByomPolicy,
  deleteByomPolicy,
  listProviderAuditLog,
  getProviderUsageStats,
} from '@/api/byom';
import type {
  ByomPolicy,
  RoutingRule,
  ComplianceRule,
  TaskComplexity,
  ProviderAuditEntry,
  ProviderUsageStats,
} from '@/api/byom';
import type { CliEngine } from '@/lib/types/types';

const PROVIDER_OPTIONS: { id: CliEngine; label: string }[] = [
  { id: 'claude_code', label: 'Claude Code' },
  { id: 'codex_cli', label: 'Codex CLI' },
  { id: 'gemini_cli', label: 'Gemini CLI' },
  { id: 'copilot_cli', label: 'Copilot CLI' },
];

const COMPLEXITY_OPTIONS: { id: TaskComplexity; label: string; description: string }[] = [
  { id: 'simple', label: 'Simple', description: 'Formatting, linting, small edits' },
  { id: 'standard', label: 'Standard', description: 'Feature implementation, refactoring' },
  { id: 'critical', label: 'Critical', description: 'Architecture changes, security work' },
];

const ENGINE_LABELS: Record<string, string> = {
  claude_code: 'Claude Code',
  codex_cli: 'Codex CLI',
  gemini_cli: 'Gemini CLI',
  copilot_cli: 'Copilot CLI',
};

function defaultPolicy(): ByomPolicy {
  return {
    enabled: false,
    allowed_providers: [],
    blocked_providers: [],
    routing_rules: [],
    compliance_rules: [],
  };
}

export default function ByomSettings() {
  const [policy, setPolicy] = useState<ByomPolicy>(defaultPolicy());
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [auditLog, setAuditLog] = useState<ProviderAuditEntry[]>([]);
  const [usageStats, setUsageStats] = useState<ProviderUsageStats[]>([]);
  const [activeSection, setActiveSection] = useState<'policy' | 'routing' | 'compliance' | 'audit'>('policy');

  useEffect(() => {
    getByomPolicy().then((p) => {
      if (p) setPolicy(p);
      setLoaded(true);
    }).catch(() => setLoaded(true));
    listProviderAuditLog(50).then(setAuditLog).catch(() => {});
    getProviderUsageStats().then(setUsageStats).catch(() => {});
  }, []);

  const handleSave = useCallback(async () => {
    await setByomPolicy(policy);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [policy]);

  const handleReset = useCallback(async () => {
    await deleteByomPolicy();
    setPolicy(defaultPolicy());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, []);

  const toggleEnabled = useCallback(() => {
    setPolicy((p) => ({ ...p, enabled: !p.enabled }));
  }, []);

  const toggleProvider = useCallback((providerId: string, list: 'allowed' | 'blocked') => {
    setPolicy((p) => {
      const key = list === 'allowed' ? 'allowed_providers' : 'blocked_providers';
      const current = p[key];
      const updated = current.includes(providerId)
        ? current.filter((id) => id !== providerId)
        : [...current, providerId];
      return { ...p, [key]: updated };
    });
  }, []);

  // Routing rules
  const addRoutingRule = useCallback(() => {
    const rule: RoutingRule = {
      name: `Rule ${policy.routing_rules.length + 1}`,
      task_complexity: 'simple',
      provider: 'claude_code',
      model: null,
      enabled: true,
    };
    setPolicy((p) => ({ ...p, routing_rules: [...p.routing_rules, rule] }));
  }, [policy.routing_rules.length]);

  const updateRoutingRule = useCallback((index: number, updates: Partial<RoutingRule>) => {
    setPolicy((p) => ({
      ...p,
      routing_rules: p.routing_rules.map((r, i) =>
        i === index ? { ...r, ...updates } : r
      ),
    }));
  }, []);

  const removeRoutingRule = useCallback((index: number) => {
    setPolicy((p) => ({
      ...p,
      routing_rules: p.routing_rules.filter((_, i) => i !== index),
    }));
  }, []);

  // Compliance rules
  const addComplianceRule = useCallback(() => {
    const rule: ComplianceRule = {
      name: `Compliance ${policy.compliance_rules.length + 1}`,
      workflow_tags: [],
      allowed_providers: ['claude_code'],
      enabled: true,
    };
    setPolicy((p) => ({ ...p, compliance_rules: [...p.compliance_rules, rule] }));
  }, [policy.compliance_rules.length]);

  const updateComplianceRule = useCallback((index: number, updates: Partial<ComplianceRule>) => {
    setPolicy((p) => ({
      ...p,
      compliance_rules: p.compliance_rules.map((r, i) =>
        i === index ? { ...r, ...updates } : r
      ),
    }));
  }, []);

  const removeComplianceRule = useCallback((index: number) => {
    setPolicy((p) => ({
      ...p,
      compliance_rules: p.compliance_rules.filter((_, i) => i !== index),
    }));
  }, []);

  if (!loaded) {
    return (
      <ContentBox>
        <ContentHeader
          icon={<Network className="w-5 h-5 text-violet-400" />}
          iconColor="violet"
          title="BYOM"
          subtitle="Loading..."
        />
      </ContentBox>
    );
  }

  return (
    <ContentBox>
      <ContentHeader
        icon={<Network className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title="Bring Your Own Model"
        subtitle="Configure approved providers, compliance restrictions, and cost-optimized routing"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              className="px-3 py-1.5 text-sm rounded-xl border border-primary/10 text-muted-foreground hover:bg-secondary/50 transition-colors"
            >
              Reset
            </button>
            <button
              onClick={handleSave}
              className="px-3 py-1.5 text-sm rounded-xl bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors"
            >
              Save Policy
            </button>
          </div>
        }
      />

      <ContentBody centered>
        <div className="space-y-4">
          {saved && (
            <p className="text-sm text-emerald-400 text-center">Policy saved</p>
          )}

          {/* Enable toggle */}
          <div className="rounded-xl border border-primary/10 bg-card-bg p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-foreground">BYOM Policy Enforcement</h3>
                <p className="text-sm text-muted-foreground/70 mt-0.5">
                  When enabled, provider selection follows your configured rules
                </p>
              </div>
              <button onClick={toggleEnabled} className="text-foreground">
                {policy.enabled
                  ? <ToggleRight className="w-8 h-8 text-emerald-400" />
                  : <ToggleLeft className="w-8 h-8 text-muted-foreground/50" />
                }
              </button>
            </div>
          </div>

          {/* Section tabs */}
          <div className="flex gap-1 p-1 rounded-lg bg-secondary/30 border border-primary/10">
            {([
              { id: 'policy' as const, label: 'Providers', icon: Shield },
              { id: 'routing' as const, label: 'Cost Routing', icon: Route },
              { id: 'compliance' as const, label: 'Compliance', icon: Shield },
              { id: 'audit' as const, label: 'Audit Log', icon: ScrollText },
            ]).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveSection(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-xl transition-colors ${
                  activeSection === tab.id
                    ? 'bg-primary/15 text-foreground border border-primary/20'
                    : 'text-muted-foreground hover:text-foreground hover:bg-primary/5'
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Provider section */}
          {activeSection === 'policy' && (
            <div className="space-y-4">
              {/* Allowed providers */}
              <div className="rounded-xl border border-primary/10 bg-card-bg p-4 space-y-3">
                <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
                  Allowed Providers
                </h2>
                <p className="text-sm text-muted-foreground/60">
                  Select which providers your organization approves. Leave empty to allow all.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {PROVIDER_OPTIONS.map((prov) => {
                    const isAllowed = policy.allowed_providers.includes(prov.id);
                    return (
                      <button
                        key={prov.id}
                        onClick={() => toggleProvider(prov.id, 'allowed')}
                        className={`p-3 rounded-lg border text-left text-sm transition-all ${
                          isAllowed
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-foreground'
                            : 'border-primary/10 text-muted-foreground hover:border-primary/20'
                        }`}
                      >
                        {prov.label}
                        {isAllowed && <span className="ml-2 text-emerald-400">Allowed</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Blocked providers */}
              <div className="rounded-xl border border-primary/10 bg-card-bg p-4 space-y-3">
                <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
                  Blocked Providers
                </h2>
                <p className="text-sm text-muted-foreground/60">
                  Explicitly block specific providers. Takes precedence over allowed list.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {PROVIDER_OPTIONS.map((prov) => {
                    const isBlocked = policy.blocked_providers.includes(prov.id);
                    return (
                      <button
                        key={prov.id}
                        onClick={() => toggleProvider(prov.id, 'blocked')}
                        className={`p-3 rounded-lg border text-left text-sm transition-all ${
                          isBlocked
                            ? 'border-red-500/30 bg-red-500/10 text-foreground'
                            : 'border-primary/10 text-muted-foreground hover:border-primary/20'
                        }`}
                      >
                        {prov.label}
                        {isBlocked && <span className="ml-2 text-red-400">Blocked</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Usage stats summary */}
              {usageStats.length > 0 && (
                <div className="rounded-xl border border-primary/10 bg-card-bg p-4 space-y-3">
                  <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
                    Provider Usage
                  </h2>
                  <div className="grid grid-cols-2 gap-3">
                    {usageStats.map((stat) => (
                      <div key={stat.engine_kind} className="p-3 rounded-lg border border-primary/10 bg-secondary/20">
                        <div className="text-sm font-medium text-foreground">
                          {ENGINE_LABELS[stat.engine_kind] || stat.engine_kind}
                        </div>
                        <div className="text-sm text-muted-foreground/70 mt-1 space-y-0.5">
                          <div>{stat.execution_count} executions</div>
                          <div>${stat.total_cost_usd.toFixed(4)} total cost</div>
                          <div>{Math.round(stat.avg_duration_ms / 1000)}s avg duration</div>
                          {stat.failover_count > 0 && (
                            <div className="text-amber-400">{stat.failover_count} failovers</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Routing rules section */}
          {activeSection === 'routing' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-primary/10 bg-card-bg p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
                      Cost-Optimized Routing Rules
                    </h2>
                    <p className="text-sm text-muted-foreground/60 mt-1">
                      Route tasks to specific providers/models based on complexity level
                    </p>
                  </div>
                  <button
                    onClick={addRoutingRule}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-xl border border-primary/20 text-primary hover:bg-primary/10 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Rule
                  </button>
                </div>

                {policy.routing_rules.length === 0 ? (
                  <p className="text-sm text-muted-foreground/50 text-center py-6">
                    No routing rules configured. Add rules to optimize cost by task complexity.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {policy.routing_rules.map((rule, idx) => (
                      <div key={idx} className="p-4 rounded-lg border border-primary/10 bg-secondary/20 space-y-3">
                        <div className="flex items-center justify-between">
                          <input
                            value={rule.name}
                            onChange={(e) => updateRoutingRule(idx, { name: e.target.value })}
                            className="text-sm font-medium bg-transparent border-none outline-none text-foreground"
                            placeholder="Rule name"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => updateRoutingRule(idx, { enabled: !rule.enabled })}
                              className="text-sm"
                            >
                              {rule.enabled
                                ? <ToggleRight className="w-5 h-5 text-emerald-400" />
                                : <ToggleLeft className="w-5 h-5 text-muted-foreground/50" />
                              }
                            </button>
                            <button
                              onClick={() => removeRoutingRule(idx)}
                              className="text-muted-foreground/50 hover:text-red-400 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <label className="text-xs text-muted-foreground/60 mb-1 block">Complexity</label>
                            <select
                              value={rule.task_complexity}
                              onChange={(e) => updateRoutingRule(idx, { task_complexity: e.target.value as TaskComplexity })}
                              className="w-full text-sm p-2 rounded-lg border border-primary/15 bg-secondary/40 text-foreground outline-none"
                            >
                              {COMPLEXITY_OPTIONS.map((c) => (
                                <option key={c.id} value={c.id}>{c.label}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground/60 mb-1 block">Provider</label>
                            <select
                              value={rule.provider}
                              onChange={(e) => updateRoutingRule(idx, { provider: e.target.value })}
                              className="w-full text-sm p-2 rounded-lg border border-primary/15 bg-secondary/40 text-foreground outline-none"
                            >
                              {PROVIDER_OPTIONS.map((p) => (
                                <option key={p.id} value={p.id}>{p.label}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground/60 mb-1 block">Model (optional)</label>
                            <input
                              value={rule.model || ''}
                              onChange={(e) => updateRoutingRule(idx, { model: e.target.value || null })}
                              placeholder="e.g. claude-haiku-4-5-20251001"
                              className="w-full text-sm p-2 rounded-lg border border-primary/15 bg-secondary/40 text-foreground outline-none placeholder:text-muted-foreground/30"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Compliance rules section */}
          {activeSection === 'compliance' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-primary/10 bg-card-bg p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
                      Compliance-Driven Restrictions
                    </h2>
                    <p className="text-sm text-muted-foreground/60 mt-1">
                      Restrict providers for specific workflow types (e.g., HIPAA, SOC2)
                    </p>
                  </div>
                  <button
                    onClick={addComplianceRule}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-xl border border-primary/20 text-primary hover:bg-primary/10 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Rule
                  </button>
                </div>

                {policy.compliance_rules.length === 0 ? (
                  <p className="text-sm text-muted-foreground/50 text-center py-6">
                    No compliance rules configured. Add rules to restrict providers for sensitive workflows.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {policy.compliance_rules.map((rule, idx) => (
                      <div key={idx} className="p-4 rounded-lg border border-primary/10 bg-secondary/20 space-y-3">
                        <div className="flex items-center justify-between">
                          <input
                            value={rule.name}
                            onChange={(e) => updateComplianceRule(idx, { name: e.target.value })}
                            className="text-sm font-medium bg-transparent border-none outline-none text-foreground"
                            placeholder="Rule name (e.g., HIPAA)"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => updateComplianceRule(idx, { enabled: !rule.enabled })}
                              className="text-sm"
                            >
                              {rule.enabled
                                ? <ToggleRight className="w-5 h-5 text-emerald-400" />
                                : <ToggleLeft className="w-5 h-5 text-muted-foreground/50" />
                              }
                            </button>
                            <button
                              onClick={() => removeComplianceRule(idx)}
                              className="text-muted-foreground/50 hover:text-red-400 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs text-muted-foreground/60 mb-1 block">
                              Workflow Tags (comma-separated)
                            </label>
                            <input
                              value={rule.workflow_tags.join(', ')}
                              onChange={(e) =>
                                updateComplianceRule(idx, {
                                  workflow_tags: e.target.value
                                    .split(',')
                                    .map((t) => t.trim())
                                    .filter(Boolean),
                                })
                              }
                              placeholder="hipaa, healthcare, pii"
                              className="w-full text-sm p-2 rounded-lg border border-primary/15 bg-secondary/40 text-foreground outline-none placeholder:text-muted-foreground/30"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground/60 mb-1 block">
                              Allowed Providers
                            </label>
                            <div className="flex flex-wrap gap-1.5">
                              {PROVIDER_OPTIONS.map((prov) => {
                                const isSelected = rule.allowed_providers.includes(prov.id);
                                return (
                                  <button
                                    key={prov.id}
                                    onClick={() => {
                                      const updated = isSelected
                                        ? rule.allowed_providers.filter((id) => id !== prov.id)
                                        : [...rule.allowed_providers, prov.id];
                                      updateComplianceRule(idx, { allowed_providers: updated });
                                    }}
                                    className={`px-2 py-1 text-xs rounded-lg border transition-colors ${
                                      isSelected
                                        ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400'
                                        : 'border-primary/10 text-muted-foreground/50 hover:text-foreground'
                                    }`}
                                  >
                                    {prov.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Audit log section */}
          {activeSection === 'audit' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-primary/10 bg-card-bg p-4 space-y-3">
                <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
                  Provider Audit Log
                </h2>
                <p className="text-sm text-muted-foreground/60">
                  Compliance trail showing which provider handled each execution
                </p>

                {auditLog.length === 0 ? (
                  <p className="text-sm text-muted-foreground/50 text-center py-6">
                    No audit entries yet. Entries are recorded automatically for every execution.
                  </p>
                ) : (
                  <div className="border border-primary/10 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-primary/10 bg-secondary/30">
                          <th className="text-left p-2.5 text-muted-foreground/70 font-medium">Provider</th>
                          <th className="text-left p-2.5 text-muted-foreground/70 font-medium">Model</th>
                          <th className="text-left p-2.5 text-muted-foreground/70 font-medium">Persona</th>
                          <th className="text-left p-2.5 text-muted-foreground/70 font-medium">Status</th>
                          <th className="text-right p-2.5 text-muted-foreground/70 font-medium">Cost</th>
                          <th className="text-right p-2.5 text-muted-foreground/70 font-medium">Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditLog.map((entry) => (
                          <tr key={entry.id} className="border-b border-primary/5 hover:bg-secondary/20">
                            <td className="p-2.5">
                              <div className="flex items-center gap-1.5">
                                <span className="text-foreground">
                                  {ENGINE_LABELS[entry.engine_kind] || entry.engine_kind}
                                </span>
                                {entry.was_failover && (
                                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25">
                                    failover
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-2.5 text-muted-foreground/70">
                              {entry.model_used || '-'}
                            </td>
                            <td className="p-2.5 text-muted-foreground/70">
                              {entry.persona_name}
                            </td>
                            <td className="p-2.5">
                              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                                entry.status === 'completed'
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : entry.status === 'failed'
                                    ? 'bg-red-500/15 text-red-400'
                                    : 'bg-secondary/50 text-muted-foreground/70'
                              }`}>
                                {entry.status}
                              </span>
                            </td>
                            <td className="p-2.5 text-right text-muted-foreground/70">
                              {entry.cost_usd != null ? `$${entry.cost_usd.toFixed(4)}` : '-'}
                            </td>
                            <td className="p-2.5 text-right text-muted-foreground/70">
                              {entry.duration_ms != null ? `${Math.round(entry.duration_ms / 1000)}s` : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </ContentBody>
    </ContentBox>
  );
}
