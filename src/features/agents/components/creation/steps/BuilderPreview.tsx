import { ListChecks, Plug, Clock, ShieldAlert, UserCheck, FileText } from 'lucide-react';
import type { BuilderState } from './types';
import { COMPONENT_ROLES } from './types';
import { generateSummary, computeCredentialCoverage } from './builderReducer';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';

interface BuilderPreviewProps {
  state: BuilderState;
}

function PreviewRow({ icon, label, value, muted }: { icon: React.ReactNode; label: string; value: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground/60 mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-muted-foreground/60 uppercase tracking-wider">{label}</p>
        <div className={`text-sm ${muted ? 'text-muted-foreground/55 italic' : 'text-foreground/80'}`}>
          {value}
        </div>
      </div>
    </div>
  );
}

export function BuilderPreview({ state }: BuilderPreviewProps) {
  const summary = generateSummary(state);
  const filledUseCases = state.useCases.filter((uc) => uc.title.trim());

  return (
    <div className="sticky top-0 space-y-3">
      <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground/60 px-1">
        Preview
      </p>

      <div className="bg-secondary/30 border border-primary/10 rounded-xl p-3 space-y-3">
        {/* Summary line */}
        {summary ? (
          <p className="text-sm font-medium text-foreground/70">{summary}</p>
        ) : (
          <p className="text-sm text-muted-foreground/50 italic">Start building to see a preview</p>
        )}

        {/* Intent */}
        {state.intent.trim() && (
          <PreviewRow
            icon={<FileText className="w-3 h-3" />}
            label="Intent"
            value={<p className="line-clamp-2">{state.intent.trim()}</p>}
          />
        )}

        {/* Use cases */}
        <PreviewRow
          icon={<ListChecks className="w-3 h-3" />}
          label="Use Cases"
          value={
            filledUseCases.length > 0 ? (
              <ul className="space-y-0.5">
                {filledUseCases.map((uc) => (
                  <li key={uc.id} className="truncate">{uc.title}</li>
                ))}
              </ul>
            ) : (
              'None yet'
            )
          }
          muted={filledUseCases.length === 0}
        />

        {/* Components by role */}
        <PreviewRow
          icon={<Plug className="w-3 h-3" />}
          label="Components"
          value={
            state.components.length > 0 ? (
              <div className="space-y-1 mt-0.5">
                {COMPONENT_ROLES.filter(({ role }) =>
                  state.components.some((c) => c.role === role),
                ).map(({ role, label }) => (
                  <div key={role}>
                    <span className="text-sm uppercase tracking-wider text-muted-foreground/55">{label}: </span>
                    {state.components.filter((c) => c.role === role).map((comp) => {
                      const meta = getConnectorMeta(comp.connectorName);
                      return (
                        <span key={comp.id} className="inline-flex items-center gap-0.5 px-1 py-0.5 bg-secondary/40 rounded text-sm mr-0.5">
                          <ConnectorIcon meta={meta} size="w-2.5 h-2.5" />
                          {meta.label}
                        </span>
                      );
                    })}
                  </div>
                ))}
                {(() => {
                  const cov = computeCredentialCoverage(state.components);
                  if (cov.total === 0) return null;
                  const color = cov.status === 'full' ? 'text-emerald-400' : cov.status === 'partial' ? 'text-amber-400' : 'text-muted-foreground/55';
                  return (
                    <p className={`text-sm mt-1 ${color}`}>
                      Credentials: {cov.matched}/{cov.total} covered
                    </p>
                  );
                })()}
              </div>
            ) : (
              'None'
            )
          }
          muted={state.components.length === 0}
        />

        {/* Trigger */}
        <PreviewRow
          icon={<Clock className="w-3 h-3" />}
          label="Schedule"
          value={state.globalTrigger?.label ?? 'Manual only'}
          muted={!state.globalTrigger}
        />

        {/* Policies */}
        {(state.errorStrategy !== 'halt' || state.reviewPolicy !== 'never') && (
          <>
            {state.errorStrategy !== 'halt' && (
              <PreviewRow
                icon={<ShieldAlert className="w-3 h-3" />}
                label="Errors"
                value={state.errorStrategy}
              />
            )}
            {state.reviewPolicy !== 'never' && (
              <PreviewRow
                icon={<UserCheck className="w-3 h-3" />}
                label="Review"
                value={state.reviewPolicy}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
