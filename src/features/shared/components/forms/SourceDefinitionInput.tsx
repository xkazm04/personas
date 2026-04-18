/**
 * SourceDefinitionInput — reusable "where does this data come from?" picker.
 *
 * Pattern: the user is asked to supply a *source* for something (a design
 * brief, a dataset, a document, a schema, ...). Instead of a single free-form
 * textarea where the user has to remember syntax, they pick a source *kind*
 * and the component shows an appropriate picker:
 *
 *   1. **local**    — paste a full local file or folder path.
 *   2. **codebase** — pick a Dev Tools project (only when at least one is
 *                     registered). Uses the shared `DevToolsProjectDropdown`.
 *   3. **database** — pick a credential whose connector's category is
 *                     `"database"` (only when at least one exists in the
 *                     vault). Presented as an inline select when >1, as a
 *                     label when =1.
 *
 * Tabs for kinds with zero matching resources are disabled so the user never
 * lands on an empty pane.
 *
 * Answer encoding (stays compatible with the `Record<string,string>` answer
 * map used by the adoption questionnaire):
 *
 *   JSON string with shape `{kind, ...}`. For example:
 *     {"kind":"local","path":"/Users/me/project"}
 *     {"kind":"codebase","projectId":"proj-1","name":"marathon-site","rootPath":"/..."}
 *     {"kind":"database","credentialId":"cred-1","name":"Supabase Prod","serviceType":"supabase"}
 *
 * The `summarizeSourceDefinition` helper is exported for the live-preview
 * card so the summary stays consistent wherever this component is rendered.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, Database, FolderGit2, AlertCircle } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useVaultStore } from '@/stores/vaultStore';
import { useShallow } from 'zustand/react/shallow';
import { listProjects } from '@/api/devTools/devTools';
import type { DevProject } from '@/lib/bindings/DevProject';
import { useTranslation } from '@/i18n/useTranslation';
import { ThemedSelect } from './ThemedSelect';

export type SourceKind = 'local' | 'codebase' | 'database';

export interface SourceDefinitionValue {
  kind: SourceKind;
  // local
  path?: string;
  // codebase
  projectId?: string;
  name?: string;
  rootPath?: string;
  // database
  credentialId?: string;
  serviceType?: string;
}

export function parseSourceDefinition(raw: string): SourceDefinitionValue | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === 'object' && typeof v.kind === 'string') {
      return v as SourceDefinitionValue;
    }
  } catch {
    // fall through to legacy plain-string handling
  }
  // Legacy fallback: if the user previously stored a plain string (e.g. from
  // the old textarea), treat it as a local path so we don't lose data.
  return { kind: 'local', path: raw };
}

export function summarizeSourceDefinition(
  raw: string,
  t?: ReturnType<typeof useTranslation>['t'],
): string {
  const v = parseSourceDefinition(raw);
  if (!v) return '';
  const labels = t?.templates.adopt_modal;
  switch (v.kind) {
    case 'local':
      return v.path ? `${labels?.source_local ?? 'Local'}: ${v.path}` : (labels?.source_local ?? 'Local');
    case 'codebase':
      return `${labels?.source_codebase ?? 'Codebase'}: ${v.name ?? v.projectId ?? ''}`;
    case 'database':
      return `${labels?.source_database ?? 'Database'}: ${v.name ?? v.credentialId ?? ''}`;
    default:
      return raw;
  }
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Optional placeholder for the local-path input. */
  localPlaceholder?: string;
  className?: string;
}

export function SourceDefinitionInput({
  value,
  onChange,
  localPlaceholder,
  className,
}: Props) {
  const { t } = useTranslation();
  const { credentials, connectorDefinitions, fetchConnectorDefinitions } = useVaultStore(
    useShallow((s) => ({
      credentials: s.credentials,
      connectorDefinitions: s.connectorDefinitions,
      fetchConnectorDefinitions: s.fetchConnectorDefinitions,
    })),
  );

  const [projects, setProjects] = useState<DevProject[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);

  // Load Dev Tools projects once on mount.
  useEffect(() => {
    let cancelled = false;
    listProjects(undefined)
      .then((r) => {
        if (cancelled) return;
        setProjects(
          [...r].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
        );
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      })
      .finally(() => {
        if (!cancelled) setProjectsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Make sure connector definitions are loaded so we can resolve categories.
  useEffect(() => {
    if (connectorDefinitions.length === 0) {
      fetchConnectorDefinitions().catch(() => {});
    }
  }, [connectorDefinitions.length, fetchConnectorDefinitions]);

  // Credentials whose connector's category is "database".
  const databaseCredentials = useMemo(() => {
    const dbServices = new Set(
      connectorDefinitions
        .filter((c) => c.category === 'database')
        .map((c) => c.name),
    );
    return credentials.filter((c) => dbServices.has(c.service_type));
  }, [credentials, connectorDefinitions]);

  const parsed = useMemo(() => parseSourceDefinition(value), [value]);

  // Default kind: first enabled tab.
  const hasCodebases = projects.length > 0;
  const hasDatabases = databaseCredentials.length > 0;
  const [activeKind, setActiveKind] = useState<SourceKind>(() => {
    if (parsed?.kind) return parsed.kind;
    return 'local';
  });

  // Sync activeKind from the stored value ONLY when the parsed kind changes
  // externally (e.g. on mount, or when the value prop changes from the parent).
  // Reacting on every render would fight the user: clicking "Codebase" flips
  // activeKind, but the stored value still has kind="local" since nothing was
  // committed yet — the effect would then snap activeKind back to "local".
  const lastParsedKindRef = useRef<SourceKind | undefined>(parsed?.kind);
  useEffect(() => {
    if (parsed?.kind && parsed.kind !== lastParsedKindRef.current) {
      lastParsedKindRef.current = parsed.kind;
      setActiveKind(parsed.kind);
    }
  }, [parsed?.kind]);

  const commit = (next: SourceDefinitionValue) => {
    lastParsedKindRef.current = next.kind;
    onChange(JSON.stringify(next));
  };

  const handleBrowseLocal = async () => {
    try {
      // Allow either files or directories — common for design briefs, style
      // guides, CSVs, folders of assets.
      const selected = await openDialog({
        directory: false,
        multiple: false,
        title: t.templates.adopt_modal.source_local,
      });
      if (typeof selected === 'string') {
        commit({ kind: 'local', path: selected });
      }
    } catch {
      // User cancelled or dialog unavailable — silent.
    }
  };

  const tabs: {
    kind: SourceKind;
    Icon: typeof FolderOpen;
    label: string;
    disabled: boolean;
    disabledHint: string;
  }[] = [
    {
      kind: 'local',
      Icon: FolderOpen,
      label: t.templates.adopt_modal.source_local,
      disabled: false,
      disabledHint: '',
    },
    {
      kind: 'codebase',
      Icon: FolderGit2,
      label: t.templates.adopt_modal.source_codebase,
      disabled: !hasCodebases && projectsLoaded,
      disabledHint: t.templates.adopt_modal.source_no_codebases,
    },
    {
      kind: 'database',
      Icon: Database,
      label: t.templates.adopt_modal.source_database,
      disabled: !hasDatabases,
      disabledHint: t.templates.adopt_modal.source_no_databases,
    },
  ];

  return (
    <div className={`w-full max-w-xl space-y-3 ${className ?? ''}`}>
      {/* Kind tabs */}
      <div className="flex flex-wrap gap-2">
        {tabs.map(({ kind, Icon, label, disabled, disabledHint }) => {
          const active = activeKind === kind;
          return (
            <button
              key={kind}
              type="button"
              onClick={() => !disabled && setActiveKind(kind)}
              disabled={disabled}
              title={disabled ? disabledHint : undefined}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-all ${
                active && !disabled
                  ? 'bg-primary/20 border-primary/30 text-primary font-medium'
                  : disabled
                    ? 'bg-white/[0.02] border-white/[0.04] text-foreground cursor-not-allowed'
                    : 'bg-white/[0.03] border-white/[0.06] text-foreground hover:bg-white/[0.06] hover:border-white/[0.1]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      {/* Active pane */}
      {activeKind === 'local' && (
        <div className="space-y-1.5">
          <p className="text-xs text-foreground">
            {t.templates.adopt_modal.source_local_hint}
          </p>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/60 pointer-events-none" />
              <input
                type="text"
                value={parsed?.kind === 'local' ? parsed.path ?? '' : ''}
                onChange={(e) => commit({ kind: 'local', path: e.target.value })}
                placeholder={localPlaceholder ?? t.templates.adopt_modal.source_local_placeholder}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-white/[0.08] bg-white/[0.03] text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/30 focus:bg-white/[0.05] transition-all"
              />
            </div>
            <button
              type="button"
              onClick={handleBrowseLocal}
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-primary/15 bg-background/80 text-foreground hover:border-primary/25 hover:bg-primary/5 transition-all"
              title={t.templates.adopt_modal.source_local}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              {t.common.browse}
            </button>
          </div>
        </div>
      )}

      {activeKind === 'codebase' && (
        <div className="space-y-1.5">
          <p className="text-xs text-foreground">
            {t.templates.adopt_modal.source_codebase_hint}
          </p>
          {!hasCodebases ? (
            <div className="flex items-center gap-2 text-sm text-rose-300/80 px-3 py-2 rounded-lg bg-rose-500/[0.06] border border-rose-500/20">
              <AlertCircle className="w-3.5 h-3.5" />
              {t.templates.adopt_modal.source_no_codebases}
            </div>
          ) : projects.length === 1 ? (
            <SingleCodebaseCard
              project={projects[0]!}
              selected={parsed?.kind === 'codebase' && parsed.projectId === projects[0]!.id}
              onClick={() =>
                commit({
                  kind: 'codebase',
                  projectId: projects[0]!.id,
                  name: projects[0]!.name,
                  rootPath: projects[0]!.root_path ?? undefined,
                })
              }
            />
          ) : (
            <ThemedSelect
              filterable
              value={parsed?.kind === 'codebase' ? parsed.projectId ?? '' : ''}
              onValueChange={(projectId) => {
                const p = projects.find((x) => x.id === projectId);
                if (!p) return;
                commit({
                  kind: 'codebase',
                  projectId: p.id,
                  name: p.name,
                  rootPath: p.root_path ?? undefined,
                });
              }}
              placeholder={t.templates.adopt_modal.source_pick_codebase}
              options={projects.map((p) => ({
                value: p.id,
                label: p.name,
                description: p.root_path ?? undefined,
              }))}
            />
          )}
        </div>
      )}

      {activeKind === 'database' && (
        <div className="space-y-1.5">
          <p className="text-xs text-foreground">
            {t.templates.adopt_modal.source_database_hint}
          </p>
          {!hasDatabases ? (
            <div className="flex items-center gap-2 text-sm text-rose-300/80 px-3 py-2 rounded-lg bg-rose-500/[0.06] border border-rose-500/20">
              <AlertCircle className="w-3.5 h-3.5" />
              {t.templates.adopt_modal.source_no_databases}
            </div>
          ) : databaseCredentials.length === 1 ? (
            <SingleCredentialCard
              name={databaseCredentials[0]!.name}
              serviceType={databaseCredentials[0]!.service_type}
              selected={
                parsed?.kind === 'database' &&
                parsed.credentialId === databaseCredentials[0]!.id
              }
              onClick={() =>
                commit({
                  kind: 'database',
                  credentialId: databaseCredentials[0]!.id,
                  name: databaseCredentials[0]!.name,
                  serviceType: databaseCredentials[0]!.service_type,
                })
              }
            />
          ) : (
            <ThemedSelect
              filterable
              value={parsed?.kind === 'database' ? parsed.credentialId ?? '' : ''}
              onValueChange={(credentialId) => {
                const c = databaseCredentials.find((x) => x.id === credentialId);
                if (!c) return;
                commit({
                  kind: 'database',
                  credentialId: c.id,
                  name: c.name,
                  serviceType: c.service_type,
                });
              }}
              placeholder={t.templates.adopt_modal.source_pick_database}
              options={databaseCredentials.map((c) => ({
                value: c.id,
                label: c.name,
                description: c.service_type,
              }))}
            />
          )}
        </div>
      )}
    </div>
  );
}

function SingleCodebaseCard({
  project,
  selected,
  onClick,
}: {
  project: DevProject;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg border transition-all text-left ${
        selected
          ? 'bg-primary/15 border-primary/30 text-primary'
          : 'bg-white/[0.03] border-white/[0.06] text-foreground hover:bg-white/[0.06]'
      }`}
    >
      <FolderGit2 className="w-4 h-4 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-medium truncate">{project.name}</div>
        {project.root_path && (
          <div className="text-xs text-foreground truncate">{project.root_path}</div>
        )}
      </div>
    </button>
  );
}

function SingleCredentialCard({
  name,
  serviceType,
  selected,
  onClick,
}: {
  name: string;
  serviceType: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg border transition-all text-left ${
        selected
          ? 'bg-primary/15 border-primary/30 text-primary'
          : 'bg-white/[0.03] border-white/[0.06] text-foreground hover:bg-white/[0.06]'
      }`}
    >
      <Database className="w-4 h-4 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-medium truncate">{name}</div>
        <div className="text-xs text-foreground truncate">{serviceType}</div>
      </div>
    </button>
  );
}
