import { Cpu, RotateCcw, AlertTriangle, Check, Minus, Lock } from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useEngineCapabilities } from '@/hooks/utility/data/useEngineCapabilities';
import { useSettingsSaveToast } from '@/hooks/utility/interaction/useSettingsSaveToast';
import { useTranslation } from '@/i18n/useTranslation';
import { CLI_OPERATIONS, PROVIDERS } from '../libs/engineCapabilities';
import { OperationRow } from './OperationRow';
import { AmbientContextPanel } from '@/features/settings/components/AmbientContextPanel';

export default function EngineSettings() {
  const { t } = useTranslation();
  const { trigger } = useSettingsSaveToast(t.settings.settings_saved);

  const {
    installedProviders,
    loaded,
    isEnabled,
    toggle,
    resetToDefaults,
  } = useEngineCapabilities({ onSave: trigger });

  if (!loaded) {
    return (
      <ContentBox>
        <ContentHeader
          icon={<Cpu className="w-5 h-5 text-cyan-400" />}
          iconColor="cyan"
          title="Engine"
          subtitle="Loading engine capabilities..."
        />
        <ContentBody centered>
          <div className="h-40 flex items-center justify-center text-muted-foreground/60 text-sm">
            Detecting installed providers...
          </div>
        </ContentBody>
      </ContentBox>
    );
  }

  return (
    <ContentBox>
      <ContentHeader
        icon={<Cpu className="w-5 h-5 text-cyan-400" />}
        iconColor="cyan"
        title="Engine"
        subtitle="Configure which CLI providers handle each operation"
      />

      <ContentBody centered>
        <div className="space-y-4">
          {/* Capability matrix */}
          <div className="rounded-xl border border-primary/10 bg-card-bg p-6 space-y-4">
            <SectionHeading
              title="Operation Capability Map"
              action={
                <button
                  onClick={resetToDefaults}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/40 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset to defaults
                </button>
              }
            />

            {/* Matrix grid */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-primary/10">
                    <th className="text-left py-2 pr-4 text-muted-foreground/70 font-medium w-[45%]">
                      Operation
                    </th>
                    {PROVIDERS.map((p) => {
                      const installed = installedProviders.has(p.id);
                      return (
                        <th key={p.id} className="py-2 px-2 text-center font-medium min-w-[90px]">
                          <div className="flex flex-col items-center gap-0.5">
                            <span className={installed ? 'text-muted-foreground/90' : 'text-muted-foreground/60'}>
                              {p.shortLabel}
                            </span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                              installed
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                                : 'bg-rose-500/10 text-rose-400/60 border border-rose-500/20'
                            }`}>
                              {installed ? 'installed' : 'missing'}
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
                      label={op.label}
                      description={op.description}
                      installedProviders={installedProviders}
                      isEnabled={isEnabled}
                      onToggle={toggle}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Legend */}
          <div className="rounded-xl border border-primary/10 bg-card-bg p-4 space-y-2">
            <SectionHeading title="Legend" />
            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground/70">
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-4 rounded bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                  <Check className="w-2.5 h-2.5 text-emerald-400" />
                </span>
                Enabled
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-4 rounded bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                  <Lock className="w-2.5 h-2.5 text-rose-400/40" />
                </span>
                Unsupported (locked)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-4 rounded bg-secondary/30 border border-primary/10 flex items-center justify-center">
                  <Minus className="w-2.5 h-2.5 text-muted-foreground/30" />
                </span>
                Not installed
              </span>
            </div>
          </div>

          {/* Ambient Context Fusion */}
          <div className="rounded-xl border border-primary/10 bg-card-bg p-6">
            <AmbientContextPanel />
          </div>

          {/* Protocol warning */}
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-muted-foreground/80">
              <p className="font-medium text-amber-400/90 mb-1">Defaults from Integration Tests</p>
              <p>
                The default map is derived from Round 9 business-level integration tests that validate
                each provider against the exact JSON schemas the backend parses. Enabling a provider for
                an operation it failed may cause unparseable responses. Claude Code is the only provider
                that passed all operations at 100%.
              </p>
            </div>
          </div>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
