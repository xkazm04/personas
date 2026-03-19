import { silentCatch } from "@/lib/silentCatch";
import { useEffect, useState, useCallback } from 'react';
import {
  getByomPolicy,
  setByomPolicy,
  deleteByomPolicy,
  listProviderAuditLog,
  getProviderUsageStats,
} from '@/api/system/byom';
import type {
  ByomPolicy,
  RoutingRule,
  ComplianceRule,
  ProviderAuditEntry,
  ProviderUsageStats,
} from '@/api/system/byom';

function defaultPolicy(): ByomPolicy {
  return {
    enabled: false,
    allowed_providers: [],
    blocked_providers: [],
    routing_rules: [],
    compliance_rules: [],
  };
}

export type ByomSection = 'policy' | 'routing' | 'compliance' | 'audit';

export function useByomSettings() {
  const [policy, setPolicy] = useState<ByomPolicy>(defaultPolicy());
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [auditLog, setAuditLog] = useState<ProviderAuditEntry[]>([]);
  const [usageStats, setUsageStats] = useState<ProviderUsageStats[]>([]);
  const [activeSection, setActiveSection] = useState<ByomSection>('policy');

  useEffect(() => {
    getByomPolicy().then((p) => {
      if (p) setPolicy(p);
      setLoaded(true);
    }).catch(() => setLoaded(true));
    listProviderAuditLog(50).then(setAuditLog).catch(silentCatch("useByomSettings:listAuditLog"));
    getProviderUsageStats().then(setUsageStats).catch(silentCatch("useByomSettings:getUsageStats"));
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

  return {
    policy,
    loaded,
    saved,
    auditLog,
    usageStats,
    activeSection,
    setActiveSection,
    handleSave,
    handleReset,
    toggleEnabled,
    toggleProvider,
    addRoutingRule,
    updateRoutingRule,
    removeRoutingRule,
    addComplianceRule,
    updateComplianceRule,
    removeComplianceRule,
  };
}
