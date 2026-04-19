import { useCallback, useEffect, useState } from 'react';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import {
  AlertTriangle,
  Camera,
  Check,
  FileVideo,
  FolderOpen,
  Gauge,
  Loader2,
  Music,
  Palette,
  Save,
  Scissors,
  Settings2,
  SlidersHorizontal,
  Type,
  Volume2,
  VolumeX,
  Waves,
} from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import {
  artistExtractAudio,
  artistMeasureLoudness,
  artistProbeMedia,
  artistSaveThumbnail,
  artistTrimFile,
} from '@/api/artist';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import type { PlaybackEngine } from '../hooks/useTimelinePlayback';
import type { MediaStudioPersistence } from '../hooks/useMediaStudioPersistence';
import TransitionPicker from '../TransitionPicker';
import type {
  AudioClip,
  Composition,
  ImageItem,
  TextItem,
  TimelineItem,
  TransitionType,
  VideoClip,
} from '../types';
import { IconPopover } from './IconPopover';
import { NumField, RangeField, ToggleRow } from './fields';

// ---------------------------------------------------------------------------
// MediaStudioToolbar — top-of-workspace controls.
//
// Replaces the old right-side InspectorPanel + bottom metadata row. Left
// side holds composition identity + metadata; middle hosts the property
// popovers that light up when a clip is selected; right side hosts save /
// open / export controls.
// ---------------------------------------------------------------------------

interface Props {
  composition: Composition;
  totalDuration: number;
  selectedItem: TimelineItem | null;
  persistence: MediaStudioPersistence;
  engine: PlaybackEngine;
  onUpdate: (id: string, patch: Partial<TimelineItem>) => void;
  onUpdateComposition: (patch: Partial<Composition>) => void;
  onSplit: (id: string, time: number) => void;
  onAddItem: (item: TimelineItem) => void;
  onExport: () => void;
  exportDisabled: boolean;
  exporting: boolean;
}

export default function MediaStudioToolbar({
  composition,
  totalDuration,
  selectedItem,
  persistence,
  engine,
  onUpdate,
  onUpdateComposition,
  onSplit,
  onAddItem,
  onExport,
  exportDisabled,
  exporting,
}: Props) {
  const isVideo = selectedItem?.type === 'video';
  const isAudio = selectedItem?.type === 'audio';
  const isText = selectedItem?.type === 'text';
  const isImage = selectedItem?.type === 'image';
  const isMedia = isVideo || isAudio;

  const update = useCallback(
    (patch: Partial<TimelineItem>) => {
      if (selectedItem) onUpdate(selectedItem.id, patch);
    },
    [selectedItem, onUpdate],
  );

  const relativeSaved = useRelativeTime(persistence.lastSavedAt);

  return (
    <div className="flex items-stretch gap-2 px-4 md:px-6 xl:px-8 py-2 border-b border-primary/10 bg-card/40">
      {/* -- Left: composition identity + metadata -------------------------- */}
      <CompositionIdentity
        composition={composition}
        onUpdateComposition={onUpdateComposition}
        totalDuration={totalDuration}
      />

      {/* -- Middle: property popovers (light up on selection) -------------- */}
      <div className="flex items-center gap-0.5">
        <div className="w-px h-5 bg-primary/10 mx-1 self-center" aria-hidden />

        {/* Composition settings — always available */}
        <IconPopover icon={Settings2} title="Composition settings">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <NumField
                label="Width"
                value={composition.width}
                step={2}
                min={16}
                onChange={(v) => onUpdateComposition({ width: Math.max(16, Math.round(v)) })}
              />
              <NumField
                label="Height"
                value={composition.height}
                step={2}
                min={16}
                onChange={(v) => onUpdateComposition({ height: Math.max(16, Math.round(v)) })}
              />
            </div>
            <NumField
              label="Framerate (fps)"
              value={composition.fps}
              step={1}
              min={1}
              onChange={(v) => onUpdateComposition({ fps: Math.max(1, Math.round(v)) })}
            />
            <label className="flex flex-col gap-1">
              <span className="typo-label text-foreground">Background color</span>
              <input
                type="color"
                value={composition.backgroundColor}
                onChange={(e) => onUpdateComposition({ backgroundColor: e.target.value })}
                className="w-full h-8 rounded-card border border-primary/10 cursor-pointer"
              />
            </label>
          </div>
        </IconPopover>

        {/* Trim / timing — media clips */}
        <IconPopover
          icon={Scissors}
          title="Trim & timing"
          disabled={!selectedItem}
          active={Boolean(selectedItem && isMedia && ((selectedItem as VideoClip | AudioClip).trimStart > 0 || (selectedItem as VideoClip | AudioClip).trimEnd > 0))}
        >
          {selectedItem && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <NumField
                  label="Start"
                  value={selectedItem.startTime}
                  onChange={(v) => update({ startTime: Math.max(0, v) })}
                />
                <NumField
                  label="Duration"
                  value={selectedItem.duration}
                  onChange={(v) => update({ duration: Math.max(0.1, v) })}
                />
              </div>
              {isMedia && (
                <div className="grid grid-cols-2 gap-3">
                  <NumField
                    label="Trim start"
                    value={(selectedItem as VideoClip | AudioClip).trimStart}
                    onChange={(v) => update({ trimStart: v } as Partial<TimelineItem>)}
                  />
                  <NumField
                    label="Trim end"
                    value={(selectedItem as VideoClip | AudioClip).trimEnd}
                    onChange={(v) => update({ trimEnd: v } as Partial<TimelineItem>)}
                  />
                </div>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSplit(selectedItem.id, engine.getTime())}
              >
                <Scissors className="w-3.5 h-3.5" />
                Split at playhead
              </Button>
            </div>
          )}
        </IconPopover>

        {/* Fade in / fade out — all visible types */}
        <IconPopover
          icon={Waves}
          title="Fades"
          disabled={!selectedItem}
          active={Boolean(selectedItem && (((selectedItem as VideoClip).fadeIn ?? 0) > 0 || ((selectedItem as VideoClip).fadeOut ?? 0) > 0))}
        >
          {selectedItem && (
            <div className="flex flex-col gap-3">
              <RangeField
                label="Fade in"
                value={(selectedItem as VideoClip).fadeIn ?? 0}
                min={0}
                max={Math.min(3, selectedItem.duration / 2)}
                step={0.05}
                onChange={(v) => update({ fadeIn: v } as Partial<TimelineItem>)}
                format={(v) => `${v.toFixed(2)}s`}
              />
              <RangeField
                label="Fade out"
                value={(selectedItem as VideoClip).fadeOut ?? 0}
                min={0}
                max={Math.min(3, selectedItem.duration / 2)}
                step={0.05}
                onChange={(v) => update({ fadeOut: v } as Partial<TimelineItem>)}
                format={(v) => `${v.toFixed(2)}s`}
              />
            </div>
          )}
        </IconPopover>

        {/* Speed — media only */}
        <IconPopover
          icon={Gauge}
          title="Speed"
          disabled={!isMedia}
          active={Boolean(selectedItem && isMedia && ((selectedItem as VideoClip | AudioClip).speed ?? 1) !== 1)}
        >
          {isMedia && selectedItem && (
            <RangeField
              label="Playback speed"
              value={(selectedItem as VideoClip | AudioClip).speed ?? 1}
              min={0.25}
              max={4}
              step={0.05}
              onChange={(v) => update({ speed: v } as Partial<TimelineItem>)}
              format={(v) => `${v.toFixed(2)}×`}
            />
          )}
        </IconPopover>

        {/* Transition — video only */}
        <IconPopover
          icon={SlidersHorizontal}
          title="Transition"
          disabled={!isVideo}
          active={Boolean(selectedItem && isVideo && (selectedItem as VideoClip).transition !== 'cut')}
          widthPx={320}
        >
          {isVideo && selectedItem && (
            <TransitionPicker
              value={(selectedItem as VideoClip).transition}
              duration={(selectedItem as VideoClip).transitionDuration}
              onChange={(transition: TransitionType, transitionDuration: number) =>
                update({ transition, transitionDuration } as Partial<TimelineItem>)
              }
            />
          )}
        </IconPopover>

        {/* Audio — volume + normalize + strip-audio */}
        <IconPopover
          icon={Volume2}
          title="Audio"
          disabled={!isAudio && !isVideo}
          active={Boolean(
            selectedItem &&
              ((isAudio && ((selectedItem as AudioClip).volume !== 1 || (selectedItem as AudioClip).normalize)) ||
                (isVideo && (selectedItem as VideoClip).stripAudio)),
          )}
          widthPx={320}
        >
          {selectedItem && (
            <div className="flex flex-col gap-3">
              {isAudio && (
                <AudioControls
                  clip={selectedItem as AudioClip}
                  onUpdate={update}
                />
              )}
              {isVideo && (
                <ToggleRow
                  label="Strip audio"
                  hint="Drop this clip's audio track on export"
                  value={(selectedItem as VideoClip).stripAudio ?? false}
                  onChange={(v) => update({ stripAudio: v } as Partial<TimelineItem>)}
                  icon={(selectedItem as VideoClip).stripAudio ? VolumeX : Volume2}
                />
              )}
            </div>
          )}
        </IconPopover>

        {/* Style — text / image */}
        <IconPopover
          icon={Type}
          title={isText ? 'Beat style' : 'Image style'}
          disabled={!isText && !isImage}
        >
          {isText && selectedItem && (
            <div className="flex flex-col gap-3">
              <NumField
                label="Font size"
                value={(selectedItem as TextItem).fontSize}
                onChange={(v) => update({ fontSize: v } as Partial<TimelineItem>)}
                step={1}
                min={8}
              />
              <label className="flex flex-col gap-1">
                <span className="typo-label text-foreground">Color</span>
                <input
                  type="color"
                  value={(selectedItem as TextItem).color}
                  onChange={(e) => update({ color: e.target.value } as Partial<TimelineItem>)}
                  className="w-full h-8 rounded-card border border-primary/10 cursor-pointer"
                />
              </label>
            </div>
          )}
          {isImage && selectedItem && (
            <RangeField
              label="Scale"
              value={(selectedItem as ImageItem).scale}
              min={0.1}
              max={3}
              step={0.05}
              onChange={(v) => update({ scale: v } as Partial<TimelineItem>)}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          )}
        </IconPopover>

        {/* Clip actions (split, extract, thumbnail, trim-to-file) */}
        <IconPopover icon={Palette} title="Clip actions" disabled={!selectedItem} widthPx={260}>
          {selectedItem && (
            <ClipActions
              item={selectedItem}
              engine={engine}
              onAddItem={onAddItem}
            />
          )}
        </IconPopover>
      </div>

      {/* -- Right: save / open / export ------------------------------------ */}
      <div className="flex items-center gap-2 ml-auto">
        <SaveStatusChip status={persistence.status} relativeSaved={relativeSaved} />

        {persistence.restoredFromAutosave && (
          <button
            onClick={persistence.dismissRestoreHint}
            className="text-[10px] px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20"
            title="Dismiss"
          >
            Restored
          </button>
        )}

        <Button variant="ghost" size="sm" onClick={persistence.openFile} title="Open composition">
          <FolderOpen className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Open</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={persistence.save} title="Save">
          <Save className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Save</span>
        </Button>
        <Button
          variant="accent"
          accentColor="rose"
          size="sm"
          onClick={onExport}
          disabled={exportDisabled || exporting}
          title="Export MP4"
        >
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileVideo className="w-3.5 h-3.5" />}
          <span className="hidden md:inline">Export</span>
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function CompositionIdentity({
  composition,
  onUpdateComposition,
  totalDuration,
}: {
  composition: Composition;
  onUpdateComposition: (patch: Partial<Composition>) => void;
  totalDuration: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const displayName = draft ?? composition.name;

  const commit = () => {
    if (draft === null) return;
    const trimmed = draft.trim();
    onUpdateComposition({ name: trimmed.length === 0 ? 'Untitled' : trimmed });
    setDraft(null);
  };

  return (
    <div className="flex items-center gap-2 min-w-0">
      <input
        className="bg-transparent border-0 typo-heading text-foreground w-40 px-1 py-0.5 -mx-1 rounded hover:bg-secondary/20 focus:bg-secondary/30 focus:outline-none focus:ring-1 focus:ring-rose-500/30"
        value={displayName}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(null);
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        aria-label="Composition name"
      />
      <div className="flex items-center gap-1.5 text-[11px] text-foreground/60 font-mono tabular-nums">
        <span>{composition.width}×{composition.height}</span>
        <span className="text-foreground/30">·</span>
        <span>{composition.fps} fps</span>
        <span className="text-foreground/30">·</span>
        <span>{formatTotalDuration(totalDuration)}</span>
      </div>
    </div>
  );
}

function AudioControls({
  clip,
  onUpdate,
}: {
  clip: AudioClip;
  onUpdate: (patch: Partial<TimelineItem>) => void;
}) {
  const handleToggleNormalize = useCallback(
    async (next: boolean) => {
      onUpdate({ normalize: next } as Partial<TimelineItem>);
      if (!next) return;
      if (clip.measuredLufs !== undefined) return;
      if (clip.measuringLoudness) return;
      onUpdate({ measuringLoudness: true } as Partial<TimelineItem>);
      try {
        const stats = await artistMeasureLoudness(clip.filePath);
        onUpdate({
          measuredLufs: stats.integrated,
          measuredLra: stats.lra,
          measuredTruePeak: stats.truePeak,
          measuredThreshold: stats.threshold,
          measuringLoudness: false,
        } as Partial<TimelineItem>);
      } catch (err) {
        onUpdate({ measuringLoudness: false } as Partial<TimelineItem>);
        toastCatch('Measure loudness')(err);
      }
    },
    [clip.filePath, clip.measuredLufs, clip.measuringLoudness, onUpdate],
  );

  const measuring = clip.measuringLoudness === true;
  const measured = clip.measuredLufs;
  const hint = measuring
    ? 'Measuring integrated loudness…'
    : measured !== undefined
      ? `Measured ${measured.toFixed(1)} LUFS — preview gain matches export`
      : 'Match -16 LUFS on export for consistent loudness';

  return (
    <div className="flex flex-col gap-3">
      <RangeField
        label="Volume"
        value={clip.volume}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => onUpdate({ volume: v } as Partial<TimelineItem>)}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <ToggleRow
        label="Normalize (-16 LUFS)"
        hint={hint}
        value={clip.normalize ?? false}
        onChange={handleToggleNormalize}
        icon={measuring ? Loader2 : Volume2}
      />
    </div>
  );
}

function ClipActions({
  item,
  engine,
  onAddItem,
}: {
  item: TimelineItem;
  engine: PlaybackEngine;
  onAddItem: (item: TimelineItem) => void;
}) {
  const isVideo = item.type === 'video';
  const isMedia = isVideo || item.type === 'audio';

  const handleExtractAudio = useCallback(async () => {
    if (!isVideo) return;
    const clip = item as VideoClip;
    const baseName = clip.label.replace(/\.[^.]+$/, '');
    const outputPath = await saveDialog({
      filters: [
        { name: 'AAC Audio', extensions: ['m4a'] },
        { name: 'MP3 Audio', extensions: ['mp3'] },
        { name: 'WAV Audio', extensions: ['wav'] },
      ],
      defaultPath: `${baseName}.m4a`,
    });
    if (!outputPath) return;
    useToastStore.getState().addToast('Extracting audio…', 'success');
    try {
      await artistExtractAudio(clip.filePath, outputPath);
      useToastStore.getState().addToast('Audio extracted', 'success');
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
  }, [item, isVideo, onAddItem]);

  const handleSaveThumbnail = useCallback(async () => {
    if (!isVideo) return;
    const clip = item as VideoClip;
    const baseName = clip.label.replace(/\.[^.]+$/, '');
    const outputPath = await saveDialog({
      filters: [{ name: 'JPEG', extensions: ['jpg'] }, { name: 'PNG', extensions: ['png'] }],
      defaultPath: `${baseName}-frame.jpg`,
    });
    if (!outputPath) return;
    const localTime = engine.getTime() - clip.startTime + clip.trimStart;
    useToastStore.getState().addToast('Saving frame…', 'success');
    try {
      await artistSaveThumbnail(clip.filePath, Math.max(0, localTime), outputPath);
      useToastStore.getState().addToast('Frame saved', 'success');
    } catch (err) {
      toastCatch('Save thumbnail')(err);
    }
  }, [item, isVideo, engine]);

  const handleTrimToFile = useCallback(async () => {
    if (!isMedia) return;
    const clip = item as VideoClip | AudioClip;
    const isAudioFile = clip.type === 'audio';
    const baseName = clip.label.replace(/\.[^.]+$/, '');
    const defaultExt = isAudioFile ? 'm4a' : 'mp4';
    const outputPath = await saveDialog({
      filters: isAudioFile
        ? [{ name: 'Audio', extensions: ['m4a', 'mp3', 'wav'] }]
        : [{ name: 'MP4 Video', extensions: ['mp4'] }],
      defaultPath: `${baseName}-trim.${defaultExt}`,
    });
    if (!outputPath) return;
    useToastStore.getState().addToast('Trimming…', 'success');
    try {
      const start = clip.trimStart;
      const end = clip.trimStart + clip.duration;
      await artistTrimFile(clip.filePath, start, end, outputPath);
      useToastStore.getState().addToast('Trim complete', 'success');
    } catch (err) {
      toastCatch('Trim file')(err);
    }
  }, [item, isMedia]);

  return (
    <div className="flex flex-col gap-1.5">
      {isVideo && (
        <Button variant="ghost" size="sm" onClick={handleExtractAudio}>
          <Music className="w-3.5 h-3.5" />
          Extract audio
        </Button>
      )}
      {isVideo && (
        <Button variant="ghost" size="sm" onClick={handleSaveThumbnail}>
          <Camera className="w-3.5 h-3.5" />
          Save frame
        </Button>
      )}
      {isMedia && (
        <Button variant="ghost" size="sm" onClick={handleTrimToFile}>
          <FileVideo className="w-3.5 h-3.5" />
          Trim to file
        </Button>
      )}
      {!isVideo && !isMedia && (
        <p className="text-[11px] text-foreground/60">No actions available for this item type.</p>
      )}
    </div>
  );
}

function SaveStatusChip({
  status,
  relativeSaved,
}: {
  status: MediaStudioPersistence['status'];
  relativeSaved: string | null;
}) {
  if (status === 'saving') {
    return (
      <span className="flex items-center gap-1 text-[11px] text-foreground/60">
        <Loader2 className="w-3 h-3 animate-spin" />
        Saving…
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="flex items-center gap-1 text-[11px] text-amber-400">
        <AlertTriangle className="w-3 h-3" />
        Save failed
      </span>
    );
  }
  if (relativeSaved) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-foreground/50">
        <Check className="w-3 h-3 text-emerald-400/70" />
        {relativeSaved}
      </span>
    );
  }
  return null;
}

function useRelativeTime(ts: number | null): string | null {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!ts) return;
    const h = window.setInterval(() => setTick((t) => t + 1), 15_000);
    return () => window.clearInterval(h);
  }, [ts]);
  if (!ts) return null;
  const diff = Math.max(0, Date.now() - ts);
  // tick is referenced so the hook re-runs on each interval tick.
  void tick;
  if (diff < 2_000) return 'saved just now';
  if (diff < 60_000) return `saved ${Math.round(diff / 1_000)}s ago`;
  if (diff < 3_600_000) return `saved ${Math.round(diff / 60_000)}m ago`;
  return `saved ${Math.round(diff / 3_600_000)}h ago`;
}

function formatTotalDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  if (m === 0) return `${s.toFixed(1)}s`;
  return `${m}m ${s.toFixed(1)}s`;
}
