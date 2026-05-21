import { useState, useEffect } from 'react';
import {
  CircleDot, GitBranch, LayoutDashboard, Key, AlertCircle, AlertTriangle,
  CheckCircle2, RefreshCw, ExternalLink, Shield, Save,
} from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { updateProject } from '@/api/devTools/devTools';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import {
  fetchSentryOrgs,
  fetchSentryProjects,
  splitSentrySlug,
  type SentryOrg,
  type SentryProject,
} from './adapters';
import { formatErr } from './overviewHelpers';
import type { ConnectionState } from './useOverviewData';
import { DebtText, debtText } from '@/i18n/DebtText';


// ---------------------------------------------------------------------------
// Stat tile (shared across baseline + variants)
// ---------------------------------------------------------------------------

export type StatColor = 'amber' | 'blue' | 'violet' | 'emerald' | 'red' | 'primary';

const STAT_COLORS: Record<StatColor, { bg: string; border: string; icon: string }> = {
  amber: { bg: 'bg-amber-500/15', border: 'border-amber-500/25', icon: 'text-amber-400' },
  blue: { bg: 'bg-blue-500/15', border: 'border-blue-500/25', icon: 'text-blue-400' },
  violet: { bg: 'bg-violet-500/15', border: 'border-violet-500/25', icon: 'text-violet-400' },
  emerald: { bg: 'bg-emerald-500/15', border: 'border-emerald-500/25', icon: 'text-emerald-400' },
  red: { bg: 'bg-red-500/15', border: 'border-red-500/25', icon: 'text-red-400' },
  primary: { bg: 'bg-primary/15', border: 'border-primary/25', icon: 'text-primary' },
};

export function StatCard({
  icon: Icon,
  value,
  label,
  color = 'primary',
}: {
  icon: typeof CircleDot;
  value: string | number;
  label: string;
  color?: StatColor;
}) {
  const tw = STAT_COLORS[color] ?? STAT_COLORS.primary;
  return (
    <div className="rounded-modal border border-primary/10 bg-card/30 p-4 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-interactive ${tw.bg} border ${tw.border} flex items-center justify-center shrink-0`}>
        <Icon className={`w-4.5 h-4.5 ${tw.icon}`} />
      </div>
      <div className="min-w-0">
        <p className="typo-data-lg text-primary leading-tight truncate">{value}</p>
        <p className="typo-caption text-foreground truncate">{label}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connection card (shared baseline state surface)
// ---------------------------------------------------------------------------

export function ConnectionCard({
  title,
  state,
  serviceName,
  errorMessage,
  onAction,
  actionLabel,
  children,
}: {
  title: string;
  state: ConnectionState;
  serviceName: string;
  errorMessage?: string | null;
  onAction?: () => void;
  actionLabel?: string;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const po = t.project_overview;

  if (state === 'loading') {
    return (
      <div className="rounded-card border border-primary/10 bg-card/30 p-6 flex items-center justify-center gap-2">
        <RefreshCw className="w-4 h-4 animate-spin text-foreground" />
        <span className="typo-body text-foreground">{po.loading_stats}</span>
      </div>
    );
  }

  if (state === 'empty') {
    return (
      <div className="rounded-card border border-primary/10 bg-card/30 p-6 text-center">
        <Key className="w-8 h-8 text-foreground mx-auto mb-3" />
        <p className="typo-body text-foreground mb-3">
          {po.connect_to_see_stats.replace('{{service}}', serviceName).replace('{{category}}', title.toLowerCase())}
        </p>
        {onAction && (
          <Button variant="secondary" size="sm" onClick={onAction}>
            {actionLabel ?? po.go_to_connections}
          </Button>
        )}
      </div>
    );
  }

  if (state === 'unmapped') {
    return (
      <div className="rounded-card border border-amber-500/20 bg-amber-500/5 p-5">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <span className="typo-body font-medium text-foreground">{po.credential_found.replace('{{service}}', serviceName)}</span>
        </div>
        {children}
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="rounded-card border border-red-500/20 bg-red-500/5 p-5">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="typo-body font-medium text-foreground">{po.failed_to_load}</p>
            {errorMessage && (
              <p className="typo-caption text-foreground mt-1 break-words">{errorMessage}</p>
            )}
          </div>
        </div>
        {onAction && (
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={onAction}>
              {po.retry}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-card border border-emerald-500/20 bg-emerald-500/5 p-4">
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        <span className="typo-body font-medium text-foreground">{serviceName}</span>
        <span className="typo-caption text-emerald-400 ml-auto">{po.connected}</span>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connector chains
// ---------------------------------------------------------------------------

export function ChevronArrow() {
  return <span className="typo-caption text-foreground select-none">→</span>;
}

export function ConnectorChain({
  projectName,
  url,
  credentials,
  activeCredId,
  onPickCred,
  onEditUrl,
}: {
  projectName: string;
  url: string | null;
  credentials: PersonaCredential[];
  activeCredId: string | null;
  onPickCred: (id: string) => void;
  onEditUrl: () => void;
}) {
  const activeCred = credentials.find((c) => c.id === activeCredId);
  return (
    <div className="rounded-modal border border-primary/10 bg-card/30 px-3 py-2.5">
      <p className="typo-caption uppercase tracking-[0.18em] text-foreground mb-2">
        <DebtText k="auto_connection_chain_cb5a2bed" />
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1 typo-caption text-foreground">
          <LayoutDashboard className="w-3 h-3 text-primary" />
          <span className="font-medium">{projectName}</span>
        </span>
        <ChevronArrow />

        <button
          type="button"
          onClick={onEditUrl}
          className="inline-flex items-center gap-1 typo-caption text-foreground hover:text-primary transition-colors"
          title={debtText("auto_edit_project_to_change_the_repo_url_73afcda3")}
        >
          <GitBranch className="w-3 h-3 text-blue-400" />
          {url ? <span className="font-mono truncate max-w-[260px]">{url}</span> : <span className="text-amber-400"><DebtText k="auto_no_repo_url_599e20cc" /></span>}
          <ExternalLink className="w-3 h-3 opacity-60" />
        </button>
        <ChevronArrow />

        {credentials.length === 0 ? (
          <span className="inline-flex items-center gap-1 typo-caption text-amber-400">
            <Key className="w-3 h-3" /> <DebtText k="auto_no_credential_5d557567" />
          </span>
        ) : credentials.length === 1 ? (
          <span className="inline-flex items-center gap-1 typo-caption text-foreground">
            <Key className="w-3 h-3 text-emerald-400" />
            <span className="font-medium">{credentials[0]!.name}</span>
            <span className="text-foreground font-mono">({credentials[0]!.serviceType})</span>
          </span>
        ) : (
          <div className="inline-flex items-center gap-1">
            <Key className="w-3 h-3 text-emerald-400" />
            <select
              value={activeCredId ?? credentials[0]!.id}
              onChange={(e) => onPickCred(e.target.value)}
              className="px-1.5 py-0.5 typo-caption bg-secondary/40 border border-primary/10 rounded-card text-foreground"
            >
              {credentials.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.serviceType})</option>
              ))}
            </select>
          </div>
        )}
      </div>
      {activeCred && (
        <p className="typo-caption text-foreground mt-1.5">
          <DebtText k="auto_stats_are_fetched_through_the_api_proxy_us_e5df6a25" />
        </p>
      )}
    </div>
  );
}

export function MonitoringChain({
  projectName,
  credential,
  slug,
}: {
  projectName: string;
  credential: PersonaCredential | null;
  slug: string | null;
}) {
  const [orgSlug, projectSlug] = splitSentrySlug(slug);
  return (
    <div className="rounded-modal border border-primary/10 bg-card/30 px-3 py-2.5">
      <p className="typo-caption uppercase tracking-[0.18em] text-foreground mb-2">
        <DebtText k="auto_connection_chain_cb5a2bed" />
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1 typo-caption text-foreground">
          <LayoutDashboard className="w-3 h-3 text-primary" />
          <span className="font-medium">{projectName}</span>
        </span>
        <ChevronArrow />
        {credential ? (
          <span className="inline-flex items-center gap-1 typo-caption text-foreground">
            <Key className="w-3 h-3 text-emerald-400" />
            <span className="font-medium">{credential.name}</span>
            <span className="text-foreground font-mono">({credential.serviceType})</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 typo-caption text-amber-400">
            <Key className="w-3 h-3" /> <DebtText k="auto_no_credential_linked_4b88fb9a" />
          </span>
        )}
        {credential && (
          <>
            <ChevronArrow />
            {projectSlug ? (
              <span className="inline-flex items-center gap-1 typo-caption text-foreground">
                <Shield className="w-3 h-3 text-red-400" />
                <span className="font-mono">{orgSlug ? `${orgSlug}/${projectSlug}` : projectSlug}</span>
              </span>
            ) : (
              <span className="typo-caption text-amber-400"><DebtText k="auto_no_project_slug_131aaa6d" /></span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sentry org + project picker (re-link UI)
// ---------------------------------------------------------------------------

export function SentryProjectPicker({
  credentials,
  projectId,
  onLinked,
}: {
  credentials: PersonaCredential[];
  projectId: string;
  onLinked: () => void;
}) {
  const { t, tx } = useTranslation();
  const po = t.project_overview;
  const addToast = useToastStore((s) => s.addToast);

  const [selectedCredId, setSelectedCredId] = useState(credentials[0]?.id ?? '');
  const [orgs, setOrgs] = useState<SentryOrg[]>([]);
  const [orgSlug, setOrgSlug] = useState('');
  const [projects, setProjects] = useState<SentryProject[]>([]);
  const [projectSlug, setProjectSlug] = useState('');
  const [loadingOrgs, setLoadingOrgs] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setOrgs([]); setOrgSlug(''); setProjects([]); setProjectSlug('');
    setDiscoveryError(null); setManualMode(false);
  }, [selectedCredId]);

  useEffect(() => {
    if (!selectedCredId || manualMode) return;
    let cancelled = false;
    setLoadingOrgs(true);
    setDiscoveryError(null);
    fetchSentryOrgs(selectedCredId)
      .then((list) => {
        if (cancelled) return;
        setOrgs(list);
        if (list.length === 1 && list[0]) setOrgSlug(list[0].slug);
      })
      .catch((err) => {
        if (cancelled) return;
        setDiscoveryError(formatErr(err));
        setManualMode(true);
      })
      .finally(() => { if (!cancelled) setLoadingOrgs(false); });
    return () => { cancelled = true; };
  }, [selectedCredId, manualMode]);

  useEffect(() => {
    if (!selectedCredId || !orgSlug || manualMode) return;
    let cancelled = false;
    setLoadingProjects(true);
    setProjects([]); setProjectSlug('');
    fetchSentryProjects(selectedCredId, orgSlug)
      .then((list) => { if (!cancelled) setProjects(list); })
      .catch((err) => {
        if (cancelled) return;
        setDiscoveryError(formatErr(err));
        setManualMode(true);
      })
      .finally(() => { if (!cancelled) setLoadingProjects(false); });
    return () => { cancelled = true; };
  }, [selectedCredId, orgSlug, manualMode]);

  const handleSave = async () => {
    if (!selectedCredId || !orgSlug || !projectSlug) return;
    setSaving(true);
    try {
      await updateProject(projectId, {
        monitoringCredentialId: selectedCredId,
        monitoringProjectSlug: `${orgSlug}/${projectSlug}`,
      });
      onLinked();
      addToast(po.monitoring_linked_toast, 'success');
    } catch {
      addToast(po.monitoring_link_failed_toast, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 mt-3">
      <p className="typo-caption text-foreground">{po.link_monitoring}</p>

      {credentials.length > 1 && (
        <div className="space-y-1">
          <label className="typo-caption text-foreground">{po.credential_label}</label>
          <select
            value={selectedCredId}
            onChange={(e) => setSelectedCredId(e.target.value)}
            className="w-full px-3 py-2 typo-caption bg-secondary/40 border border-primary/10 rounded-modal text-foreground"
          >
            {credentials.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {manualMode ? (
        <>
          <div className="space-y-1">
            <label className="typo-caption text-foreground">{po.org_slug_label}</label>
            <input
              value={orgSlug}
              onChange={(e) => setOrgSlug(e.target.value.trim())}
              placeholder="my-org"
              className="w-full px-3 py-2 typo-caption bg-secondary/40 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground/40 focus-ring"
            />
          </div>
          <div className="space-y-1">
            <label className="typo-caption text-foreground">{po.project_slug}</label>
            <input
              value={projectSlug}
              onChange={(e) => setProjectSlug(e.target.value.trim())}
              placeholder="my-project"
              className="w-full px-3 py-2 typo-caption bg-secondary/40 border border-primary/10 rounded-modal text-foreground placeholder:text-foreground/40 focus-ring"
            />
          </div>
        </>
      ) : (
        <>
          <div className="space-y-1">
            <label className="typo-caption text-foreground">{po.org_label}</label>
            <select
              value={orgSlug}
              onChange={(e) => setOrgSlug(e.target.value)}
              disabled={loadingOrgs || orgs.length === 0}
              className="w-full px-3 py-2 typo-caption bg-secondary/40 border border-primary/10 rounded-modal text-foreground disabled:opacity-60"
            >
              <option value="" disabled>
                {loadingOrgs ? po.discovering_orgs : orgs.length === 0 ? po.no_orgs_found : po.select_organization}
              </option>
              {orgs.map((o) => (
                <option key={o.slug} value={o.slug}>{o.name} ({o.slug})</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="typo-caption text-foreground">{po.project_label}</label>
            <select
              value={projectSlug}
              onChange={(e) => setProjectSlug(e.target.value)}
              disabled={loadingProjects || !orgSlug || projects.length === 0}
              className="w-full px-3 py-2 typo-caption bg-secondary/40 border border-primary/10 rounded-modal text-foreground disabled:opacity-60"
            >
              <option value="" disabled>
                {!orgSlug ? po.pick_org_first : loadingProjects ? po.loading_projects : projects.length === 0 ? po.no_projects_in_org : po.select_project_option}
              </option>
              {projects.map((p) => (
                <option key={p.slug} value={p.slug}>{p.name} ({p.slug})</option>
              ))}
            </select>
          </div>
        </>
      )}

      {discoveryError && (
        <div className="flex items-start gap-2 p-2 rounded-modal bg-red-500/5 border border-red-500/15">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="typo-caption text-foreground break-words">
              {tx(po.sentry_discovery_failed, { error: discoveryError })}
            </p>
            <p className="typo-caption text-foreground mt-1">
              <DebtText k="auto_enter_the_slugs_manually_below_find_them_i_79cccef5" /> <span className="font-mono"><DebtText k="auto_sentry_io_organizations_e9447370" /><b>your-org</b><DebtText k="auto_projects_efa335ad" /><b>your-project</b>/</span>
            </p>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          setManualMode((m) => !m);
          setDiscoveryError(null);
          setOrgSlug(''); setProjectSlug('');
        }}
        className="typo-caption text-foreground hover:text-foreground underline-offset-2 hover:underline"
      >
        {manualMode ? po.try_auto_discovery : po.enter_slugs_manually}
      </button>

      <div className="flex justify-end">
        <Button
          variant="accent"
          accentColor="emerald"
          size="sm"
          icon={<Save className="w-3 h-3" />}
          onClick={handleSave}
          loading={saving}
          disabled={!orgSlug || !projectSlug}
        >
          {po.save}
        </Button>
      </div>
    </div>
  );
}
