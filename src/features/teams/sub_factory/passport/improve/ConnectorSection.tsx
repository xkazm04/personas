// P2 connector-wire section, rendered inside the deploy popover for connector-
// backed rows (Observability / monitoring / LLM tracking). Represents the row's
// supported tools as an ICON GRID drawn from our connector catalog: each tool is
// shown enabled (a healthy credential exists in the vault → click to wire it and
// re-derive readiness) or disabled (not connected yet → click routes to the Vault
// to add one). Reads the user's vault + a live health dot per connected tool.
import { useEffect, useMemo, useState } from 'react';
import { Plug, ExternalLink } from 'lucide-react';

import { listCredentials, healthcheckCredential } from '@/api/vault/credentials';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { ThemedConnectorIcon, getConnectorMeta } from '@/lib/connectors/connectorMeta';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import { useImprove } from './ImproveContext';
import { connectorSpecFor, candidateCredentials, catalogToolsFor, type CatalogTool } from './connectors';

export function ConnectorSection({ slug, rowKey, onClose }: { slug: string; rowKey: string; onClose: () => void }) {
  const engine = useImprove();
  const addToast = useToastStore((s) => s.addToast);
  const spec = connectorSpecFor(rowKey);
  const [candidates, setCandidates] = useState<PersonaCredential[] | null>(null);
  const [health, setHealth] = useState<Record<string, boolean | null>>({});
  const [binding, setBinding] = useState<string | null>(null);

  const tools = useMemo(() => (spec ? catalogToolsFor(spec) : []), [spec]);

  useEffect(() => {
    if (!spec) return;
    let cancelled = false;
    listCredentials()
      .then((creds) => {
        if (cancelled) return;
        const cands = candidateCredentials(creds, spec);
        setCandidates(cands);
        cands.forEach((c) => {
          healthcheckCredential(c.id)
            .then((r) => { if (!cancelled) setHealth((h) => ({ ...h, [c.id]: r.success })); })
            .catch(() => { if (!cancelled) setHealth((h) => ({ ...h, [c.id]: false })); });
        });
      })
      .catch(() => { if (!cancelled) setCandidates([]); });
    return () => { cancelled = true; };
  }, [spec]);

  if (!engine || !spec) return null;

  // First vault credential that satisfies a given tool (matched by serviceType).
  const credFor = (tool: CatalogTool): PersonaCredential | undefined =>
    (candidates ?? []).find((c) => c.serviceType.toLowerCase() === tool.name.toLowerCase());

  const connect = async (c: PersonaCredential) => {
    setBinding(c.id);
    try {
      await engine.bindConnector(slug, c.id, spec.bindField);
      addToast(`Connected ${c.name}`, 'success');
      onClose();
    } catch {
      addToast('Couldn’t connect the credential', 'error');
    } finally {
      setBinding(null);
    }
  };

  const openVault = () => { useSystemStore.getState().setSidebarSection('credentials'); onClose(); };

  const loading = candidates === null;

  return (
    <div className="rounded-interactive border border-primary/10 bg-secondary/15 p-2">
      <div className="flex items-start gap-2">
        <Plug className="w-3.5 h-3.5 mt-0.5 text-primary/70 flex-shrink-0" aria-hidden />
        <div className="min-w-0">
          <span className="typo-caption font-medium text-foreground block">Connect a {spec.categoryLabel} tool</span>
          <span className="typo-caption text-foreground/55 block leading-snug" style={{ fontWeight: 400 }}>Lit tiles are connected in your vault — click to wire one. Dimmed tiles aren’t set up yet.</span>
        </div>
      </div>

      {loading ? (
        <p className="typo-caption text-foreground/55 mt-2">Checking your vault…</p>
      ) : tools.length === 0 ? (
        <button type="button" onClick={openVault} className="mt-2 inline-flex items-center gap-1 typo-caption text-primary hover:underline">
          <ExternalLink className="w-3 h-3" /> Add a connector in the Vault first
        </button>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tools.map((tool) => {
              const cred = credFor(tool);
              const enabled = Boolean(cred);
              const h = cred ? health[cred.id] : undefined;
              const meta = getConnectorMeta(tool.name);
              const iconUrl = tool.iconUrl ?? meta.iconUrl;
              const color = tool.color ?? meta.color;
              const Fallback = meta.Icon;
              const status = enabled
                ? (h === true ? 'Connected · healthy' : h === false ? 'Connected · unhealthy — check in Vault' : 'Connected · checking…')
                : 'Not connected — add in the Vault';
              return (
                <Tooltip key={tool.name} content={`${tool.label} — ${status}`}>
                  <button
                    type="button"
                    onClick={() => (enabled && cred ? connect(cred) : openVault())}
                    disabled={enabled && cred ? binding === cred.id : false}
                    aria-label={`${tool.label} — ${status}`}
                    className={`group/tool relative flex flex-col items-center gap-1 w-[4.25rem] px-1.5 py-2 rounded-interactive border transition-colors disabled:opacity-50 ${
                      enabled
                        ? 'border-primary/25 bg-primary/[0.07] hover:bg-primary/[0.14]'
                        : 'border-primary/10 bg-secondary/10 opacity-55 hover:opacity-100 hover:bg-secondary/25'
                    }`}
                  >
                    {enabled && (
                      <span
                        className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
                        style={{ background: h === true ? '#10b981' : h === false ? 'var(--destructive)' : 'var(--muted-foreground)' }}
                      />
                    )}
                    {iconUrl
                      ? <ThemedConnectorIcon url={iconUrl} label={tool.label} color={color} size="w-5 h-5" />
                      : <Fallback className="w-5 h-5" style={{ color }} />}
                    <span className="typo-label text-foreground/70 w-full truncate text-center leading-none">{tool.label}</span>
                  </button>
                </Tooltip>
              );
            })}
          </div>
          <button type="button" onClick={openVault} className="inline-flex items-center gap-1 typo-caption text-foreground/55 hover:text-foreground mt-2">
            <ExternalLink className="w-3 h-3" /> Manage connectors in the Vault
          </button>
        </>
      )}
    </div>
  );
}
