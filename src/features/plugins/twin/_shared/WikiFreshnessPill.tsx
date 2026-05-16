import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, ScrollText } from 'lucide-react';
import * as twinApi from '@/api/twin/twin';
import { useTranslation, type Translations } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import type { TwinWikiStatus } from '@/lib/bindings/TwinWikiStatus';

/**
 * Freshness pill rendered in TwinSelector for the active twin. Surfaces the
 * previously-buried `twin_compile_wiki` / `twin_wiki_status` commands as a
 * persistent affordance so the user can see at-a-glance whether the wiki is
 * fresh, stale, or never compiled — and recompile from one click.
 *
 * Click recompiles in place; tooltip shows the on-disk path + file count.
 * Never blocks the rest of the banner — a compile failure shows a toast.
 */

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

interface Props {
  twinId: string;
}

type State =
  | { kind: 'loading' }
  | { kind: 'compiling' }
  | { kind: 'never' }
  | { kind: 'fresh'; at: string; fileCount: number; dirPath: string }
  | { kind: 'stale'; at: string; fileCount: number; dirPath: string };

function classify(status: TwinWikiStatus, now = Date.now()): State {
  if (!status.exists || !status.lastCompiledAt) return { kind: 'never' };
  const at = status.lastCompiledAt;
  const ageMs = now - new Date(at).getTime();
  const shape = { at, fileCount: status.fileCount, dirPath: status.dirPath };
  return ageMs > STALE_AFTER_MS ? { kind: 'stale', ...shape } : { kind: 'fresh', ...shape };
}

function relativeKey(at: string, now: number): { key: 'justNow' | 'minutesAgo' | 'hoursAgo' | 'daysAgo'; count: number } {
  const ms = Math.max(0, now - new Date(at).getTime());
  if (ms < 60_000) return { key: 'justNow', count: 0 };
  if (ms < 3_600_000) return { key: 'minutesAgo', count: Math.max(1, Math.round(ms / 60_000)) };
  if (ms < 86_400_000) return { key: 'hoursAgo', count: Math.max(1, Math.round(ms / 3_600_000)) };
  return { key: 'daysAgo', count: Math.max(1, Math.round(ms / 86_400_000)) };
}

function renderRelative(
  t: Translations,
  tx: (template: string, vars: Record<string, string | number>) => string,
  at: string,
): string {
  const { key, count } = relativeKey(at, Date.now());
  if (key === 'justNow') return t.twin.wiki.freshness.justNow;
  return tx(t.twin.wiki.freshness[key], { count });
}

export function WikiFreshnessPill({ twinId }: Props) {
  const { t, tx } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const status = await twinApi.wikiStatus(twinId);
      if (!mountedRef.current) return;
      setState(classify(status));
    } catch (e) {
      if (!mountedRef.current) return;
      setState({ kind: 'never' });
      toastCatch('twin:wiki-status')(e);
    }
  }, [twinId]);

  useEffect(() => {
    setState({ kind: 'loading' });
    void fetchStatus();
  }, [fetchStatus]);

  const onCompile = async () => {
    setState({ kind: 'compiling' });
    try {
      const result = await twinApi.compileWiki(twinId);
      if (!mountedRef.current) return;
      addToast(tx(t.twin.wiki.freshness.compiledToast, { count: result.fileCount }), 'success');
      await fetchStatus();
    } catch (e) {
      toastCatch('twin:compile-wiki')(e);
      if (mountedRef.current) await fetchStatus();
    }
  };

  // Pre-resolve presentation per state so the button can be rendered uniformly.
  let label: string;
  let title: string;
  let cls: string;
  let busy = false;
  let icon = <ScrollText className="w-3 h-3" />;

  switch (state.kind) {
    case 'loading':
      label = t.twin.wiki.freshness.loading;
      title = t.twin.wiki.freshness.loading;
      cls = 'bg-secondary/40 text-foreground border-primary/10';
      icon = <Loader2 className="w-3 h-3 animate-spin" />;
      busy = true;
      break;
    case 'compiling':
      label = t.twin.wiki.freshness.compiling;
      title = t.twin.wiki.freshness.compiling;
      cls = 'bg-violet-500/10 text-violet-300 border-violet-500/25';
      icon = <Loader2 className="w-3 h-3 animate-spin" />;
      busy = true;
      break;
    case 'never':
      label = t.twin.wiki.freshness.never;
      title = t.twin.wiki.freshness.neverTooltip;
      cls = 'bg-secondary/40 text-foreground border-primary/10 hover:bg-secondary/60';
      break;
    case 'fresh':
      label = tx(t.twin.wiki.freshness.fresh, { rel: renderRelative(t, tx, state.at) });
      title = tx(t.twin.wiki.freshness.freshTooltip, {
        count: state.fileCount,
        rel: renderRelative(t, tx, state.at),
        path: state.dirPath,
      });
      cls = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25 hover:bg-emerald-500/15';
      icon = <ScrollText className="w-3 h-3" />;
      break;
    case 'stale':
      label = tx(t.twin.wiki.freshness.stale, { rel: renderRelative(t, tx, state.at) });
      title = tx(t.twin.wiki.freshness.staleTooltip, {
        count: state.fileCount,
        rel: renderRelative(t, tx, state.at),
        path: state.dirPath,
      });
      cls = 'bg-amber-500/10 text-amber-400 border-amber-500/25 hover:bg-amber-500/15';
      icon = <RefreshCw className="w-3 h-3" />;
      break;
  }

  return (
    <button
      type="button"
      onClick={busy ? undefined : onCompile}
      disabled={busy}
      title={title}
      aria-label={title}
      className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium border transition-colors focus-ring disabled:cursor-wait ${cls}`}
    >
      {icon}
      <span className="truncate max-w-[120px]">{label}</span>
    </button>
  );
}
