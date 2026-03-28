import { silentCatch } from "@/lib/silentCatch";
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useToastStore } from '@/stores/toastStore';
import {
  getByomPolicy,
  setByomPolicy,
  deleteByomPolicy,
  listProviderAuditLog,
  getProviderUsageStats,
  getProviderUsageTimeseries,
} from '@/api/system/byom';
import type {
  ByomPolicy,
  RoutingRule,
  ComplianceRule,
  ProviderAuditEntry,
  ProviderUsageStats,
  ProviderUsageTimeseries,
} from '@/api/system/byom';
import { validateByomPolicy, type PolicyWarning } from './byomHelpers';

/** Shallow-equal comparison for ByomPolicy objects. */
function policyEqual(a: ByomPolicy, b: ByomPolicy): boolean {
  if (a.enabled !== b.enabled) return false;
  if (!arraysEqual(a.allowed_providers, b.allowed_providers)) return false;
  if (!arraysEqual(a.blocked_providers, b.blocked_providers)) return false;
  if (a.routing_rules.length !== b.routing_rules.length) return false;
  if (a.compliance_rules.length !== b.compliance_rules.length) return false;
  for (let i = 0; i < a.routing_rules.length; i++) {
    const ra = a.routing_rules[i]!, rb = b.routing_rules[i]!;
    if (ra.name !== rb.name || ra.task_complexity !== rb.task_complexity ||
        ra.provider !== rb.provider || ra.model !== rb.model || ra.enabled !== rb.enabled) return false;
  }
  for (let i = 0; i < a.compliance_rules.length; i++) {
    const ca = a.compliance_rules[i]!, cb = b.compliance_rules[i]!;
    if (ca.name !== cb.name || ca.enabled !== cb.enabled ||
        !arraysEqual(ca.workflow_tags, cb.workflow_tags) ||
        !arraysEqual(ca.allowed_providers, cb.allowed_providers)) return false;
  }
  return true;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return false; }
  return true;
}

function defaultPolicy(): ByomPolicy {
  return {
    enabled: false,
    allowed_providers: [],
    blocked_providers: [],
    routing_rules: [],
    compliance_rules: [],
  };
}

export type ByomSection = 'policy' | 'keys' | 'routing' | 'compliance' | 'audit';

export function useByomSettings() {
  const [policy, setPolicy] = useState<ByomPolicy>(defaultPolicy());
  const [loaded, setLoaded] = useState(false);
  const [auditLog, setAuditLog] = useState<ProviderAuditEntry[]>([]);
  const [usageStats, setUsageStats] = useState<ProviderUsageStats[]>([]);
  const [usageTimeseries, setUsageTimeseries] = useState<ProviderUsageTimeseries[]>([]);
  const [activeSection, setActiveSection] = useState<ByomSection>('policy');

  // --- Dirty-state tracking ---
  const savedSnapshotRef = useRef<ByomPolicy>(defaultPolicy());
  const isDirty = useMemo(() => !policyEqual(policy, savedSnapshotRef.current), [policy]);

  // Track which tab-specific data has already been fetched to avoid re-fetching on tab switches
  const fetchedTabs = useRef<Set<ByomSection>>(new Set());

  // Always load core policy on mount
  useEffect(() => {
    getByomPolicy().then((p) => {
      const initial = p ?? defaultPolicy();
      setPolicy(initial);
      savedSnapshotRef.current = initial;
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  // Lazy-load tab-specific data only when the user navigates to that tab
  useEffect(() => {
    if (activeSection === 'policy' && !fetchedTabs.current.has('policy')) {
      fetchedTabs.current.add('policy');
      getProviderUsageStats().then(setUsageStats).catch(silentCatch("useByomSettings:getUsageStats"));
      getProviderUsageTimeseries(30).then(setUsageTimeseries).catch(silentCatch("useByomSettings:getTimeseries"));
    }
    if (activeSection === 'audit' && !fetchedTabs.current.has('audit')) {
      fetchedTabs.current.add('audit');
      listProviderAuditLog(50).then(setAuditLog).catch(silentCatch("useByomSettings:listAuditLog"));
    }
  }, [activeSection]);

  const handleSave = useCallback(async () => {
    const errors = validateByomPolicy(policy).filter((w) => w.severity === 'error');
    if (errors.length > 0) {
      useToastStore.getState().addToast(
        `Cannot save: ${errors.length} blocking error${errors.length > 1 ? 's' : ''} in policy`,
        'error',
      );
      return;
    }
    await setByomPolicy(policy);
    savedSnapshotRef.current = policy;
    useToastStore.getState().addToast('Policy saved', 'success');
  }, [policy]);

  const handleReset = useCallback(async () => {
    await deleteByomPolicy();
    const reset = defaultPolicy();
    setPolicy(reset);
    savedSnapshotRef.current = reset;
    useToastStore.getState().addToast('Policy reset to defaults', 'success');
  }, []);

  const discardChanges = useCallback(() => {
    setPolicy(savedSnapshotRef.current);
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
      routing_rules: p.routing_rules.map((r, i) => (i === index ? { ...r, ...updates } : r)),
    }));
  }, []);

  const removeRoutingRule = useCallback((index: number) => {
    setPolicy((p) => ({
      ...p,
      routing_rules: p.routing_rules.filter((_, i) => i !== index),
    }));
  }, []);

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
      compliance_rules: p.compliance_rules.map((r, i) => (i === index ? { ...r, ...updates } : r)),
    }));
  }, []);

  const removeComplianceRule = useCallback((index: number) => {
    setPolicy((p) => ({
      ...p,
      compliance_rules: p.compliance_rules.filter((_, i) => i !== index),
    }));
  }, []);

  const policyWarnings = useMemo(() => validateByomPolicy(policy), [policy]);
  const hasBlockingErrors = useMemo(() => policyWarnings.some((w) => w.severity === 'error'), [policyWarnings]);

  const routingWarnings = useMemo(() => {
    const map = new Map<number, PolicyWarning[]>();
    for (const w of policyWarnings) {
      if (w.ruleType === 'routing') {
        const existing = map.get(w.ruleIndex) ?? [];
        existing.push(w);
        map.set(w.ruleIndex, existing);
      }
    }
    return map;
  }, [policyWarnings]);

  const complianceWarnings = useMemo(() => {
    const map = new Map<number, PolicyWarning[]>();
    for (const w of policyWarnings) {
      if (w.ruleType === 'compliance') {
        const existing = map.get(w.ruleIndex) ?? [];
        existing.push(w);
        map.set(w.ruleIndex, existing);
      }
    }
    return map;
  }, [policyWarnings]);

  return {
    policy,
    loaded,
    isDirty,
    auditLog,
    usageStats,
    usageTimeseries,
    activeSection,
    setActiveSection,
    handleSave,
    handleReset,
    discardChanges,
    toggleEnabled,
    toggleProvider,
    addRoutingRule,
    updateRoutingRule,
    removeRoutingRule,
    addComplianceRule,
    updateComplianceRule,
    removeComplianceRule,
    policyWarnings,
    hasBlockingErrors,
    routingWarnings,
    complianceWarnings,
  };
}
