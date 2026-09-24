import { useEffect, useState } from 'react';
import { Film, ImageOff } from 'lucide-react';

import { readCouncilMedia } from '@/api/devTools/council';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

import type { CockpitWidgetProps } from '../widgetRegistry';

/**
 * `council_media` - a screenshot or a recording a council member staged as
 * evidence, read out of the run directory it was written into.
 *
 * APP-COMPOSED ONLY. Unlike every other kind in this registry, this one is
 * NOT in Athena's constitution and NOT in any Rust op allowlist, and it must
 * not be added to either: the only composer is `composeCouncilEvidence`,
 * which builds it deterministically from a verdict's own `evidence[]`. A
 * model that could emit this kind could point it at an arbitrary path inside
 * a run directory, which is precisely the door the ingest side was built to
 * be the only one of.
 *
 * Config:
 *   {
 *     "runId":   "…",            // which run's directory to read from
 *     "relPath": "evidence/x.mp4",// path INSIDE that directory; the Rust door confines it
 *     "media":   "video" | "screenshot",
 *     "caption": "…"
 *   }
 *
 * The bytes come back over IPC and become an object URL, exactly as
 * `drive/finder/quicklook/useEntryMedia.ts:78-91` does it, revoked on
 * cleanup. A file the run recorded but that is not on disk renders a
 * labelled placeholder frame, never a broken image.
 */
export function CouncilMediaWidget({ config, title }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const e = t.council.evidence;
  const runId = typeof config?.runId === 'string' ? config.runId : null;
  const relPath = typeof config?.relPath === 'string' ? config.relPath : null;
  const isVideo = config?.media === 'video';
  const caption = typeof config?.caption === 'string' ? config.caption : '';

  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!runId || !relPath) {
      setState('missing');
      return;
    }
    let cancelled = false;
    let owned: string | null = null;
    setState('loading');
    setUrl(null);
    readCouncilMedia(runId, relPath)
      .then((media) => {
        if (cancelled) return;
        const blob = new Blob([new Uint8Array(media.bytes)], {
          type: media.mime || 'application/octet-stream',
        });
        const objectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        owned = objectUrl;
        setUrl(objectUrl);
        setState('ready');
      })
      .catch((err) => {
        silentCatch('council:media')(err);
        // A missing file is a normal, honest outcome here: the run recorded
        // a path, the file is not there. It is not an error toast.
        if (!cancelled) setState('missing');
      });
    return () => {
      cancelled = true;
      if (owned) URL.revokeObjectURL(owned);
    };
  }, [runId, relPath]);

  return (
    <figure className="m-0 flex h-full min-h-0 flex-col gap-2 rounded-card border border-foreground/10 bg-foreground/[0.02] p-4">
      <figcaption className="typo-caption uppercase tracking-wide text-foreground">
        {title ?? e.media_title}
      </figcaption>
      <div className="min-h-0 flex-1 overflow-hidden rounded-input">
        {state === 'ready' && url ? (
          isVideo ? (
            // Keyed on the src: a swapped source on a live media element keeps
            // the old buffer otherwise (census `media-element-src-without-remount-key`).
            <video key={url} src={url} controls className="h-full w-full object-contain" />
          ) : (
            <img key={url} src={url} alt={caption || e.media_title} className="h-full w-full object-contain" />
          )
        ) : (
          <Placeholder
            loading={state === 'loading'}
            isVideo={isVideo}
            loadingLabel={e.media_loading}
            missingLabel={e.media_missing}
            path={relPath ?? ''}
          />
        )}
      </div>
      {caption ? <p className="m-0 typo-caption text-muted">{caption}</p> : null}
    </figure>
  );
}

function Placeholder({
  loading,
  isVideo,
  loadingLabel,
  missingLabel,
  path,
}: {
  loading: boolean;
  isVideo: boolean;
  loadingLabel: string;
  missingLabel: string;
  path: string;
}) {
  const Icon = isVideo ? Film : ImageOff;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-input border border-dashed border-border bg-[repeating-linear-gradient(135deg,var(--card-bg)_0_10px,transparent_10px_20px)] px-3 text-center">
      <Icon className="h-6 w-6 text-muted-dark" aria-hidden="true" />
      <span className="typo-caption text-muted">{loading ? loadingLabel : missingLabel}</span>
      {!loading && path ? (
        <span className="font-mono typo-caption text-muted-dark break-all">{path}</span>
      ) : null}
    </div>
  );
}

export default CouncilMediaWidget;
