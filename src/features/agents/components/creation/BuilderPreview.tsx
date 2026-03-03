import { ListChecks, Plug, Clock, Bell, ShieldAlert, UserCheck, FileText } from 'lucide-react';
import type { BuilderState } from './types';
import { generateSummary } from './builderReducer';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/ConnectorMeta';

interface BuilderPreviewProps {
  state: BuilderState;
}

function PreviewRow({ icon, label, value, muted }: { icon: React.ReactNode; label: string; value: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground/50 mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">{label}</p>
        <div className={`text-xs ${muted ? 'text-muted-foreground/40 italic' : 'text-foreground/75'}`}>
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
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 px-1">
        Preview
      </p>

      <div className="bg-secondary/30 border border-primary/10 rounded-xl p-3 space-y-3">
        {/* Summary line */}
        {summary ? (
          <p className="text-xs font-medium text-foreground/70">{summary}</p>
        ) : (
          <p className="text-xs text-muted-foreground/30 italic">Start building to see a preview</p>
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

        {/* Components */}
        <PreviewRow
          icon={<Plug className="w-3 h-3" />}
          label="Components"
          value={
            state.components.length > 0 ? (
              <div className="flex flex-wrap gap-1 mt-0.5">
                {state.components.map((comp) => {
                  const meta = getConnectorMeta(comp.connectorName);
                  return (
                    <span key={comp.connectorName} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-secondary/40 rounded text-[10px]">
                      <ConnectorIcon meta={meta} size="w-2.5 h-2.5" />
                      {meta.label}
                      {comp.credentialId && <span className="text-primary/50">*</span>}
                    </span>
                  );
                })}
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

        {/* Channels */}
        {state.channels.length > 0 && (
          <PreviewRow
            icon={<Bell className="w-3 h-3" />}
            label="Notifications"
            value={state.channels.map((c) => c.type).join(', ')}
          />
        )}

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
