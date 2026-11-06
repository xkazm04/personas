// P1 — scan-to-offer. A per-project standards-scan affordance on the cover: runs
// the golden-standard LLM scan, then surfaces each open finding as a one-click
// fix — an instant Tier-0 config toggle where it maps, otherwise "Fix with
// Claude" (the finding's recommendation becomes the task prompt). Portalled so
// the matrix's overflow never clips it.
import { useCallback, useEffect, useState } from 'react';
import Button from '@/features/shared/components/buttons/Button';
import { createPortal } from 'react-dom';
import { ShieldCheck, ScanSearch, X, Rocket } from 'lucide-react';

import { listStandards, runStandardsScan } from '@/api/devTools/devTools';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { useTypedTauriEvent } from '@/hooks/useTauriEvent';
import { EventName } from '@/lib/eventRegistry';
import type { DevStandard } from '@/lib/bindings/DevStandard';
import { derivePassportFromMetadata } from '../passportDerive';
import { useImprove } from './ImproveContext';
import { useAnchoredPopover } from './useAnchoredPopover';
import { findingPrompt, openFindings, compliancePct } from './findingFix';

const WIDTH = 326;
const SEV_COLOR: Record<string, string> = { critical: 'var(--destructive)', warn: 'var(--warning, #eab308)', info: 'var(--muted-foreground)' };

export function StandardsScan({ slug, projectName }: { slug: string; projectName: string }) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return (
    <>
      <Button variant="ghost" size="icon-sm" className="flex-shrink-0" onClick={(e) => { e.stopPropagation(); setAnchor(e.currentTarget.getBoundingClientRect()); setOpen(true); }} tooltip={d.improve_std_tooltip} aria-label={d.improve_std_aria}>
        <ShieldCheck className="w-3.5 h-3.5" aria-hidden />
      </Button>
      {open && <FindingsPopover slug={slug} projectName={projectName} anchor={anchor} onClose={() => setOpen(false)} />}
    </>
  );
}

export function FindingsPopover({ slug, projectName, anchor, onClose }: { slug: string; projectName: string; anchor: DOMRect | null; onClose: () => void }) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const engine = useImprove();
  const addToast = useToastStore((s) => s.addToast);
  const [findings, setFindings] = useState<DevStandard[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [fixed, setFixed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const raw = engine?.getRaw(slug);
  const passport = raw ? derivePassportFromMetadata(raw.meta, raw.project, { hasSkills: raw.hasSkills, evidence: raw.evidence }) : null;

  // initial fetch
  useEffect(() => {
    listStandards(slug).then(setFindings).catch((err) => { silentCatch('StandardsScan:listStandards')(err); setFindings([]); });
  }, [slug]);

  // scan lifecycle: listen for completion → refetch
  const onScanStatus = useCallback((payload: { project_id?: string; status?: string }) => {
    if (payload?.project_id !== slug) return;
    if (payload.status === 'complete' || payload.status === 'error') {
      setScanning(false);
      listStandards(slug).then(setFindings).catch(silentCatch('StandardsScan:rescanListStandards'));
    }
  }, [slug]);
  useTypedTauriEvent(EventName.STANDARDS_SCAN_STATUS, onScanStatus, 'StandardsScan:listen');

  const { panelRef, style: popStyle } = useAnchoredPopover({ anchor, width: WIDTH, onClose, active: !!engine && !!raw && !!passport && !!anchor, layoutKey: `${findings?.length ?? -1}:${scanning}` });

  if (!engine || !raw || !passport || !anchor) return null;

  const scan = async () => {
    setScanning(true);
    try { await runStandardsScan(slug); } catch { setScanning(false); addToast(d.improve_toast_std_scan_failed, 'error'); }
  };

  const claudeFix = async (f: DevStandard) => {
    setBusy(f.id);
    try {
      await engine.queueTask(slug, f.title, findingPrompt(f, passport));
      setFixed((p) => new Set(p).add(f.id));
      addToast(tx(d.improve_toast_fix_queued, { title: f.title }), 'success');
    } catch { addToast(d.improve_toast_fix_failed, 'error'); } finally { setBusy(null); }
  };

  const open = findings ? openFindings(findings).filter((f) => !fixed.has(f.id)) : [];
  const pct = findings ? compliancePct(findings) : null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      tabIndex={-1}
      aria-label={tx(d.improve_std_panel_aria, { name: projectName })}
      style={popStyle(anchor)}
      className="fixed z-[9995] outline-none rounded-modal border border-hair bg-background shadow-elevation-4 overflow-hidden"
    >
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-hair bg-surface-1">
        <ShieldCheck className="w-3.5 h-3.5 text-primary flex-shrink-0" aria-hidden />
        <span className="typo-caption text-ink-2 truncate">{tx(d.improve_std_title, { name: projectName })}</span>
        {pct !== null && <span className="typo-data text-ink-3 ml-auto">{pct}%</span>}
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t.common.close}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      {findings === null ? (
        <p className="px-3 py-5 typo-caption text-ink-3 text-center">{t.common.loading}</p>
      ) : open.length === 0 ? (
        <div className="px-3 py-5 text-center space-y-2">
          <p className="typo-caption text-ink-2">{scanning ? d.improve_std_scanning : findings.length === 0 ? d.improve_std_no_scan : d.improve_std_no_open}</p>
          {!scanning && (
            <Button variant="secondary" size="sm" onClick={scan} icon={<ScanSearch className="w-3 h-3" />}>
{findings.length === 0 ? d.improve_std_run_scan : d.improve_std_rescan}
</Button>
          )}
        </div>
      ) : (
        <>
          <ul className="max-h-72 overflow-y-auto p-1.5 space-y-1">
            {open.map((f) => (
              <li key={f.id} className="rounded-interactive border border-hair bg-secondary/15 px-2 py-1.5">
                <div className="flex items-start gap-2">
                  <span className="mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: SEV_COLOR[f.severity] ?? SEV_COLOR.info }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <span className="typo-caption text-ink-2 block">{f.title}</span>
                    {f.recommendation && <span className="typo-caption text-ink-3 block" style={{ fontWeight: 400 }}>{f.recommendation}</span>}
                  </div>
                </div>
                <div className="flex items-center justify-end mt-1.5">
                  <Button variant="secondary" size="xs" onClick={() => claudeFix(f)} disabled={busy === f.id} icon={<Rocket className="w-3 h-3" />}>
{busy === f.id ? '…' : d.improve_std_fix}
</Button>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-hair bg-surface-1">
            <span className="typo-caption text-ink-3">{tx(d.improve_std_open_count, { count: open.length })}</span>
            <Button variant="secondary" size="xs" onClick={scan} disabled={scanning} icon={<ScanSearch className="w-3 h-3" />}>
{scanning ? d.improve_std_scanning_btn : d.improve_std_rescan}
</Button>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}
