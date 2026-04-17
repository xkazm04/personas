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
import { useTranslation } from '@/i18n/useTranslation';

const SECTION_TABS: { id: ByomSection; labelKey: 'tab_providers' | 'tab_keys' | 'tab_routing' | 'tab_compliance' | 'tab_audit'; icon: typeof Shield }[] = [
  { id: 'policy', labelKey: 'tab_providers', icon: Shield },
  { id: 'keys', labelKey: 'tab_keys', icon: KeyRound },
  { id: 'routing', labelKey: 'tab_routing', icon: Route },
  { id: 'compliance', labelKey: 'tab_compliance', icon: Shield },
  { id: 'audit', labelKey: 'tab_audit', icon: ScrollText },
];

export default function ByomSettings() {
  const bm = useByomSettings();
  const { t } = useTranslation();
  const s = t.settings.byom;

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
          subtitle={s.loading}
        />
      </ContentBox>
    );
  }

  return (
    <ContentBox>
      <ContentHeader
        icon={<Network className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={s.title}
        subtitle={s.subtitle}
        actions={
          <div className="flex items-center gap-2">
            {bm.isDirty && (
              <span className="typo-caption text-amber-400/80 mr-1">{s.unsaved_changes}</span>
            )}
            <button
              onClick={bm.handleReset}
              className="px-3 py-1.5 typo-body rounded-modal border border-primary/10 text-foreground hover:bg-secondary/50 transition-colors"
            >
              {s.reset}
            </button>
            <button
              onClick={bm.handleSave}
              disabled={bm.hasBlockingErrors}
              title={bm.hasBlockingErrors ? s.fix_errors : undefined}
              className={`px-3 py-1.5 typo-body rounded-modal border transition-colors ${
                bm.hasBlockingErrors
                  ? 'bg-red-500/15 text-red-400/60 border-red-500/30 cursor-not-allowed'
                  : bm.isDirty
                  ? 'bg-primary/25 text-primary border-primary/40 hover:bg-primary/35'
                  : 'bg-primary/20 text-primary border-primary/30 hover:bg-primary/30'
              }`}
            >
              {s.save_policy}
            </button>
          </div>
        }
      />

      <ContentBody centered>
        <div className="space-y-4">
          {/* Degraded-policy warning when stored JSON is corrupt */}
          {bm.corruptPolicyError && (
            <div className="rounded-modal border border-red-500/30 bg-red-500/10 p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <h3 className="typo-body font-medium text-red-300">{s.policy_corrupted}</h3>
                <p className="typo-body text-red-300/80 mt-1">
                  {s.policy_corrupted_desc}
                </p>
                <p className="typo-caption text-red-400/60 mt-2 break-all">{bm.corruptPolicyError}</p>
              </div>
              <button
                onClick={bm.handleReset}
                className="shrink-0 px-3 py-1.5 typo-body rounded-modal bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 transition-colors"
              >
                {s.reset_policy}
              </button>
            </div>
          )}

          {/* Enable toggle */}
          <div className="rounded-modal border border-primary/10 bg-card-bg p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="typo-body font-medium text-foreground">{s.policy_enforcement}</h3>
                <p className="typo-body text-foreground mt-0.5">
                  {s.policy_enforcement_desc}
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
          <div className="flex gap-1 p-1 rounded-card bg-secondary/30 border border-primary/10">
            {SECTION_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => bm.setActiveSection(tab.id)}
                className={`relative flex-1 flex items-center justify-center gap-1.5 px-3 py-2 typo-body rounded-modal transition-colors ${
                  bm.activeSection === tab.id
                    ? 'text-foreground'
                    : 'text-foreground hover:text-foreground hover:bg-primary/5'
                }`}
              >
                {bm.activeSection === tab.id && (
                  <motion.div
                    layoutId="byom-tab-indicator"
                    className="absolute inset-0 rounded-modal bg-primary/15 border border-primary/20"
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  <tab.icon className="w-3.5 h-3.5" />
                  {s[tab.labelKey]}
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
