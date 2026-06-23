// P1 — scan-to-offer. A per-project standards-scan affordance on the cover: runs
// the golden-standard LLM scan, then surfaces each open finding as a one-click
// fix — an instant Tier-0 config toggle where it maps, otherwise "Fix with
// Claude" (the finding's recommendation becomes the task prompt). Portalled so
// the matrix's overflow never clips it.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { listen } from '@tauri-apps/api/event';
import { ShieldCheck, ScanSearch, X, Rocket } from 'lucide-react';

import { listStandards, runStandardsScan } from '@/api/devTools/devTools';
import { useToastStore } from '@/stores/toastStore';
import { silentCatch } from '@/lib/silentCatch';
import type { DevStandard } from '@/lib/bindings/DevStandard';
import { derivePassportFromMetadata } from '../passportDerive';
import { useImprove } from './ImproveContext';
import { findingPrompt, openFindings, compliancePct } from './findingFix';

const WIDTH = 326;
const SEV_COLOR: Record<string, string> = { critical: 'var(--destructive)', warn: 'var(--warning, #eab308)', info: 'var(--muted-foreground)' };

export function StandardsScan({ slug, projectName }: { slug: string; projectName: string }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setAnchor(e.currentTarget.getBoundingClientRect()); setOpen(true); }}
        title="Standards scan & fixes"
        className="inline-flex items-center flex-shrink-0 p-0.5 rounded-interactive text-foreground/45 hover:text-primary hover:bg-primary/[0.06] transition-colors"
        aria-label="Standards scan"
      >
        <ShieldCheck className="w-3.5 h-3.5" aria-hidden />
      </button>
      {open && <FindingsPopover slug={slug} projectName={projectName} anchor={anchor} onClose={() => setOpen(false)} />}
    </>
  );
}

function FindingsPopover({ slug, projectName, anchor, onClose }: { slug: string; projectName: string; anchor: DOMRect | null; onClose: () => void }) {
  const engine = useImprove();
  const addToast = useToastStore((s) => s.addToast);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [findings, setFindings] = useState<DevStandard[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [fixed, setFixed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const raw = engine?.getRaw(slug);
  const passport = raw ? derivePassportFromMetadata(raw.meta, raw.project, { hasSkills: raw.hasSkills, evidence: raw.evidence }) : null;

  // initial fetch
  useEffect(() => {
    listStandards(slug).then(setFindings).catch(() => setFindings([]));
  }, [slug]);

  // scan lifecycle: listen for completion → refetch
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ project_id?: string; status?: string }>('dev_tools_standards_scan_status', (e) => {
      if (e.payload?.project_id !== slug) return;
      if (e.payload.status === 'complete' || e.payload.status === 'error') {
        setScanning(false);
        listStandards(slug).then(setFindings).catch(() => {});
      }
    }).then((f) => { unlisten = f; }).catch(silentCatch('StandardsScan:listen'));
    return () => { unlisten?.(); };
  }, [slug]);

  useLayoutEffect(() => {
    if (!anchor) { setPos(null); return; }
    const panelH = panelRef.current?.offsetHeight ?? 260;
    const spaceBelow = window.innerHeight - anchor.bottom;
    const top = spaceBelow < panelH + 14 && anchor.top > spaceBelow ? Math.max(8, anchor.top - panelH - 6) : anchor.bottom + 6;
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - WIDTH - 8));
    setPos({ top, left });
  }, [anchor, findings, scanning]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose(); };
    window.addEventListener('keydown', onKey);
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => { window.removeEventListener('keydown', onKey); window.clearTimeout(id); document.removeEventListener('mousedown', onDown); };
  }, [onClose]);

  if (!engine || !raw || !passport || !anchor) return null;

  const scan = async () => {
    setScanning(true);
    try { await runStandardsScan(slug); } catch { setScanning(false); addToast('Couldn’t start standards scan', 'error'); }
  };

  const claudeFix = async (f: DevStandard) => {
    setBusy(f.id);
    try {
      await engine.queueTask(slug, f.title, findingPrompt(f, passport));
      setFixed((p) => new Set(p).add(f.id));
      addToast(`Queued fix: ${f.title}`, 'success');
    } catch { addToast('Couldn’t queue fix', 'error'); } finally { setBusy(null); }
  };

  const open = findings ? openFindings(findings).filter((f) => !fixed.has(f.id)) : [];
  const pct = findings ? compliancePct(findings) : null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`Standards — ${projectName}`}
      style={{ top: pos?.top ?? anchor.bottom + 6, left: pos?.left ?? anchor.left, width: WIDTH, visibility: pos ? 'visible' : 'hidden' }}
      className="fixed z-[9995] rounded-modal border border-primary/15 bg-background shadow-elevation-4 overflow-hidden"
    >
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-primary/10 bg-primary/[0.04]">
        <ShieldCheck className="w-3.5 h-3.5 text-primary flex-shrink-0" aria-hidden />
        <span className="typo-caption font-semibold text-foreground truncate">Standards · {projectName}</span>
        {pct !== null && <span className="typo-caption text-foreground/55 tabular-nums ml-auto">{pct}%</span>}
        <button type="button" onClick={onClose} aria-label="Close" className={`p-0.5 rounded-interactive text-foreground hover:bg-secondary/40 transition-colors ${pct !== null ? '' : 'ml-auto'}`}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {findings === null ? (
        <p className="px-3 py-5 typo-caption text-foreground/55 text-center">Loading…</p>
      ) : open.length === 0 ? (
        <div className="px-3 py-5 text-center space-y-2">
          <p className="typo-caption text-foreground/70">{scanning ? 'Scanning the repo against the golden ruleset…' : findings.length === 0 ? 'No scan yet.' : 'No open findings 🎉'}</p>
          {!scanning && (
            <button type="button" onClick={scan} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-interactive typo-caption font-medium text-primary bg-primary/15 hover:bg-primary/25 border border-primary/25 transition-colors">
              <ScanSearch className="w-3 h-3" /> {findings.length === 0 ? 'Run standards scan' : 'Re-scan'}
            </button>
          )}
        </div>
      ) : (
        <>
          <ul className="max-h-72 overflow-y-auto p-1.5 space-y-1">
            {open.map((f) => (
              <li key={f.id} className="rounded-interactive border border-primary/10 bg-secondary/15 px-2 py-1.5">
                <div className="flex items-start gap-2">
                  <span className="mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: SEV_COLOR[f.severity] ?? SEV_COLOR.info }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <span className="typo-caption font-medium text-foreground block">{f.title}</span>
                    {f.recommendation && <span className="typo-caption text-foreground/55 block leading-snug" style={{ fontWeight: 400 }}>{f.recommendation}</span>}
                  </div>
                </div>
                <div className="flex items-center justify-end mt-1.5">
                  <button type="button" onClick={() => claudeFix(f)} disabled={busy === f.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-interactive typo-caption font-medium text-primary bg-primary/15 hover:bg-primary/25 border border-primary/25 transition-colors disabled:opacity-50">
                    <Rocket className="w-3 h-3" /> {busy === f.id ? '…' : 'Fix with Claude'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-primary/10 bg-secondary/10">
            <span className="typo-caption text-foreground/55">{open.length} open</span>
            <button type="button" onClick={scan} disabled={scanning} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-interactive typo-caption text-foreground hover:bg-secondary/40 border border-primary/10 transition-colors disabled:opacity-50">
              <ScanSearch className="w-3 h-3" /> {scanning ? 'Scanning…' : 'Re-scan'}
            </button>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}
