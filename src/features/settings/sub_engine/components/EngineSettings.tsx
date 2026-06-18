import { Cpu, RotateCcw, AlertTriangle, Check, Minus, Lock, Info, Radio, Route } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { SettingsScaffold, type SettingsSection } from '@/features/shared/components/layout/settings/SettingsScaffold';
import { useEngineCapabilities } from '@/hooks/utility/data/useEngineCapabilities';
import { CLI_OPERATIONS, PROVIDERS } from '../libs/engineCapabilities';
import { OperationRow } from './OperationRow';
import { AmbientContextPanel } from '@/features/settings/components/AmbientContextPanel';
import { ModelRoutingSection } from './ModelRoutingSection';
import { useTranslation } from '@/i18n/useTranslation';

export default function EngineSettings() {
  const {
    installedProviders,
    loaded,
    isEnabled,
    toggle,
    resetToDefaults,
  } = useEngineCapabilities();
  const { t } = useTranslation();
  const s = t.settings.engine;

  if (!loaded) {
    return (
      <ContentBox>
        <ContentHeader
          icon={<Cpu className="w-5 h-5 text-cyan-400" />}
          iconColor="cyan"
          title={s.title}
          subtitle={s.loading_capabilities}
        />
        <ContentBody centered>
          <div className="h-40 flex items-center justify-center text-foreground typo-body">
            {s.detecting_providers}
          </div>
        </ContentBody>
      </ContentBox>
    );
  }

  const sections: SettingsSection[] = [
    {
      id: 'matrix',
      label: s.capability_map,
      icon: <Cpu className="w-4 h-4 text-cyan-400" />,
      action: (
        <button
          onClick={resetToDefaults}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-card typo-body text-foreground hover:text-muted-foreground hover:bg-secondary/40 transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          {s.reset_defaults}
        </button>
      ),
      content: (
        // Matrix grid — sticky axes + zebra striping keep each cell traceable
        // to its operation (frozen first column) and provider (frozen header).
        <div className="overflow-auto max-h-[28rem] rounded-input border border-primary/5">
          <table className="w-full typo-body border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 bg-background text-left py-2 pr-4 pl-3 text-foreground font-medium w-[45%] border-b border-primary/10 border-r border-r-primary/10">
                  {s.operation}
                </th>
                {PROVIDERS.map((p) => {
                  const installed = installedProviders.has(p.id);
                  return (
                    <th key={p.id} className="sticky top-0 z-10 bg-background py-2 px-2 text-center font-medium min-w-[90px] border-b border-primary/10">
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-foreground">
                          {p.shortLabel}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                          installed
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                            : 'bg-rose-500/10 text-rose-400/60 border border-rose-500/20'
                        }`}>
                          {installed ? s.provider_installed : s.provider_missing}
                        </span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {CLI_OPERATIONS.map((op) => (
                <OperationRow
                  key={op.id}
                  operation={op.id}
                  label={s[op.labelKey]}
                  description={s[op.descriptionKey]}
                  installedProviders={installedProviders}
                  isEnabled={isEnabled}
                  onToggle={toggle}
                />
              ))}
            </tbody>
          </table>
        </div>
      ),
    },
    {
      id: 'legend',
      label: s.legend,
      icon: <Info className="w-4 h-4 text-cyan-400" />,
      content: (
        <div className="flex flex-wrap gap-4 typo-body text-foreground">
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
              <Check className="w-2.5 h-2.5 text-emerald-400" />
            </span>
            {s.legend_enabled}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
              <Lock className="w-2.5 h-2.5 text-rose-400/40" />
            </span>
            {s.legend_unsupported}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded bg-secondary/30 border border-primary/10 flex items-center justify-center">
              <Minus className="w-2.5 h-2.5 text-foreground" />
            </span>
            {s.legend_not_installed}
          </span>
        </div>
      ),
    },
    {
      id: 'ambient',
      label: t.settings.ambient.title,
      icon: <Radio className="w-4 h-4 text-blue-400" />,
      // The panel renders its own header (icon + title + master toggle); wrap it
      // in a title-less SectionCard so it gets consistent card chrome.
      card: false,
      content: (
        <SectionCard>
          <AmbientContextPanel />
        </SectionCard>
      ),
    },
    {
      id: 'routing',
      label: s.routing_title,
      icon: <Route className="w-4 h-4 text-cyan-400" />,
      content: <ModelRoutingSection />,
    },
  ];

  return (
    <ContentBox>
      <ContentHeader
        icon={<Cpu className="w-5 h-5 text-cyan-400" />}
        iconColor="cyan"
        title={s.title}
        subtitle={s.subtitle}
      />

      <ContentBody centered>
        <div className="max-w-5xl mx-auto space-y-4">
          <SettingsScaffold sections={sections} navAriaLabel={s.title} />

          {/* Protocol warning */}
          <div className="rounded-modal border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="typo-body text-foreground">
              <p className="font-medium text-amber-400/90 mb-1">{s.defaults_heading}</p>
              <p>
                {s.defaults_description}
              </p>
            </div>
          </div>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
