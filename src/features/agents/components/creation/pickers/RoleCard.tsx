import { Plus, X, Key, Table2 } from 'lucide-react';
import { useVaultStore } from "@/stores/vaultStore";
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { getConnectorFamily } from '@/features/vault/sub_databases/introspectionQueries';
import type { BuilderComponent, ComponentRole } from '../steps/builder/types';
import { computeRoleCoverage } from '../steps/builder/builderReducer';
import { roleIcons, roleColors, roleIconColors, BUILTIN_CONNECTORS } from './selectors/componentPickerConstants';

// -- Database detection -------------------------------------------------------

export function isDatabaseConnector(connectorName: string): boolean {
  const family = getConnectorFamily(connectorName);
  return family !== 'unsupported' && family !== 'redis';
}

// -- Role Coverage Dot --------------------------------------------------------

function RoleCoverageDot({ role, components }: { role: ComponentRole; components: BuilderComponent[] }) {
  const status = computeRoleCoverage(components, role);
  if (status === 'none') return null;
  const color = status === 'full' ? 'bg-emerald-400' : 'bg-amber-400';
  return <span className={`w-1.5 h-1.5 rounded-full ${color} shrink-0`} />;
}

// -- Role Card ----------------------------------------------------------------

export function RoleCard({
  role,
  label,
  description,
  components,
  onOpenAssign,
  onRemove,
  onOpenTableSelector,
}: {
  role: ComponentRole;
  label: string;
  description: string;
  components: BuilderComponent[];
  onOpenAssign: () => void;
  onRemove: (id: string) => void;
  onOpenTableSelector?: (componentId: string) => void;
}) {
  const credentials = useVaultStore((s) => s.credentials);
  const Icon = roleIcons[role];

  return (
    <div className={`flex flex-col rounded-xl border bg-gradient-to-b ${roleColors[role]} overflow-hidden`}>
      {/* Card head */}
      <div className="flex flex-col items-center pt-4 pb-2 px-3">
        <div className="p-2.5 rounded-xl bg-background/60 backdrop-blur-sm border border-white/5 mb-2">
          <Icon className={`w-6 h-6 ${roleIconColors[role]}`} />
        </div>
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-foreground/85">{label}</p>
          <RoleCoverageDot role={role} components={components} />
        </div>
        <p className="text-sm text-muted-foreground/65 mt-0.5">{description}</p>
      </div>

      {/* Assigned items */}
      <div className="flex-1 px-2.5 pb-2 space-y-1">
        {components.map((comp) => {
            const meta = getConnectorMeta(comp.connectorName);
            const credName = comp.credentialId
              ? credentials.find((c) => c.id === comp.credentialId)?.name
              : null;
            const isDb = comp.credentialId && isDatabaseConnector(comp.connectorName);
            return (
              <div
                key={comp.id}
                className="animate-fade-slide-in overflow-hidden"
              >
                <div className="flex items-center gap-1.5 px-2 py-1.5 bg-background/50 border border-primary/10 rounded-lg text-sm">
                  <ConnectorIcon meta={meta} size="w-4 h-4" />
                  <span className="flex-1 min-w-0 truncate text-foreground/70">
                    {credName ?? meta.label}
                  </span>
                  {credName ? (
                    <Key className="w-3 h-3 text-primary/40 shrink-0" />
                  ) : !BUILTIN_CONNECTORS.has(comp.connectorName) ? (
                    <span className="text-sm font-medium text-amber-400/80 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded shrink-0">
                      No credential
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onRemove(comp.id)}
                    className="p-0.5 text-muted-foreground/50 hover:text-red-400 transition-colors shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {/* Watched table pills + edit button */}
                {isDb && (
                  <div className="flex flex-wrap items-center gap-0.5 px-1.5 pt-1 pb-0.5">
                    {comp.watchedTables && comp.watchedTables.length > 0 ? (
                      <>
                        {comp.watchedTables.slice(0, 4).map((tableName) => (
                          <span
                            key={tableName}
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-500/10 border border-amber-500/15 rounded text-sm font-mono text-amber-400/80"
                          >
                            <Table2 className="w-2 h-2" />
                            {tableName}
                          </span>
                        ))}
                        {comp.watchedTables.length > 4 && (
                          <span className="text-sm text-muted-foreground/60 self-center">
                            +{comp.watchedTables.length - 4}
                          </span>
                        )}
                      </>
                    ) : null}
                    {onOpenTableSelector && (
                      <button
                        type="button"
                        onClick={() => onOpenTableSelector(comp.id)}
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-sm font-medium text-muted-foreground/50 hover:text-amber-400/80 hover:bg-amber-500/8 rounded transition-colors"
                      >
                        <Table2 className="w-2 h-2" />
                        {comp.watchedTables?.length ? 'edit' : 'select tables'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
      </div>

      {/* Add button */}
      <div className="px-2.5 pb-2.5">
        <button
          type="button"
          onClick={onOpenAssign}
          className="w-full flex items-center justify-center gap-1 px-2 py-1.5 text-sm font-medium text-muted-foreground/65 border border-dashed border-primary/20 rounded-lg hover:bg-background/40 hover:text-foreground/80 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Assign
        </button>
      </div>
    </div>
  );
}
