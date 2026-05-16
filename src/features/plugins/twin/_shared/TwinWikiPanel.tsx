import { useState } from 'react';
import { ScrollText, ShieldCheck, Copy, Loader2, ChevronDown, ChevronUp } from 'lucide-react';

import * as twinApi from '@/api/twin/twin';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import type { TwinWikiCompileResult } from '@/lib/bindings/TwinWikiCompileResult';
import type { TwinPendingMemory } from '@/lib/bindings/TwinPendingMemory';

/**
 * Surfaces the `twin_compile_wiki` + `twin_audit_wiki` backend commands.
 * Compile generates a folder of cross-linked markdown files under the app
 * data dir; audit produces a high-priority pending memory with a wiki
 * health report (Healthy / Needs Attention / Critical).
 *
 * Mounted at the top of the Knowledge sub-tabs, collapsible to stay out of
 * the way when not in use. The freshness summary lives on TwinSelector via
 * WikiFreshnessPill — this panel is for the deep audit + re-compile flow.
 */
export function TwinWikiPanel({ activeTwinId }: { activeTwinId: string | null }) {
  const { t: tFull, tx } = useTranslation();
  const t = tFull.twin;
  const addToast = useToastStore((s) => s.addToast);

  const [open, setOpen] = useState(false);
  const [compileLoading, setCompileLoading] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [compiled, setCompiled] = useState<TwinWikiCompileResult | null>(null);
  const [auditMemory, setAuditMemory] = useState<TwinPendingMemory | null>(null);

  const handleCompile = async () => {
    if (!activeTwinId) return;
    setCompileLoading(true);
    setAuditMemory(null);
    try {
      const out = await twinApi.compileWiki(activeTwinId);
      setCompiled(out);
      addToast(tx(t.wiki.freshness.compiledToast, { count: out.fileCount }), 'success');
    } catch (e) {
      toastCatch('twin:compile-wiki')(e);
    } finally {
      setCompileLoading(false);
    }
  };

  const handleAudit = async () => {
    if (!activeTwinId) return;
    setAuditLoading(true);
    try {
      const out = await twinApi.auditWiki(activeTwinId);
      setAuditMemory(out);
    } catch (e) {
      toastCatch('twin:audit-wiki')(e);
    } finally {
      setAuditLoading(false);
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      addToast(t.wiki.copied, 'success');
    } catch (err) {
      silentCatch('twin:wiki-copy')(err);
    }
  };

  if (!activeTwinId) return null;

  return (
    <div className="mx-4 md:mx-6 xl:mx-8 my-3 rounded-card border border-violet-500/20 bg-violet-500/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-violet-500/8 transition-colors rounded-card"
      >
        <ScrollText className="w-4 h-4 text-violet-300 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="typo-card-label text-foreground/95">{t.wiki.title}</p>
          <p className="typo-caption text-foreground/65">{t.wiki.subtitle}</p>
        </div>
        {open ? (
          <ChevronUp className="w-4 h-4 text-foreground/55" />
        ) : (
          <ChevronDown className="w-4 h-4 text-foreground/55" />
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-violet-500/15">
            <Button
              size="sm"
              variant="accent"
              accentColor="violet"
              onClick={handleCompile}
              disabled={compileLoading}
            >
              {compileLoading ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <ScrollText className="w-3.5 h-3.5 mr-1.5" />
              )}
              {compileLoading ? t.wiki.compiling : t.wiki.compileCta}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleAudit}
              disabled={auditLoading || !compiled}
              title={!compiled ? t.wiki.auditNeedsCompile : undefined}
            >
              {auditLoading ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5 mr-1.5" />
              )}
              {auditLoading ? t.wiki.auditing : t.wiki.auditCta}
            </Button>
          </div>

          {compiled && (
            <section>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-foreground/55 font-medium">{t.wiki.compiledLabel}</p>
                <button
                  type="button"
                  onClick={() => handleCopy(compiled.dirPath)}
                  className="flex items-center gap-1 text-[11px] text-foreground/65 hover:text-violet-300 transition-colors"
                >
                  <Copy className="w-3 h-3" /> {t.wiki.copyPath}
                </button>
              </div>
              <div className="rounded-interactive border border-violet-500/15 bg-background/60 px-3 py-2 space-y-1">
                <p className="typo-caption text-foreground">
                  {tx(t.wiki.compiledSummary, { count: compiled.fileCount })}
                </p>
                <p className="font-mono text-[11px] text-foreground/60 break-all">{compiled.dirPath}</p>
              </div>
            </section>
          )}

          {auditMemory && (
            <section>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-foreground/55 font-medium">{t.wiki.auditReportLabel}</p>
                <button
                  type="button"
                  onClick={() => handleCopy(auditMemory.content)}
                  className="flex items-center gap-1 text-[11px] text-foreground/65 hover:text-violet-300 transition-colors"
                >
                  <Copy className="w-3 h-3" /> {t.wiki.copy}
                </button>
              </div>
              <pre className="rounded-interactive border border-amber-500/20 bg-amber-500/5 p-3 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground/85">
                {auditMemory.content}
              </pre>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
