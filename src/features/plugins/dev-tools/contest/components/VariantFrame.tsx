// One variant's live preview, laid out at a design viewport and scaled to fit,
// with a pin layer for annotating it.
//
// SECURITY: the iframe is `sandbox="allow-scripts"` with NO allow-same-origin,
// so LLM-written code runs in an opaque origin and cannot reach the app. The
// only thing the app accepts from it is the preview route's scroll report,
// and only from THIS iframe's window (`event.source === contentWindow`).
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { MapPin, MonitorOff } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useElementSize } from '@/hooks/utility/interaction/useElementSize';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestPin } from '@/lib/bindings/ContestPin';
import type { ContestVariant } from '@/lib/bindings/ContestVariant';

import {
  DESIGN_HEIGHT,
  DESIGN_WIDTHS,
  fitScale,
  pinFromClick,
  pinToPoint,
  readScrollReport,
  type DesignWidth,
  type PreviewScroll,
} from '../model/pinMath';

export interface VariantFrameProps {
  variant: Pick<ContestVariant, 'key' | 'previewUrl'>;
  /** Existing pins, drawn as numbered markers where they fall in view. */
  pins?: ContestPin[];
  /** Called with a new pin (note included) when the owner confirms one. */
  onAddPin?: (pin: ContestPin) => void;
  /** Controlled pin mode; omit to let the frame own it. */
  pinMode?: boolean;
  onPinModeChange?: (on: boolean) => void;
  /** Controlled design width; omit to let the frame own it (1280). */
  width?: DesignWidth;
  onWidthChange?: (w: DesignWidth) => void;
  /** Thumbnail mode: no controls, no pins, the page cannot be clicked. */
  thumbnail?: boolean;
  /** Render the width + pin-mode controls above the frame (default). A host
   *  that owns them in its own header (controlled width / pinMode) passes false. */
  showControls?: boolean;
  className?: string;
}

interface PendingPin {
  pin: ContestPin;
  x: number;
  y: number;
}

export function VariantFrame({
  variant,
  pins = [],
  onAddPin,
  pinMode: pinModeProp,
  onPinModeChange,
  width: widthProp,
  onWidthChange,
  thumbnail = false,
  showControls = true,
  className = '',
}: VariantFrameProps) {
  const { t, tx } = useTranslation();
  const s = t.plugins.contest;
  const boxRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { width: boxWidth } = useElementSize(boxRef);

  const [ownWidth, setOwnWidth] = useState<DesignWidth>(1280);
  const width = widthProp ?? ownWidth;
  const setWidth = (w: DesignWidth) => (onWidthChange ? onWidthChange(w) : setOwnWidth(w));
  const [ownPinMode, setOwnPinMode] = useState(false);
  const pinMode = !thumbnail && !!onAddPin && (pinModeProp ?? ownPinMode);
  const setPinMode = (on: boolean) => (onPinModeChange ? onPinModeChange(on) : setOwnPinMode(on));

  const [scrollState, setScrollState] = useState<{ tag: string | null; report: PreviewScroll | null }>({
    tag: null,
    report: null,
  });
  // A new page (or width, which reflows it) invalidates the last report.
  const scroll = scrollState.tag === `${variant.previewUrl}@${width}` ? scrollState.report : null;
  const [pending, setPending] = useState<PendingPin | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    const tag = `${variant.previewUrl}@${width}`;
    const onMessage = (event: MessageEvent) => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
      const report = readScrollReport(event.data);
      if (report) setScrollState({ tag, report });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [variant.previewUrl, width]);

  const height = DESIGN_HEIGHT[width];
  const scale = fitScale(boxWidth, width);

  if (!variant.previewUrl) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-primary/15 bg-secondary/10 p-6 text-center ${className}`}
        data-testid={`contest-frame-unavailable-${variant.key}`}
      >
        <MonitorOff className="w-5 h-5 text-foreground" aria-hidden />
        <p className="typo-caption text-foreground">{s.frame_unavailable}</p>
      </div>
    );
  }

  const placed = pins.map((pin, i) => ({ pin, n: i + 1, at: pinToPoint(pin, scale, width, scroll) }));
  const offscreen = placed.filter((p) => p.at === null).length;

  const onCapture = (e: MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setPending({ pin: pinFromClick(x, y, scale, width, scroll), x, y });
    setNote('');
  };

  const confirmPin = () => {
    if (!pending || !onAddPin) return;
    onAddPin({ ...pending.pin, note: note.trim() });
    setPending(null);
    setNote('');
  };

  return (
    <div className={`space-y-2 ${className}`} data-testid={`contest-frame-${variant.key}`}>
      {!thumbnail && showControls && (
        <div className="flex flex-wrap items-center gap-2">
          {/* A toggle group, not a tab strip: the width reflows ONE frame, it
              does not switch between panels. */}
          <div role="group" aria-label={s.frame_width_label} className="inline-flex gap-1">
            {DESIGN_WIDTHS.map((w) => (
              <Button
                key={w}
                size="xs"
                variant={w === width ? 'primary' : 'ghost'}
                aria-pressed={w === width}
                onClick={() => setWidth(w)}
              >
                <span className="font-data">{w}</span>
              </Button>
            ))}
          </div>
          {onAddPin && (
            <Button
              size="xs"
              variant={pinMode ? 'primary' : 'secondary'}
              aria-pressed={pinMode}
              icon={<MapPin className="w-3 h-3" />}
              onClick={() => {
                setPinMode(!pinMode);
                setPending(null);
              }}
              data-testid={`contest-frame-pin-mode-${variant.key}`}
            >
              {s.frame_pin_mode}
            </Button>
          )}
          {pinMode && <span className="typo-caption text-foreground">{s.frame_pin_mode_hint}</span>}
        </div>
      )}

      <div ref={boxRef} className="relative w-full overflow-hidden rounded-card border border-primary/12 bg-background">
        <div style={{ height: height * scale }}>
          <div
            className="origin-top-left"
            style={{ width, height, transform: `scale(${scale})` }}
          >
            <iframe
              key={`${variant.previewUrl}@${width}`}
              ref={iframeRef}
              src={variant.previewUrl}
              sandbox="allow-scripts"
              title={tx(s.frame_iframe_label, { key: variant.key })}
              className={`block border-0 bg-background ${thumbnail ? 'pointer-events-none' : ''}`}
              style={{ width, height }}
            />
          </div>
        </div>

        {pinMode && (
          <button
            type="button"
            aria-label={s.frame_pin_mode_hint}
            onClick={onCapture}
            className="absolute inset-0 cursor-crosshair bg-transparent focus-ring"
            data-testid={`contest-frame-pin-layer-${variant.key}`}
          />
        )}

        {!thumbnail &&
          placed.map(({ pin, n, at }) =>
            at ? (
              <Tooltip key={n} content={tx(s.pin_marker, { n, note: pin.note })}>
                <span
                  className="absolute left-0 top-0 flex h-5 w-5 items-center justify-center rounded-pill bg-primary typo-label text-background shadow-elevation-2"
                  style={{ transform: `translate(${at.x}px, ${at.y}px) translate(-50%, -50%)` }}
                  aria-label={tx(s.pin_marker, { n, note: pin.note })}
                >
                  {n}
                </span>
              </Tooltip>
            ) : null,
          )}

        {pending && pinMode && (
          <div
            className="absolute left-0 top-0 w-56 space-y-1.5 rounded-card border border-primary/20 bg-background p-2 shadow-elevation-3"
            style={{
              transform: `translate(${Math.min(pending.x, Math.max(0, boxWidth - 232))}px, ${pending.y + 8}px)`,
            }}
            data-testid={`contest-frame-pin-editor-${variant.key}`}
          >
            <textarea
              autoFocus
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={s.pin_note_placeholder}
              aria-label={s.pin_note_placeholder}
              className="w-full rounded-input border border-primary/12 bg-background/50 px-2 py-1 typo-body text-foreground focus-ring"
            />
            <div className="flex justify-end gap-1.5">
              <Button size="xs" variant="ghost" onClick={() => setPending(null)}>
                {s.pin_cancel}
              </Button>
              <Button size="xs" variant="primary" onClick={confirmPin} data-testid={`contest-frame-pin-save-${variant.key}`}>
                {s.pin_save}
              </Button>
            </div>
          </div>
        )}
      </div>

      {!thumbnail && (offscreen > 0 || (pinMode && !scroll)) && (
        <div className="space-y-0.5">
          {offscreen > 0 && (
            <p className="typo-caption text-foreground">{tx(s.frame_pins_offscreen, { count: offscreen })}</p>
          )}
          {pinMode && !scroll && <p className="typo-caption text-foreground">{s.frame_viewport_fallback}</p>}
        </div>
      )}
    </div>
  );
}
