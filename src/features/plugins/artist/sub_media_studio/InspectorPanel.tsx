import { useCallback } from 'react';
import {
  Settings2, Scissors, Music, VolumeX, Volume2, Camera, FileVideo, Loader2,
} from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
import {
  artistExtractAudio,
  artistSaveThumbnail,
  artistTrimFile,
  artistProbeMedia,
  artistMeasureLoudness,
} from '@/api/artist';
import type {
  TimelineItem,
  VideoClip,
  AudioClip,
  TextItem,
  ImageItem,
  Composition,
  TransitionType,
} from './types';
import type { PlaybackEngine } from './hooks/useTimelinePlayback';
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
  engine: PlaybackEngine;
  onUpdate: (id: string, patch: Partial<TimelineItem>) => void;
  onUpdateComposition: (patch: Partial<Composition>) => void;
  onSplit: (id: string, time: number) => void;
  onAddItem: (item: TimelineItem) => void;
}

// ---------------------------------------------------------------------------
// Small reusable inputs
// ---------------------------------------------------------------------------

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

function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</span>
        <span className="text-[10px] font-mono text-foreground/70 tabular-nums">
          {format ? format(value) : value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 accent-rose-400"
      />
    </label>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
  icon: Icon,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  icon?: typeof VolumeX;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`w-full flex items-start gap-3 px-3 py-2 rounded-lg border transition-colors text-left ${
        value
          ? 'bg-rose-500/10 border-rose-500/30'
          : 'bg-secondary/20 border-primary/10 hover:bg-secondary/30'
      }`}
    >
      {Icon && (
        <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${value ? 'text-rose-400' : 'text-muted-foreground'}`} />
      )}
      <div className="flex-1 min-w-0">
        <div className={`text-xs font-medium ${value ? 'text-rose-400' : 'text-foreground/80'}`}>
          {label}
        </div>
        {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
      </div>
      <div
        className={`w-7 h-4 rounded-full relative flex-shrink-0 mt-1 transition-colors ${
          value ? 'bg-rose-500' : 'bg-secondary'
        }`}
      >
        <div
          className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${
            value ? 'left-3.5' : 'left-0.5'
          }`}
        />
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function InspectorPanel({
  selectedItem,
  composition,
  engine,
  onUpdate,
  onUpdateComposition,
  onSplit,
  onAddItem,
}: InspectorPanelProps) {
  const { t } = useTranslation();

  const update = useCallback(
    (patch: Partial<TimelineItem>) => {
      if (selectedItem) onUpdate(selectedItem.id, patch);
    },
    [selectedItem, onUpdate],
  );

  // -- Clip actions ----------------------------------------------------------

  const handleSplit = useCallback(() => {
    if (!selectedItem) return;
    onSplit(selectedItem.id, engine.getTime());
  }, [selectedItem, engine, onSplit]);

  const handleExtractAudio = useCallback(async () => {
    if (!selectedItem || selectedItem.type !== 'video') return;
    const clip = selectedItem;
    const baseName = clip.label.replace(/\.[^.]+$/, '');
    const outputPath = await save({
      filters: [
        { name: 'AAC Audio', extensions: ['m4a'] },
        { name: 'MP3 Audio', extensions: ['mp3'] },
        { name: 'WAV Audio', extensions: ['wav'] },
      ],
      defaultPath: `${baseName}.m4a`,
    });
    if (!outputPath) return;

    useToastStore.getState().addToast(t.media_studio.extracting_audio, 'success');
    try {
      await artistExtractAudio(clip.filePath, outputPath);
      useToastStore.getState().addToast(t.media_studio.extract_audio_done, 'success');
      // Probe the new file and add it as an audio clip at the same start time
      const probe = await artistProbeMedia(outputPath);
      const fileName = outputPath.split(/[/\\]/).pop() ?? 'audio';
      onAddItem({
        id: crypto.randomUUID(),
        type: 'audio',
        label: fileName,
        startTime: clip.startTime,
        duration: probe.duration,
        filePath: outputPath,
        trimStart: 0,
        trimEnd: 0,
        mediaDuration: probe.duration,
        volume: 1,
      });
    } catch (err) {
      toastCatch('Extract audio')(err);
    }
  }, [selectedItem, onAddItem, t]);

  const handleSaveThumbnail = useCallback(async () => {
    if (!selectedItem || selectedItem.type !== 'video') return;
    const clip = selectedItem;
    const baseName = clip.label.replace(/\.[^.]+$/, '');
    const outputPath = await save({
      filters: [{ name: 'JPEG', extensions: ['jpg'] }, { name: 'PNG', extensions: ['png'] }],
      defaultPath: `${baseName}-frame.jpg`,
    });
    if (!outputPath) return;

    // Grab frame at the playhead, mapped into the clip's local time
    const localTime = engine.getTime() - clip.startTime + clip.trimStart;
    useToastStore.getState().addToast(t.media_studio.saving_thumbnail, 'success');
    try {
      await artistSaveThumbnail(clip.filePath, Math.max(0, localTime), outputPath);
      useToastStore.getState().addToast(t.media_studio.thumbnail_saved, 'success');
    } catch (err) {
      toastCatch('Save thumbnail')(err);
    }
  }, [selectedItem, engine, t]);

  /**
   * Toggle normalize on an audio clip. When turning it on we also kick off
   * a loudnorm dry-run measurement in the background so the preview can
   * apply a true linear gain. If a measurement is already cached on the
   * clip we skip the network round-trip.
   */
  const handleToggleNormalize = useCallback(
    async (clip: AudioClip, next: boolean) => {
      onUpdate(clip.id, { normalize: next } as Partial<TimelineItem>);
      if (!next) return;
      if (clip.measuredLufs !== undefined) return;
      if (clip.measuringLoudness) return;

      onUpdate(clip.id, { measuringLoudness: true } as Partial<TimelineItem>);
      try {
        const stats = await artistMeasureLoudness(clip.filePath);
        onUpdate(clip.id, {
          measuredLufs: stats.integrated,
          measuredLra: stats.lra,
          measuredTruePeak: stats.truePeak,
          measuredThreshold: stats.threshold,
          measuringLoudness: false,
        } as Partial<TimelineItem>);
      } catch (err) {
        onUpdate(clip.id, { measuringLoudness: false } as Partial<TimelineItem>);
        toastCatch('Measure loudness')(err);
      }
    },
    [onUpdate],
  );

  const handleTrimToFile = useCallback(async () => {
    if (!selectedItem || (selectedItem.type !== 'video' && selectedItem.type !== 'audio')) return;
    const clip = selectedItem;
    const isAudio = clip.type === 'audio';
    const baseName = clip.label.replace(/\.[^.]+$/, '');
    const defaultExt = isAudio ? 'm4a' : 'mp4';
    const outputPath = await save({
      filters: isAudio
        ? [{ name: 'Audio', extensions: ['m4a', 'mp3', 'wav'] }]
        : [{ name: 'MP4 Video', extensions: ['mp4'] }],
      defaultPath: `${baseName}-trim.${defaultExt}`,
    });
    if (!outputPath) return;

    useToastStore.getState().addToast(t.media_studio.trimming_file, 'success');
    try {
      const start = clip.trimStart;
      const end = clip.trimStart + clip.duration;
      await artistTrimFile(clip.filePath, start, end, outputPath);
      useToastStore.getState().addToast(t.media_studio.trim_done, 'success');
    } catch (err) {
      toastCatch('Trim file')(err);
    }
  }, [selectedItem, t]);

  // -- Render ----------------------------------------------------------------

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

        <div className="grid grid-cols-2 gap-3">
          <NumField
            label={t.media_studio.framerate}
            value={composition.fps}
            onChange={(v) => onUpdateComposition({ fps: Math.max(1, Math.min(120, Math.round(v))) })}
            step={1}
            min={1}
          />
        </div>

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
  const isImage = selectedItem.type === 'image';
  const isText = selectedItem.type === 'text';

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto">
      <h3 className="typo-heading text-foreground/90 flex items-center gap-2">
        <Settings2 className="w-4 h-4 text-rose-400" />
        {t.media_studio.inspector_title}
      </h3>

      <div className="px-2 py-1.5 rounded-lg bg-secondary/30 border border-primary/10">
        <span className="text-xs text-foreground/70 font-medium truncate block">{selectedItem.label}</span>
      </div>

      {/* -- Clip actions (destructive / transform) ------------------------ */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
          {t.media_studio.clip_actions}
        </span>
        <Button variant="ghost" size="sm" onClick={handleSplit}>
          <Scissors className="w-3.5 h-3.5" />
          {t.media_studio.action_split}
        </Button>
        {isVideo && (
          <>
            <Button variant="ghost" size="sm" onClick={handleExtractAudio}>
              <Music className="w-3.5 h-3.5" />
              {t.media_studio.action_extract_audio}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleSaveThumbnail}>
              <Camera className="w-3.5 h-3.5" />
              {t.media_studio.action_save_thumbnail}
            </Button>
          </>
        )}
        {(isVideo || isAudio) && (
          <Button variant="ghost" size="sm" onClick={handleTrimToFile}>
            <FileVideo className="w-3.5 h-3.5" />
            {t.media_studio.action_trim_to_file}
          </Button>
        )}
      </div>

      {/* -- Common timing ------------------------------------------------- */}
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

      {/* -- Trim (video & audio) ------------------------------------------ */}
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

      {/* -- Transition (video only) --------------------------------------- */}
      {isVideo && (
        <TransitionPicker
          value={(selectedItem as VideoClip).transition}
          duration={(selectedItem as VideoClip).transitionDuration}
          onChange={(transition: TransitionType, transitionDuration: number) =>
            update({ transition, transitionDuration } as Partial<TimelineItem>)
          }
        />
      )}

      {/* -- Volume (audio) ------------------------------------------------ */}
      {isAudio && (
        <RangeField
          label={t.media_studio.volume}
          value={(selectedItem as AudioClip).volume}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => update({ volume: v } as Partial<TimelineItem>)}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      )}

      {/* -- Effects (FFmpeg filter graph) --------------------------------- */}
      {(isVideo || isAudio || isImage || isText) && (
        <div className="flex flex-col gap-3 pt-3 border-t border-primary/10">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
            {t.media_studio.effects}
          </span>

          {(isVideo || isAudio) && (
            <RangeField
              label={t.media_studio.speed}
              value={(selectedItem as VideoClip | AudioClip).speed ?? 1}
              min={0.25}
              max={4}
              step={0.05}
              onChange={(v) => update({ speed: v } as Partial<TimelineItem>)}
              format={(v) => `${v.toFixed(2)}×`}
            />
          )}

          <RangeField
            label={t.media_studio.fade_in}
            value={(selectedItem as VideoClip).fadeIn ?? 0}
            min={0}
            max={Math.min(3, selectedItem.duration / 2)}
            step={0.05}
            onChange={(v) => update({ fadeIn: v } as Partial<TimelineItem>)}
            format={(v) => `${v.toFixed(2)}s`}
          />

          <RangeField
            label={t.media_studio.fade_out}
            value={(selectedItem as VideoClip).fadeOut ?? 0}
            min={0}
            max={Math.min(3, selectedItem.duration / 2)}
            step={0.05}
            onChange={(v) => update({ fadeOut: v } as Partial<TimelineItem>)}
            format={(v) => `${v.toFixed(2)}s`}
          />

          {isVideo && (
            <ToggleRow
              label={t.media_studio.action_strip_audio}
              hint={t.media_studio.strip_audio_hint}
              value={(selectedItem as VideoClip).stripAudio ?? false}
              onChange={(v) => update({ stripAudio: v } as Partial<TimelineItem>)}
              icon={(selectedItem as VideoClip).stripAudio ? VolumeX : Volume2}
            />
          )}

          {isAudio && (() => {
            const clip = selectedItem as AudioClip;
            const measuring = clip.measuringLoudness === true;
            const measured = clip.measuredLufs;
            const hint = measuring
              ? 'Measuring integrated loudness…'
              : measured !== undefined
                ? `Measured ${measured.toFixed(1)} LUFS — preview gain will match export`
                : t.media_studio.normalize_hint;
            return (
              <>
                <ToggleRow
                  label={t.media_studio.normalize}
                  hint={hint}
                  value={clip.normalize ?? false}
                  onChange={(v) => handleToggleNormalize(clip, v)}
                  icon={measuring ? Loader2 : Volume2}
                />
                {measuring && (
                  <p className="text-[10px] text-rose-400/80 flex items-center gap-1 -mt-2 ml-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Running ffmpeg loudnorm dry-run…
                  </p>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* -- Text properties ----------------------------------------------- */}
      {isText && (
        <div className="flex flex-col gap-3 pt-3 border-t border-primary/10">
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
        </div>
      )}

      {/* -- Image scale --------------------------------------------------- */}
      {isImage && (
        <RangeField
          label={t.media_studio.scale}
          value={(selectedItem as ImageItem).scale}
          min={0.1}
          max={3}
          step={0.05}
          onChange={(v) => update({ scale: v } as Partial<TimelineItem>)}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      )}
    </div>
  );
}
