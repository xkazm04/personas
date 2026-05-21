import { silentCatch } from "@/lib/silentCatch";
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import * as Sentry from "@sentry/react";
import { useToastStore } from '@/stores/toastStore';
import { errMsg } from '@/stores/storeTypes';
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

function groupByRuleIndex(
  warnings: PolicyWarning[],
  kind: 'routing' | 'compliance',
): Map<number, PolicyWarning[]> {
  const map = new Map<number, PolicyWarning[]>();
  for (const w of warnings) {
    if (w.ruleType !== kind) continue;
    const existing = map.get(w.ruleIndex) ?? [];
    existing.push(w);
    map.set(w.ruleIndex, existing);
  }
  return map;
}

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
  /** Non-null when the stored policy JSON is corrupt and could not be parsed. */
  const [corruptPolicyError, setCorruptPolicyError] = useState<string | null>(null);
  const [auditLog, setAuditLog] = useState<ProviderAuditEntry[]>([]);
  const [usageStats, setUsageStats] = useState<ProviderUsageStats[]>([]);
  const [usageTimeseries, setUsageTimeseries] = useState<ProviderUsageTimeseries[]>([]);
  const [activeSection, setActiveSection] = useState<ByomSection>('policy');

  // --- Dirty-state tracking ---
  const savedSnapshotRef = useRef<ByomPolicy>(defaultPolicy());
  const [, setSaveGeneration] = useState(0);
  const isDirty = useMemo(() => !policyEqual(policy, savedSnapshotRef.current), [policy]);

  // Guards handleSave against concurrent invocations (rapid double-clicks).
  const saveInFlightRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);

  // Track which tab-specific data has already been fetched to avoid re-fetching on tab switches
  const fetchedTabs = useRef<Set<ByomSection>>(new Set());

  // Always load core policy on mount
  useEffect(() => {
    getByomPolicy().then((p) => {
      const initial = p ?? defaultPolicy();
      setPolicy(initial);
      savedSnapshotRef.current = structuredClone(initial);
      setSaveGeneration((g) => g + 1);
      setCorruptPolicyError(null);
      setLoaded(true);
    }).catch((err: unknown) => {
      // The backend returns a validation error when the stored JSON is corrupt.
      // Surface this to the user instead of silently falling back to open-access.
      const msg = err && typeof err === 'object' && 'error' in err
        ? String((err as { error: string }).error)
        : 'BYOM policy could not be loaded — the stored JSON may be corrupt.';
      setCorruptPolicyError(msg);
      setLoaded(true);
    });
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
    if (saveInFlightRef.current) return;
    // Refuse to save when the initial load failed (corrupt JSON OR a transient
    // IPC error). Without this gate, the in-memory `policy` is `defaultPolicy()`
    // — empty allow-lists, no routing/compliance rules, enabled:false — and
    // saving it would silently overwrite the on-disk policy. BYOM controls
    // which providers see persona secrets, so a policy wipe is a security
    // regression. Force the user to reload the panel (which retries the load)
    // before any write is permitted.
    if (!loaded || corruptPolicyError !== null) {
      useToastStore.getState().addToast(
        'Cannot save: the stored BYOM policy could not be loaded. Reload the panel before saving to avoid overwriting the on-disk policy with an empty default.',
        'error',
      );
      return;
    }
    const errors = validateByomPolicy(policy).filter((w) => w.severity === 'error');
    if (errors.length > 0) {
      useToastStore.getState().addToast(
        `Cannot save: ${errors.length} blocking error${errors.length > 1 ? 's' : ''} in policy`,
        'error',
      );
      return;
    }
    saveInFlightRef.current = true;
    setIsSaving(true);
    const snapshot = structuredClone(policy);
    try {
      await setByomPolicy(snapshot);
      // Re-snapshot from the value we actually persisted to avoid dirty-state drift.
      savedSnapshotRef.current = snapshot;
      setSaveGeneration((g) => g + 1);
      useToastStore.getState().addToast('Policy saved', 'success');
    } catch (e) {
      Sentry.captureException(e);
      useToastStore.getState().addToast(errMsg(e, 'Failed to save policy'), 'error');
    } finally {
      saveInFlightRef.current = false;
      setIsSaving(false);
    }
  }, [policy, loaded, corruptPolicyError]);

  const handleReset = useCallback(async () => {
    try {
      await deleteByomPolicy();
      const reset = defaultPolicy();
      setPolicy(reset);
      savedSnapshotRef.current = structuredClone(reset);
      setSaveGeneration((g) => g + 1);
      setCorruptPolicyError(null);
      useToastStore.getState().addToast('Policy reset to defaults', 'success');
    } catch (e) {
      Sentry.captureException(e);
      useToastStore.getState().addToast(errMsg(e, 'Failed to reset policy'), 'error');
    }
  }, []);

  const discardChanges = useCallback(() => {
    setPolicy(structuredClone(savedSnapshotRef.current));
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

  const routingWarnings = useMemo(() => groupByRuleIndex(policyWarnings, 'routing'), [policyWarnings]);
  const complianceWarnings = useMemo(() => groupByRuleIndex(policyWarnings, 'compliance'), [policyWarnings]);
  const topLevelWarnings = useMemo(() => policyWarnings.filter((w) => w.ruleType === 'top_level'), [policyWarnings]);

  return {
    policy,
    loaded,
    corruptPolicyError,
    isDirty,
    isSaving,
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
    topLevelWarnings,
  };
}
