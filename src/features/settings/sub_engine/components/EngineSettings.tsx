import { Cpu, RotateCcw, AlertTriangle, Check, Minus, Lock, Info, Radio, Route, Sparkles } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { SettingsScaffold, type SettingsSection } from '@/features/shared/components/layout/settings/SettingsScaffold';
import { useEngineCapabilities } from '@/hooks/utility/data/useEngineCapabilities';
import { CLI_OPERATIONS, PROVIDERS } from '../libs/engineCapabilities';
import { OperationRow } from './OperationRow';
import { AmbientContextPanel } from '@/features/settings/components/AmbientContextPanel';
import { ModelRoutingSection } from './ModelRoutingSection';
import { AthenaTiersSection } from './AthenaTiersSection';
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
          icon={<Cpu className="w-5 h-5 text-ink-2" />}
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
      icon: <Cpu className="w-4 h-4 text-ink-2" />,
      action: (
        <button
          type="button"
          onClick={resetToDefaults}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-card typo-body text-foreground hover:text-ink-2 hover:bg-surface-2 transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          {s.reset_defaults}
        </button>
      ),
      content: (
        // Matrix grid — sticky axes + zebra striping keep each cell traceable
        // to its operation (frozen first column) and provider (frozen header).
        <div className="overflow-auto max-h-[28rem] rounded-input border border-hair">
          <table className="w-full typo-body border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 bg-background text-left py-2 pr-4 pl-3 w-[45%] border-b border-hair border-r border-r-primary/10 typo-caption font-mono uppercase tracking-widest text-foreground">
                  {s.operation}
                </th>
                {PROVIDERS.map((p) => {
                  const installed = installedProviders.has(p.id);
                  return (
                    <th key={p.id} className="sticky top-0 z-10 bg-background py-2 px-2 text-center min-w-[90px] border-b border-hair typo-caption font-mono uppercase tracking-widest text-foreground">
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-foreground">
                          {p.shortLabel}
                        </span>
                        <span className={`typo-caption px-1.5 py-0.5 rounded-full ${
                          installed
                            ? 'bg-status-success/15 text-status-success border border-status-success/25'
                            : 'bg-status-error/10 text-status-error/60 border border-status-error/20'
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
      icon: <Info className="w-4 h-4 text-ink-2" />,
      content: (
        <div className="flex flex-wrap gap-4 typo-body text-foreground">
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded-interactive bg-status-success/20 border border-status-success/30 flex items-center justify-center">
              <Check className="w-2.5 h-2.5 text-status-success" />
            </span>
            {s.legend_enabled}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded-interactive bg-status-error/10 border border-status-error/20 flex items-center justify-center">
              <Lock className="w-2.5 h-2.5 text-status-error/40" />
            </span>
            {s.legend_unsupported}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded-interactive bg-surface-1 border border-hair flex items-center justify-center">
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
      icon: <Radio className="w-4 h-4 text-ink-2" />,
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
      id: 'athena-tiers',
      label: t.settings.athenaTiers.title,
      icon: <Sparkles className="w-4 h-4 text-ink-2" />,
      content: <AthenaTiersSection />,
    },
    {
      id: 'routing',
      label: s.routing_title,
      icon: <Route className="w-4 h-4 text-ink-2" />,
      content: <ModelRoutingSection />,
    },
  ];

  return (
    <ContentBox>
      <ContentHeader
        icon={<Cpu className="w-5 h-5 text-ink-2" />}
        iconColor="cyan"
        title={s.title}
        subtitle={s.subtitle}
      />

      <ContentBody centered>
        <div className="space-y-4">
          {/* No quick-nav rail: the capability map is the reason to visit, and
              its provider columns need the full content width to stay legible. */}
          <SettingsScaffold sections={sections} navAriaLabel={s.title} showNav={false} maxWidth="max-w-none" />

          {/* Protocol warning */}
          <div className="rounded-modal border border-status-warning/20 bg-status-warning/5 p-4 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-status-warning mt-0.5 flex-shrink-0" />
            <div className="typo-body text-foreground">
              <p className="font-medium text-status-warning/90 mb-1">{s.defaults_heading}</p>
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
