import { useCallback } from 'react';
import { Settings2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { TimelineItem, VideoClip, AudioClip, TextItem, Composition, TransitionType } from './types';
import TransitionPicker from './TransitionPicker';

const RESOLUTION_PRESETS = [
  { label: '1080p', w: 1920, h: 1080 },
  { label: '720p', w: 1280, h: 720 },
  { label: '4K', w: 3840, h: 2160 },
  { label: 'Square', w: 1080, h: 1080 },
  { label: '9:16', w: 1080, h: 1920 },
];

interface InspectorPanelProps {
  selectedItem: TimelineItem | null;
  composition: Composition;
  onUpdate: (id: string, patch: Partial<TimelineItem>) => void;
  onUpdateComposition: (patch: Partial<Composition>) => void;
}

/** Tiny labeled number input. */
function NumField({
  label,
  value,
  onChange,
  step = 0.1,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</span>
      <input
        type="number"
        className="w-full rounded-lg bg-secondary/40 border border-primary/10 px-2 py-1 text-sm text-foreground tabular-nums focus:outline-none focus:border-rose-500/40"
        value={Number(value.toFixed(3))}
        step={step}
        min={min}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
    </label>
  );
}

export default function InspectorPanel({ selectedItem, composition, onUpdate, onUpdateComposition }: InspectorPanelProps) {
  const { t } = useTranslation();

  const update = useCallback(
    (patch: Partial<TimelineItem>) => {
      if (selectedItem) onUpdate(selectedItem.id, patch);
    },
    [selectedItem, onUpdate],
  );

  if (!selectedItem) {
    return (
      <div className="flex flex-col gap-4 p-4 overflow-y-auto">
        <h3 className="typo-heading text-foreground/90 flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-rose-400" />
          {t.media_studio.output_settings}
        </h3>

        {/* Composition name */}
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground uppercase tracking-wide">{t.media_studio.title}</span>
          <input
            type="text"
            value={composition.name}
            onChange={(e) => onUpdateComposition({ name: e.target.value })}
            className="w-full rounded-lg bg-secondary/40 border border-primary/10 px-2 py-1 text-sm text-foreground focus:outline-none focus:border-rose-500/40"
          />
        </label>

        {/* Resolution presets */}
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground uppercase tracking-wide">{t.media_studio.resolution}</span>
          <div className="grid grid-cols-3 gap-1.5">
            {RESOLUTION_PRESETS.map((p) => {
              const active = composition.width === p.w && composition.height === p.h;
              return (
                <button
                  key={p.label}
                  onClick={() => onUpdateComposition({ width: p.w, height: p.h })}
                  className={`py-1.5 px-1 rounded-lg border text-[10px] font-medium transition-all ${
                    active
                      ? 'bg-rose-500/15 border-rose-500/30 text-rose-400'
                      : 'bg-secondary/20 border-primary/10 text-muted-foreground/60 hover:bg-secondary/30'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <span className="text-[9px] text-muted-foreground/40 mt-0.5">
            {composition.width} x {composition.height}
          </span>
        </div>

        {/* FPS */}
        <div className="grid grid-cols-2 gap-3">
          <NumField
            label={t.media_studio.framerate}
            value={composition.fps}
            onChange={(v) => onUpdateComposition({ fps: Math.max(1, Math.min(120, Math.round(v))) })}
            step={1}
            min={1}
          />
        </div>

        {/* Background color */}
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground uppercase tracking-wide">{t.media_studio.color}</span>
          <input
            type="color"
            value={composition.backgroundColor}
            onChange={(e) => onUpdateComposition({ backgroundColor: e.target.value })}
            className="w-full h-8 rounded-lg border border-primary/10 cursor-pointer"
          />
        </label>

        <p className="text-[10px] text-muted-foreground/40 mt-2">
          {t.media_studio.no_selection}
        </p>
      </div>
    );
  }

  const isVideo = selectedItem.type === 'video';
  const isAudio = selectedItem.type === 'audio';
  const isText = selectedItem.type === 'text';

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto">
      <h3 className="typo-heading text-foreground/90 flex items-center gap-2">
        <Settings2 className="w-4 h-4 text-rose-400" />
        {t.media_studio.inspector_title}
      </h3>

      {/* Label (read-only identifier) */}
      <div className="px-2 py-1.5 rounded-lg bg-secondary/30 border border-primary/10">
        <span className="text-xs text-foreground/70 font-medium">{selectedItem.label}</span>
      </div>

      {/* Common fields */}
      <div className="grid grid-cols-2 gap-3">
        <NumField
          label={t.media_studio.start_time}
          value={selectedItem.startTime}
          onChange={(v) => update({ startTime: v })}
        />
        <NumField
          label={t.media_studio.duration}
          value={selectedItem.duration}
          onChange={(v) => update({ duration: Math.max(0.1, v) })}
        />
      </div>

      {/* Trim fields — video & audio */}
      {(isVideo || isAudio) && (
        <div className="grid grid-cols-2 gap-3">
          <NumField
            label={t.media_studio.trim_start}
            value={(selectedItem as VideoClip | AudioClip).trimStart}
            onChange={(v) => update({ trimStart: v } as Partial<TimelineItem>)}
          />
          <NumField
            label={t.media_studio.trim_end}
            value={(selectedItem as VideoClip | AudioClip).trimEnd}
            onChange={(v) => update({ trimEnd: v } as Partial<TimelineItem>)}
          />
        </div>
      )}

      {/* Transition — video only */}
      {isVideo && (
        <TransitionPicker
          value={(selectedItem as VideoClip).transition}
          duration={(selectedItem as VideoClip).transitionDuration}
          onChange={(transition: TransitionType, transitionDuration: number) =>
            update({ transition, transitionDuration } as Partial<TimelineItem>)
          }
        />
      )}

      {/* Volume — audio only */}
      {isAudio && (
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground uppercase tracking-wide">
            {t.media_studio.volume}
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={(selectedItem as AudioClip).volume}
            onChange={(e) =>
              update({ volume: parseFloat(e.target.value) } as Partial<TimelineItem>)
            }
            className="w-full accent-blue-400"
          />
          <span className="text-xs text-muted-foreground tabular-nums">
            {Math.round((selectedItem as AudioClip).volume * 100)}%
          </span>
        </label>
      )}

      {/* Text properties */}
      {isText && (
        <>
          <NumField
            label={t.media_studio.font_size}
            value={(selectedItem as TextItem).fontSize}
            onChange={(v) => update({ fontSize: v } as Partial<TimelineItem>)}
            step={1}
            min={8}
          />
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground uppercase tracking-wide">
              {t.media_studio.color}
            </span>
            <input
              type="color"
              value={(selectedItem as TextItem).color}
              onChange={(e) => update({ color: e.target.value } as Partial<TimelineItem>)}
              className="w-full h-8 rounded-lg border border-primary/10 cursor-pointer"
            />
          </label>
        </>
      )}
    </div>
  );
}
