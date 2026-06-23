// P2 connector-wire section, rendered inside the deploy popover for connector-
// backed rows (Observability). Reads the user's vault, shows the credentials that
// satisfy the row's connector category with a live health dot, and lets them bind
// a healthy one (→ re-derives readiness instantly). If none exist, it routes them
// to the Vault to add an API key first.
import { useEffect, useState } from 'react';
import { Plug, ExternalLink } from 'lucide-react';

import { listCredentials, healthcheckCredential } from '@/api/vault/credentials';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import { useImprove } from './ImproveContext';
import { connectorSpecFor, candidateCredentials } from './connectors';

export function ConnectorSection({ slug, rowKey, onClose }: { slug: string; rowKey: string; onClose: () => void }) {
  const engine = useImprove();
  const addToast = useToastStore((s) => s.addToast);
  const spec = connectorSpecFor(rowKey);
  const [candidates, setCandidates] = useState<PersonaCredential[] | null>(null);
  const [health, setHealth] = useState<Record<string, boolean | null>>({});
  const [binding, setBinding] = useState<string | null>(null);

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

  return (
    <div className="rounded-interactive border border-primary/10 bg-secondary/15 p-2">
      <div className="flex items-start gap-2">
        <Plug className="w-3.5 h-3.5 mt-0.5 text-primary/70 flex-shrink-0" aria-hidden />
        <div className="min-w-0">
          <span className="typo-caption font-medium text-foreground block">Connect a {spec.categoryLabel} tool</span>
          <span className="typo-caption text-foreground/55 block leading-snug" style={{ fontWeight: 400 }}>Bind a healthy connector from your vault → readiness re-derives instantly.</span>
        </div>
      </div>

      {candidates === null ? (
        <p className="typo-caption text-foreground/55 mt-2">Checking your vault…</p>
      ) : candidates.length === 0 ? (
        <button type="button" onClick={openVault} className="mt-2 inline-flex items-center gap-1 typo-caption text-primary hover:underline">
          <ExternalLink className="w-3 h-3" /> No connector yet — add one in the Vault first
        </button>
      ) : (
        <ul className="mt-2 space-y-1">
          {candidates.map((c) => {
            const h = health[c.id];
            return (
              <li key={c.id} className="flex items-center gap-2">
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  title={h === true ? 'Healthy' : h === false ? 'Unhealthy — check in Vault' : 'Checking…'}
                  style={{ background: h === true ? '#10b981' : h === false ? 'var(--destructive)' : 'var(--muted-foreground)' }}
                />
                <span className="typo-caption text-foreground min-w-0 flex-1 truncate">{c.name}</span>
                <button type="button" onClick={() => connect(c)} disabled={binding === c.id} className="px-2 py-0.5 rounded-interactive typo-caption font-medium text-primary bg-primary/15 hover:bg-primary/25 border border-primary/25 transition-colors disabled:opacity-50">
                  {binding === c.id ? '…' : 'Connect'}
                </button>
              </li>
            );
          })}
          <li>
            <button type="button" onClick={openVault} className="inline-flex items-center gap-1 typo-caption text-foreground/55 hover:text-foreground mt-0.5">
              <ExternalLink className="w-3 h-3" /> Add another in the Vault
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
