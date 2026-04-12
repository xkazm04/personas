import { useMemo, useRef, useEffect } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { MonitorPlay } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { TimelineItem, VideoClip, TextItem, ImageItem } from './types';

interface CompositionPreviewProps {
  selectedItem: TimelineItem | null;
  currentTime: number;
  textItems: TextItem[];
  imageItems: ImageItem[];
}

export default function CompositionPreview({
  selectedItem,
  currentTime,
  textItems,
  imageItems,
}: CompositionPreviewProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);

  const videoSrc = useMemo(() => {
    if (selectedItem?.type === 'video') {
      return convertFileSrc((selectedItem as VideoClip).filePath);
    }
    return null;
  }, [selectedItem]);

  // Seek video to match currentTime relative to clip's startTime
  useEffect(() => {
    if (!videoRef.current || !selectedItem || selectedItem.type !== 'video') return;
    const clip = selectedItem as VideoClip;
    const clipLocal = currentTime - clip.startTime + clip.trimStart;
    if (clipLocal >= 0 && clipLocal <= clip.mediaDuration) {
      videoRef.current.currentTime = clipLocal;
    }
  }, [currentTime, selectedItem]);

  // Active text overlays at currentTime
  const activeTexts = useMemo(
    () => textItems.filter((it) => currentTime >= it.startTime && currentTime < it.startTime + it.duration),
    [textItems, currentTime],
  );

  // Active image overlays at currentTime
  const activeImages = useMemo(
    () => imageItems.filter((it) => currentTime >= it.startTime && currentTime < it.startTime + it.duration),
    [imageItems, currentTime],
  );

  return (
    <div className="flex flex-col rounded-xl bg-card border border-primary/10 overflow-hidden w-full">
      {/* 16:9 aspect container */}
      <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
        <div className="absolute inset-0 bg-black flex items-center justify-center overflow-hidden">
          {/* Video layer */}
          {videoSrc ? (
            <video
              ref={videoRef}
              src={videoSrc}
              className="w-full h-full object-contain"
              controls={false}
              muted
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-foreground/20">
              <MonitorPlay className="w-10 h-10" />
              <span className="typo-body text-sm">{t.media_studio.empty_hint}</span>
            </div>
          )}

          {/* Text overlay layer */}
          {activeTexts.map((item) => (
            <div
              key={item.id}
              className="absolute pointer-events-none select-none"
              style={{
                left: `${item.positionX * 100}%`,
                top: `${item.positionY * 100}%`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <span
                className="font-bold drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
                style={{
                  fontSize: `${item.fontSize * 0.5}px`,
                  color: item.color,
                }}
              >
                {item.label}
              </span>
              {item.text && (
                <p
                  className="text-center drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] mt-0.5"
                  style={{
                    fontSize: `${Math.max(10, item.fontSize * 0.25)}px`,
                    color: item.color,
                    opacity: 0.8,
                  }}
                >
                  {item.text}
                </p>
              )}
            </div>
          ))}

          {/* Image overlay layer */}
          {activeImages.map((item) => (
            <div
              key={item.id}
              className="absolute pointer-events-none"
              style={{
                left: `${item.positionX * 100}%`,
                top: `${item.positionY * 100}%`,
                transform: `translate(-50%, -50%) scale(${item.scale})`,
              }}
            >
              <img
                src={convertFileSrc(item.filePath)}
                alt={item.label}
                className="max-w-[40%] max-h-[40%] object-contain drop-shadow-lg"
                draggable={false}
              />
            </div>
          ))}

          {/* Timecode overlay */}
          <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/60 backdrop-blur-sm">
            <span className="text-[10px] font-mono text-white/70 tabular-nums">
              {formatTimecode(currentTime)}
            </span>
          </div>
        </div>
      </div>

      {/* Mini scrubber bar */}
      <div className="h-1 bg-secondary/20">
        <div
          className="h-full bg-gradient-to-r from-rose-500/60 to-rose-400/40 transition-[width] duration-75"
          style={{
            width: `${currentTime > 0 ? Math.min(100, (currentTime / Math.max(activeTexts.concat(activeImages as unknown as TextItem[]).reduce((max, it) => Math.max(max, it.startTime + it.duration), 1))) * 100) : 0}%`,
          }}
        />
      </div>
    </div>
  );
}

function formatTimecode(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}
