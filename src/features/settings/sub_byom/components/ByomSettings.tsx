import { Network, Shield, Route, ScrollText, ToggleLeft, ToggleRight } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useByomSettings } from '../libs/useByomSettings';
import type { ByomSection } from '../libs/useByomSettings';
import { ByomProviderList } from './ByomProviderList';
import { ByomRoutingRules } from './ByomRoutingRules';
import { ByomComplianceRules } from './ByomComplianceRules';
import { ByomAuditLog } from './ByomAuditLog';

const SECTION_TABS: { id: ByomSection; label: string; icon: typeof Shield }[] = [
  { id: 'policy', label: 'Providers', icon: Shield },
  { id: 'routing', label: 'Cost Routing', icon: Route },
  { id: 'compliance', label: 'Compliance', icon: Shield },
  { id: 'audit', label: 'Audit Log', icon: ScrollText },
];

export default function ByomSettings() {
  const bm = useByomSettings();

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
            <button
              onClick={bm.handleReset}
              className="px-3 py-1.5 text-sm rounded-xl border border-primary/10 text-muted-foreground hover:bg-secondary/50 transition-colors"
            >
              Reset
            </button>
            <button
              onClick={bm.handleSave}
              className="px-3 py-1.5 text-sm rounded-xl bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors"
            >
              Save Policy
            </button>
          </div>
        }
      />

      <ContentBody centered>
        <div className="space-y-4">
          {bm.saved && (
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
              <button onClick={bm.toggleEnabled} className="text-foreground">
                {bm.policy.enabled
                  ? <ToggleRight className="w-8 h-8 text-emerald-400" />
                  : <ToggleLeft className="w-8 h-8 text-muted-foreground/50" />
                }
              </button>
            </div>
          </div>

          {/* Section tabs */}
          <div className="flex gap-1 p-1 rounded-lg bg-secondary/30 border border-primary/10">
            {SECTION_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => bm.setActiveSection(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-xl transition-colors ${
                  bm.activeSection === tab.id
                    ? 'bg-primary/15 text-foreground border border-primary/20'
                    : 'text-muted-foreground hover:text-foreground hover:bg-primary/5'
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            ))}
          </div>

          {bm.activeSection === 'policy' && (
            <ByomProviderList
              policy={bm.policy}
              usageStats={bm.usageStats}
              toggleProvider={bm.toggleProvider}
            />
          )}

          {bm.activeSection === 'routing' && (
            <ByomRoutingRules
              rules={bm.policy.routing_rules}
              onAdd={bm.addRoutingRule}
              onUpdate={bm.updateRoutingRule}
              onRemove={bm.removeRoutingRule}
            />
          )}

          {bm.activeSection === 'compliance' && (
            <ByomComplianceRules
              rules={bm.policy.compliance_rules}
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
    </ContentBox>
  );
}
