import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Network, Shield, Route, ScrollText, KeyRound, AlertTriangle } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useByomSettings } from '../libs/useByomSettings';
import type { ByomSection } from '../libs/useByomSettings';
import { ByomProviderList } from './ByomProviderList';
import { ByomRoutingRules } from './ByomRoutingRules';
import { ByomComplianceRules } from './ByomComplianceRules';
import { ByomAuditLog } from './ByomAuditLog';
import { ByomApiKeyManager } from './ByomApiKeyManager';
import { useUnsavedGuard } from '@/hooks/utility/interaction/useUnsavedGuard';
import { UnsavedChangesModal } from '@/features/shared/components/overlays/UnsavedChangesModal';

const SECTION_TABS: { id: ByomSection; label: string; icon: typeof Shield }[] = [
  { id: 'policy', label: 'Providers', icon: Shield },
  { id: 'keys', label: 'API Keys', icon: KeyRound },
  { id: 'routing', label: 'Cost Routing', icon: Route },
  { id: 'compliance', label: 'Compliance', icon: Shield },
  { id: 'audit', label: 'Audit Log', icon: ScrollText },
];

export default function ByomSettings() {
  const bm = useByomSettings();

  const guardCallbacks = useMemo(() => ({
    onSave: () => bm.handleSave(),
    onDiscard: () => bm.discardChanges(),
  }), [bm.handleSave, bm.discardChanges]);

  const guard = useUnsavedGuard(bm.isDirty, guardCallbacks, { guardSettingsTab: true });

  if (!bm.loaded) {
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
            {bm.isDirty && (
              <span className="text-xs text-amber-400/80 mr-1">Unsaved changes</span>
            )}
            <button
              onClick={bm.handleReset}
              className="px-3 py-1.5 text-sm rounded-xl border border-primary/10 text-muted-foreground hover:bg-secondary/50 transition-colors"
            >
              Reset
            </button>
            <button
              onClick={bm.handleSave}
              disabled={bm.hasBlockingErrors}
              title={bm.hasBlockingErrors ? 'Fix all errors before saving' : undefined}
              className={`px-3 py-1.5 text-sm rounded-xl border transition-colors ${
                bm.hasBlockingErrors
                  ? 'bg-red-500/15 text-red-400/60 border-red-500/30 cursor-not-allowed'
                  : bm.isDirty
                  ? 'bg-primary/25 text-primary border-primary/40 hover:bg-primary/35'
                  : 'bg-primary/20 text-primary border-primary/30 hover:bg-primary/30'
              }`}
            >
              Save Policy
            </button>
          </div>
        }
      />

      <ContentBody centered>
        <div className="space-y-4">
          {/* Degraded-policy warning when stored JSON is corrupt */}
          {bm.corruptPolicyError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium text-red-300">BYOM Policy Corrupted</h3>
                <p className="text-sm text-red-300/80 mt-1">
                  The stored policy JSON could not be parsed. All provider restrictions are
                  currently inactive and executions are blocked. Reset the policy to restore
                  normal operation.
                </p>
                <p className="text-xs text-red-400/60 mt-2 break-all">{bm.corruptPolicyError}</p>
              </div>
              <button
                onClick={bm.handleReset}
                className="shrink-0 px-3 py-1.5 text-sm rounded-xl bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 transition-colors"
              >
                Reset Policy
              </button>
            </div>
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
              <AccessibleToggle
                checked={bm.policy.enabled}
                onChange={bm.toggleEnabled}
                label="BYOM policy enforcement"
              />
            </div>
          </div>

          {/* Section tabs */}
          <div className="flex gap-1 p-1 rounded-lg bg-secondary/30 border border-primary/10">
            {SECTION_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => bm.setActiveSection(tab.id)}
                className={`relative flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-xl transition-colors ${
                  bm.activeSection === tab.id
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-primary/5'
                }`}
              >
                {bm.activeSection === tab.id && (
                  <motion.div
                    layoutId="byom-tab-indicator"
                    className="absolute inset-0 rounded-xl bg-primary/15 border border-primary/20"
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  <tab.icon className="w-3.5 h-3.5" />
                  {tab.label}
                </span>
              </button>
            ))}
          </div>

          {bm.activeSection === 'policy' && (
            <ByomProviderList
              policy={bm.policy}
              usageStats={bm.usageStats}
              usageTimeseries={bm.usageTimeseries}
              toggleProvider={bm.toggleProvider}
            />
          )}

          {bm.activeSection === 'keys' && (
            <ByomApiKeyManager />
          )}

          {bm.activeSection === 'routing' && (
            <ByomRoutingRules
              rules={bm.policy.routing_rules}
              warnings={bm.routingWarnings}
              onAdd={bm.addRoutingRule}
              onUpdate={bm.updateRoutingRule}
              onRemove={bm.removeRoutingRule}
            />
          )}

          {bm.activeSection === 'compliance' && (
            <ByomComplianceRules
              rules={bm.policy.compliance_rules}
              warnings={bm.complianceWarnings}
              onAdd={bm.addComplianceRule}
              onUpdate={bm.updateComplianceRule}
              onRemove={bm.removeComplianceRule}
            />
          )}

          {bm.activeSection === 'audit' && (
            <ByomAuditLog auditLog={bm.auditLog} />
          )}
        </div>
      </ContentBody>

      <UnsavedChangesModal
        isOpen={guard.isOpen}
        onAction={guard.resolve}
        changedSections={['BYOM Policy']}
      />
    </ContentBox>
  );
}
