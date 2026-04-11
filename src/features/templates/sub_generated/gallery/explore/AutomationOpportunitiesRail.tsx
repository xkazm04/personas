import { Lightbulb, Plus, Zap, ChevronRight, Download } from 'lucide-react';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { SectionLabel } from '@/features/shared/components/display/SectionLabel';
import type { AutomationOpportunity } from './useAutomationDiscovery';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { useTranslation } from '@/i18n/useTranslation';

interface AutomationOpportunitiesRailProps {
  opportunities: AutomationOpportunity[];
  onSelectTemplate: (template: PersonaDesignReview) => void;
  onSelectCategory: (category: string) => void;
}

const BUSINESS_VALUE: Record<string, string> = {
  software: 'Accelerate development cycles with automated code review, CI/CD monitoring, and quality gates',
  operations: 'Reduce MTTR and eliminate manual toil with proactive monitoring and incident response',
  business: 'Streamline revenue operations — automate lead nurturing, invoicing, and compliance checks',
  content: 'Scale content production with automated drafting, review workflows, and knowledge management',
  customer: 'Improve response times and satisfaction with automated ticket routing and proactive outreach',
  data: 'Turn raw data into decisions — automate reporting, pipeline monitoring, and project tracking',
};

export function AutomationOpportunitiesRail({
  opportunities,
  onSelectTemplate,
  onSelectCategory,
}: AutomationOpportunitiesRailProps) {
  const { t } = useTranslation();
  if (opportunities.length === 0) return null;

  return (
    <div className="mb-6 max-w-5xl 3xl:max-w-7xl 4xl:max-w-[1800px] mx-auto">
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb className="w-4 h-4 text-amber-400/70" />
        <SectionLabel as="span" className="mb-0">{t.templates.opportunities.title}</SectionLabel>
        <span className="text-sm text-muted-foreground/50">{t.templates.opportunities.subtitle}</span>
      </div>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
        {opportunities.slice(0, 4).map((opp) => (
          <OpportunityCard
            key={opp.group.role}
            opportunity={opp}
            onSelectTemplate={onSelectTemplate}
            onSelectCategory={onSelectCategory}
          />
        ))}
      </div>
    </div>
  );
}

function OpportunityCard({
  opportunity,
  onSelectTemplate,
  onSelectCategory,
}: {
  opportunity: AutomationOpportunity;
  onSelectTemplate: (template: PersonaDesignReview) => void;
  onSelectCategory: (category: string) => void;
}) {
  const { t } = useTranslation();
  const { group, readyNow, oneConnectorAway, suggestedConnector } = opportunity;
  const GroupIcon = group.icon;
  const hasReadyNow = readyNow.length > 0;
  const hasOneAway = oneConnectorAway.length > 0;
  const businessValue = BUSINESS_VALUE[group.role] ?? group.description;
  const connectorMeta = suggestedConnector ? getConnectorMeta(suggestedConnector) : null;

  return (
    <div className="rounded-xl border border-amber-500/12 bg-amber-500/[0.03] p-4 hover:border-amber-500/25 transition-all">
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-2">
        <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/15">
          <GroupIcon className="w-4 h-4 text-amber-300/80" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground/85">{group.label}</h3>
        </div>
        <button
          onClick={() => onSelectCategory(group.categories[0]!)}
          className="text-sm text-amber-400/60 hover:text-amber-400 transition-colors"
          title={t.templates.opportunities.explore_templates.replace('{label}', group.label)}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Business value */}
      <p className="text-sm text-muted-foreground/50 mb-3 leading-relaxed">
        {businessValue}
      </p>

      {/* Ready now templates */}
      {hasReadyNow && (
        <div className="mb-2">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Zap className="w-3 h-3 text-emerald-400/70" />
            <span className="text-sm font-medium text-emerald-400/70">
              {t.templates.opportunities.ready_now}
            </span>
            <span className="text-sm text-muted-foreground/40">
              ({readyNow.length})
            </span>
          </div>
          <div className="space-y-1">
            {readyNow.slice(0, 2).map((tmpl) => (
              <TemplateRow key={tmpl.id} template={tmpl} onClick={() => onSelectTemplate(tmpl)} />
            ))}
          </div>
        </div>
      )}

      {/* One connector away */}
      {hasOneAway && connectorMeta && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Plus className="w-3 h-3 text-amber-400/60" />
            <span className="text-sm font-medium text-amber-400/70">
              {t.templates.opportunities.add_connector}
            </span>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm rounded bg-amber-500/10 text-amber-300/80 border border-amber-500/15">
              <ConnectorIcon meta={connectorMeta} size="w-3 h-3" />
              {connectorMeta.label}
            </span>
            <span className="text-sm text-muted-foreground/40">
              {t.templates.opportunities.unlock_more.replace('{count}', String(oneConnectorAway.length))}
            </span>
          </div>
          <div className="space-y-1">
            {oneConnectorAway.slice(0, 2).map((tmpl) => (
              <TemplateRow key={tmpl.id} template={tmpl} onClick={() => onSelectTemplate(tmpl)} dimmed />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TemplateRow({
  template,
  onClick,
  dimmed = false,
}: {
  template: PersonaDesignReview;
  onClick: () => void;
  dimmed?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-amber-500/5 transition-colors ${
        dimmed ? 'opacity-60' : ''
      }`}
    >
      <span className="text-sm text-foreground/70 flex-1 truncate">
        {template.test_case_name}
      </span>
      {template.adoption_count > 0 && (
        <span className="inline-flex items-center gap-0.5 text-sm text-emerald-400/50 tabular-nums flex-shrink-0">
          <Download className="w-2.5 h-2.5" />
          {template.adoption_count}
        </span>
      )}
    </button>
  );
}
