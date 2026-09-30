import { useEffect, useState } from 'react';
import { Tile } from '@/features/shared/components/kit';
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
 * cleanup. One kit Tile: the frame takes the media's own aspect at the
 * tile's width (no letterbox), a read in flight is the tile's ghost, and a
 * file the run recorded but that is not on disk is the tile's empty band
 * naming the path, never a broken image.
 */
export function CouncilMediaWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t, tx } = useTranslation();
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

  const heading = title ?? e.media_title;
  // The evidence well titles a media tile with its caption: say it once.
  const showCaption = caption && caption !== heading;
  return (
    <Tile
      span={span}
      title={heading}
      actions={actions}
      footer={footer}
      state={state === 'loading' ? 'loading' : state === 'missing' ? 'empty' : undefined}
      ghostRows={2}
      empty={{
        title: e.media_missing,
        hint: relPath ? <span className="typo-code break-all">{relPath}</span> : undefined,
        markLabel: e.media_missing,
      }}
      testId="cockpit-council-media"
    >
      {url && (
        <figure className="k-in m-0 flex flex-col gap-2">
          {isVideo ? (
            // Keyed on the src: a swapped source on a live media element keeps
            // the old buffer otherwise (census `media-element-src-without-remount-key`).
            <video key={url} src={url} controls className="block h-auto w-full rounded-input" />
          ) : (
            <img key={url} src={url} alt={caption ? tx(e.media_alt, { caption }) : e.media_title} className="block h-auto w-full rounded-input" />
          )}
          {showCaption ? <figcaption className="typo-caption">{caption}</figcaption> : null}
        </figure>
      )}
    </Tile>
  );
}

export default CouncilMediaWidget;
