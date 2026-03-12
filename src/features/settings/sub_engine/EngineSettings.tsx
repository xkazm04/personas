import { Cpu, RotateCcw, AlertTriangle, Check, X, Minus, Lock } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useEngineCapabilities } from '@/hooks/utility/data/useEngineCapabilities';
import { CLI_OPERATIONS, PROVIDERS, DEFAULT_CAPABILITIES } from './engineCapabilities';
import type { CliEngine } from '@/lib/types/types';
import type { CliOperation } from './engineCapabilities';

export default function EngineSettings() {
  const {
    installedProviders,
    loaded,
    isEnabled,
    toggle,
    resetToDefaults,
  } = useEngineCapabilities();

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
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
                Operation Capability Map
              </h2>
              <button
                onClick={resetToDefaults}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/40 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                Reset to defaults
              </button>
            </div>

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
            <h3 className="text-sm font-mono text-muted-foreground/70 uppercase tracking-wider">Legend</h3>
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

// ===========================================================================
// Row component
// ===========================================================================

function OperationRow({
  operation,
  label,
  description,
  installedProviders,
  isEnabled,
  onToggle,
}: {
  operation: CliOperation;
  label: string;
  description: string;
  installedProviders: Set<CliEngine>;
  isEnabled: (op: CliOperation, p: CliEngine) => boolean;
  onToggle: (op: CliOperation, p: CliEngine) => void;
}) {
  return (
    <tr className="border-b border-primary/5 hover:bg-primary/[0.02] transition-colors">
      <td className="py-2.5 pr-4">
        <div className="flex flex-col">
          <span className="text-sm text-foreground/90">{label}</span>
          <span className="text-[11px] text-muted-foreground/50 leading-tight">{description}</span>
        </div>
      </td>
      {PROVIDERS.map((p) => {
        const installed = installedProviders.has(p.id);
        const defaultEnabled = DEFAULT_CAPABILITIES[operation]?.[p.id] ?? false;
        const enabled = isEnabled(operation, p.id);
        // Lock cells where the default is false -- CLI failed the test, not toggleable
        const locked = !defaultEnabled;

        return (
          <td key={p.id} className="py-2.5 px-2 text-center">
            {!installed ? (
              <div className="flex justify-center">
                <span className="w-6 h-6 rounded bg-secondary/20 border border-primary/5 flex items-center justify-center cursor-not-allowed">
                  <Minus className="w-3 h-3 text-muted-foreground/20" />
                </span>
              </div>
            ) : locked ? (
              <div className="flex justify-center">
                <span
                  className="w-6 h-6 rounded bg-rose-500/10 border border-rose-500/20 flex items-center justify-center cursor-not-allowed"
                  title={`${label} is not supported by ${p.shortLabel} -- failed integration tests`}
                >
                  <Lock className="w-2.5 h-2.5 text-rose-400/40" />
                </span>
              </div>
            ) : (
              <div className="flex justify-center">
                <button
                  onClick={() => onToggle(operation, p.id)}
                  className={`w-6 h-6 rounded border flex items-center justify-center transition-all ${
                    enabled
                      ? 'bg-emerald-500/20 border-emerald-500/30 hover:bg-emerald-500/30'
                      : 'bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/20'
                  }`}
                  title={`${enabled ? 'Disable' : 'Enable'} ${label} for ${p.shortLabel}`}
                >
                  {enabled ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <X className="w-3 h-3 text-rose-400/60" />
                  )}
                </button>
              </div>
            )}
          </td>
        );
      })}
    </tr>
  );
}
