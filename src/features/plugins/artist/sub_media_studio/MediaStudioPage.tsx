import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { Check, FolderOpen, Video, Music, ImagePlus, Type, Upload, Film, Play, X } from 'lucide-react';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';
import { formatDurationHuman } from '../utils/format';
import { useFfmpegDetect } from './hooks/useFfmpegDetect';
import { useMediaExport } from './hooks/useMediaExport';
import { useMediaStudio } from './hooks/useMediaStudio';
import { useMediaStudioPersistence } from './hooks/useMediaStudioPersistence';
import { useRenderPlan } from './hooks/useRenderPlan';
import { useTranscriptCache } from './hooks/useTranscriptCache';
import { useTimelinePlayback } from './hooks/useTimelinePlayback';
import { useMediaFilePicker } from './hooks/useMediaFilePicker';
import { useTimelineKeyboard } from './hooks/useTimelineKeyboard';
import MediaStudioToolbar from './toolbar/MediaStudioToolbar';
import { artistProbeMedia } from '@/api/artist/index';
import { VIDEO_EXTENSIONS, AUDIO_EXTENSIONS, IMAGE_EXTENSIONS } from './constants';
import type { VideoClip, AudioClip, TextItem, ImageItem, TimelineItem } from './types';
import FfmpegStatusBanner from './FfmpegStatusBanner';
import CompositionPreview from './CompositionPreview';
import TimelinePanel from './TimelinePanel';
import PlaybackControls from './PlaybackControls';

/** End of the latest item on a single-lane track — where a new clip should
 *  drop in so it lands after everything already on that lane. */
function nextStartTime<T extends { startTime: number; duration: number }>(items: T[]): number {
  return items.reduce((end, c) => Math.max(end, c.startTime + c.duration), 0);
}

interface StarterTemplate {
  id: 'vertical-9-16' | 'horizontal-16-9' | 'square';
  width: number;
  height: number;
  fps: number;
}

const STARTER_TEMPLATES: StarterTemplate[] = [
  { id: 'vertical-9-16', width: 1080, height: 1920, fps: 30 },
  { id: 'horizontal-16-9', width: 1920, height: 1080, fps: 30 },
  { id: 'square', width: 1080, height: 1080, fps: 30 },
];

export default function MediaStudioPage() {
  const { t, tx } = useTranslation();
  const { status: ffmpegStatus, checking: ffmpegChecking, recheck: ffmpegRecheck } = useFfmpegDetect();
  const {
    composition,
    updateComposition,
    replaceComposition,
    addItem,
    updateItem,
    removeItem,
    duplicateItem,
    splitItemAt,
    selectedItemId,
    setSelectedItemId,
    selectedItem,
    textItems,
    imageItems,
    videoItems,
    audioItems,
    totalDuration,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useMediaStudio();

  const applyStarterTemplate = useCallback(
    (template: StarterTemplate) => {
      replaceComposition({
        id: crypto.randomUUID(),
        name: starterTemplateName(template.id, t),
        width: template.width,
        height: template.height,
        fps: template.fps,
        backgroundColor: '#000000',
        items: [],
      });
    },
    [replaceComposition, t],
  );

  const persistence = useMediaStudioPersistence({
    composition,
    replaceComposition,
    enabled: true,
  });

  const { plan } = useRenderPlan(composition);
  const { resolve: resolveAnchor } = useTranscriptCache(composition);

  // -- Anchor-word resolution: for any beat with a BeatAnchor, recompute
  // startTime from the referenced clip's word-level transcript. Runs after
  // the transcript cache loads and whenever clip trims or start times
  // change. Writes back via updateItem; the mutation is skipped when the
  // resolved time matches the beat's current startTime so we don't churn
  // history entries.
  useEffect(() => {
    for (const item of composition.items) {
      if (item.type !== 'text') continue;
      const beat = item as TextItem;
      if (!beat.anchor) continue;
      const resolved = resolveAnchor(beat.anchor, composition.items);
      if (resolved === null) continue;
      if (Math.abs(resolved - beat.startTime) < 0.01) continue;
      updateItem(beat.id, { startTime: resolved } as Partial<TimelineItem>);
    }
  }, [composition.items, resolveAnchor, updateItem]);

  const { exportState, startExport, cancelExport, dismissExport } = useMediaExport(composition);

  const handleExport = useCallback(async () => {
    const outputPath = await saveDialog({
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
      defaultPath: `${composition.name || 'export'}.mp4`,
    });
    if (!outputPath) return;
    startExport(outputPath);
  }, [composition.name, startExport]);

  const { engine, playing, looping, play, pause, stop, seek, toggleLoop } =
    useTimelinePlayback(totalDuration);
  const { pickVideo, pickAudio, pickImage } = useMediaFilePicker();

  useTimelineKeyboard({
    engine,
    play,
    pause,
    seek,
    totalDuration,
    selectedItemId,
    removeItem,
    duplicateItem,
    deselectItem: () => setSelectedItemId(null),
    undo,
    redo,
  });

  // -- Gallery → Media Studio handoff -----------------------------------------
  //
  // When the user clicks "Send to Media Studio" on a gallery AssetCard, the
  // asset lands in the `pendingMediaStudioAssets` queue on the artist slice.
  // Drain the queue on mount (and whenever it grows while we're already
  // mounted) and add each asset as a ~5s ImageItem on the timeline.
  const pendingAssets = useSystemStore((s) => s.pendingMediaStudioAssets);
  const consumeMediaStudioAssets = useSystemStore((s) => s.consumeMediaStudioAssets);
  const imageItemsRef = useRef(imageItems);
  imageItemsRef.current = imageItems;

  useEffect(() => {
    if (pendingAssets.length === 0) return;
    const queue = consumeMediaStudioAssets();
    let cursor = nextStartTime(imageItemsRef.current);
    (async () => {
      for (const asset of queue) {
        let width: number | null = null;
        let height: number | null = null;
        try {
          const probe = await artistProbeMedia(asset.filePath);
          width = probe.width;
          height = probe.height;
        } catch {
          // Non-critical — dimensions fall back to null and the preview will
          // letterbox the image to its natural size.
        }
        const clip: ImageItem = {
          id: crypto.randomUUID(),
          type: 'image',
          label: asset.fileName,
          startTime: cursor,
          duration: 5,
          filePath: asset.filePath,
          width,
          height,
          scale: 1,
          positionX: 0.5,
          positionY: 0.5,
        };
        addItem(clip);
        cursor += 5;
      }
    })();
  }, [pendingAssets, consumeMediaStudioAssets, addItem]);

  // -- Drag-and-drop import ---------------------------------------------------

  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
        const filePath = (file as unknown as { path?: string }).path;
        if (!filePath) continue;

        try {
          const probe = await artistProbeMedia(filePath);
          const label = file.name;

          if (VIDEO_EXTENSIONS.includes(ext)) {
            addItem({
              id: crypto.randomUUID(),
              type: 'video',
              label,
              startTime: nextStartTime(videoItems),
              duration: probe.duration,
              filePath,
              trimStart: 0,
              trimEnd: 0,
              mediaDuration: probe.duration,
              width: probe.width,
              height: probe.height,
              transition: 'cut',
              transitionDuration: 0,
            });
          } else if (AUDIO_EXTENSIONS.includes(ext)) {
            addItem({
              id: crypto.randomUUID(),
              type: 'audio',
              label,
              startTime: nextStartTime(audioItems),
              duration: probe.duration,
              filePath,
              trimStart: 0,
              trimEnd: 0,
              mediaDuration: probe.duration,
              volume: 1,
            });
          } else if (IMAGE_EXTENSIONS.includes(ext)) {
            addItem({
              id: crypto.randomUUID(),
              type: 'image',
              label,
              startTime: nextStartTime(imageItems),
              duration: 5,
              filePath,
              width: probe.width,
              height: probe.height,
              scale: 1,
              positionX: 0.5,
              positionY: 0.5,
            });
          }
        } catch {
          // Silently skip unsupported files
        }
      }
    },
    [addItem, videoItems, audioItems, imageItems],
  );

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  // -- Import handlers --------------------------------------------------------

  const handleAddVideo = useCallback(async () => {
    const probe = await pickVideo();
    if (!probe) return;
    const fileName = probe.filePath.split(/[/\\]/).pop() ?? 'clip';
    const clip: VideoClip = {
      id: crypto.randomUUID(),
      type: 'video',
      label: fileName,
      startTime: nextStartTime(videoItems),
      duration: probe.duration,
      filePath: probe.filePath,
      trimStart: 0,
      trimEnd: 0,
      mediaDuration: probe.duration,
      width: probe.width,
      height: probe.height,
      transition: 'cut',
      transitionDuration: 0,
    };
    addItem(clip);
  }, [pickVideo, videoItems, addItem]);

  const handleAddAudio = useCallback(async () => {
    const probe = await pickAudio();
    if (!probe) return;
    const fileName = probe.filePath.split(/[/\\]/).pop() ?? 'audio';
    const clip: AudioClip = {
      id: crypto.randomUUID(),
      type: 'audio',
      label: fileName,
      startTime: nextStartTime(audioItems),
      duration: probe.duration,
      filePath: probe.filePath,
      trimStart: 0,
      trimEnd: 0,
      mediaDuration: probe.duration,
      volume: 1,
    };
    addItem(clip);
  }, [pickAudio, audioItems, addItem]);

  const handleAddText = useCallback(() => {
    const beat: TextItem = {
      id: crypto.randomUUID(),
      type: 'text',
      label: 'Beat',
      startTime: nextStartTime(textItems),
      duration: 3,
      text: '',
    };
    addItem(beat);
  }, [textItems, addItem]);

  const handleAddImage = useCallback(async () => {
    const probe = await pickImage();
    if (!probe) return;
    const fileName = probe.filePath.split(/[/\\]/).pop() ?? 'image';
    const img: ImageItem = {
      id: crypto.randomUUID(),
      type: 'image',
      label: fileName,
      startTime: nextStartTime(imageItems),
      duration: 5,
      filePath: probe.filePath,
      width: probe.width,
      height: probe.height,
      scale: 1,
      positionX: 0.5,
      positionY: 0.5,
    };
    addItem(img);
  }, [pickImage, imageItems, addItem]);

  // -- FFmpeg gate ------------------------------------------------------------

  const ffmpegReady = ffmpegStatus?.found === true;

  // -- Render -----------------------------------------------------------------

  return (
    <div
      className={`flex-1 flex flex-col min-h-0 relative ${dragOver ? 'ring-2 ring-rose-400/40 ring-inset' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {dragOver && (
        <div className="absolute inset-0 z-50 bg-rose-500/10 backdrop-blur-[1px] flex flex-col items-center justify-center gap-3 pointer-events-none">
          <div className="w-16 h-16 rounded-2xl bg-rose-500/20 border-2 border-dashed border-rose-400/50 flex items-center justify-center">
            <Upload className="w-8 h-8 text-rose-400" />
          </div>
          <p className="typo-heading text-rose-400">{t.media_studio.import_media}</p>
        </div>
      )}

      <MediaStudioToolbar
        composition={composition}
        totalDuration={totalDuration}
        selectedItem={selectedItem}
        persistence={persistence}
        engine={engine}
        warnings={plan?.warnings ?? []}
        onUpdate={updateItem}
        onUpdateComposition={updateComposition}
        onSplit={splitItemAt}
        onAddItem={addItem}
        onExport={handleExport}
        exportDisabled={!ffmpegReady || composition.items.length === 0}
        exporting={exportState.status === 'exporting'}
      />

      {(!ffmpegReady || ffmpegChecking) && (
        <div className="px-4 md:px-6 xl:px-8 pt-4">
          <FfmpegStatusBanner
            status={ffmpegStatus}
            checking={ffmpegChecking}
            onRecheck={ffmpegRecheck}
          />
        </div>
      )}

      {ffmpegReady && composition.items.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8 text-center">
          <div className="w-20 h-20 rounded-3xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
            <Film className="w-10 h-10 text-rose-400" />
          </div>
          <div className="max-w-md">
            <h2 className="typo-section-title">{t.media_studio.empty_title}</h2>
            <p className="typo-body text-foreground mt-1">{t.media_studio.empty_hint}</p>
          </div>
          <RecentCompositionsRow onLoad={persistence.loadFromPath} />
          <StarterTemplatesRow onApply={applyStarterTemplate} />
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <Button variant="accent" accentColor="rose" size="md" onClick={handleAddVideo}>
              <Video className="w-4 h-4" />
              {t.media_studio.add_video}
            </Button>
            <Button variant="accent" accentColor="blue" size="md" onClick={handleAddAudio}>
              <Music className="w-4 h-4" />
              {t.media_studio.add_audio}
            </Button>
            <Button variant="ghost" size="md" onClick={handleAddImage}>
              <ImagePlus className="w-4 h-4" />
              {t.media_studio.add_image}
            </Button>
            <Button variant="ghost" size="md" onClick={handleAddText}>
              <Type className="w-4 h-4" />
              {t.media_studio.add_text_beat}
            </Button>
          </div>
          <p className="text-md text-foreground">
            {t.media_studio.import_media} {t.plugins.artist_media_studio.drag_drop_hint}
          </p>
        </div>
      )}

      {ffmpegReady && composition.items.length > 0 && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 min-h-0 p-4 flex items-center justify-center bg-background/40">
            <CompositionPreview
              engine={engine}
              playing={playing}
              plan={plan}
              totalDuration={totalDuration}
            />
          </div>

          {exportState.status === 'complete' && exportState.outputPath && (
            <ExportSuccessStrip
              outputPath={exportState.outputPath}
              onDismiss={dismissExport}
            />
          )}

          {exportState.status === 'exporting' && (
            <div className="flex items-center gap-2 px-4 py-1.5 border-t border-primary/10 bg-card/40">
              <span className="text-[11px] text-foreground/60">{t.media_studio.exporting}</span>
              <div className="flex-1 h-1 rounded-full bg-secondary/40 overflow-hidden max-w-xs">
                <div
                  className="h-full bg-rose-500 transition-all"
                  style={{ width: `${exportState.progress * 100}%` }}
                />
              </div>
              <span className="text-[11px] text-foreground/60 tabular-nums">
                {Math.round(exportState.progress * 100)}%
              </span>
              {exportState.elapsedMs >= 1000 && (
                <span className="text-[11px] text-foreground/60 tabular-nums">
                  ·{' '}
                  {tx(t.media_studio.export_elapsed, {
                    time: formatDurationHuman(exportState.elapsedMs / 1000),
                  })}
                </span>
              )}
              {exportState.etaMs !== null && (
                <span className="text-[11px] text-foreground/60 tabular-nums">
                  ·{' '}
                  {tx(t.media_studio.export_eta, {
                    time: formatDurationHuman(exportState.etaMs / 1000),
                  })}
                </span>
              )}
              <Button variant="ghost" size="sm" onClick={cancelExport}>
                {t.media_studio.export_cancel}
              </Button>
            </div>
          )}

          <div className="h-[260px] flex-shrink-0">
            <TimelinePanel
              engine={engine}
              textItems={textItems}
              imageItems={imageItems}
              videoItems={videoItems}
              audioItems={audioItems}
              totalDuration={totalDuration}
              selectedId={selectedItemId}
              onSelect={setSelectedItemId}
              onSeek={seek}
              onUpdate={updateItem}
              onAddText={handleAddText}
              onAddImage={handleAddImage}
              onAddVideo={handleAddVideo}
              onAddAudio={handleAddAudio}
              onUndo={undo}
              onRedo={redo}
              canUndo={canUndo}
              canRedo={canRedo}
            />
          </div>

          <PlaybackControls
            engine={engine}
            totalDuration={totalDuration}
            playing={playing}
            looping={looping}
            onPlay={play}
            onPause={pause}
            onStop={stop}
            onSeek={seek}
            onToggleLoop={toggleLoop}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RecentCompositionsRow — surfaces the last few opened/saved compositions on
// the empty state so the user can resume work without walking the file
// dialog. Reads from the persisted MRU list on the artist slice; click loads
// via `persistence.loadFromPath`, which auto-evicts missing files.
// ---------------------------------------------------------------------------

function RecentCompositionsRow({ onLoad }: { onLoad: (path: string) => Promise<void> }) {
  const { t, tx } = useTranslation();
  const recents = useSystemStore((s) => s.mediaStudioRecents);
  if (recents.length === 0) return null;
  return (
    <div className="w-full max-w-2xl flex flex-col items-center gap-2">
      <span className="typo-label text-foreground">{t.media_studio.recent_compositions}</span>
      <div className="flex flex-wrap items-center gap-2 justify-center">
        {recents.map((r) => (
          <button
            key={r.path}
            type="button"
            onClick={() => { void onLoad(r.path); }}
            title={r.path}
            className="flex items-center gap-2 px-3 py-2 rounded-card border border-primary/10 bg-card/50 hover:border-rose-500/30 hover:bg-card/70 transition-colors max-w-xs"
          >
            <Film className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
            <div className="flex flex-col text-left min-w-0">
              <span className="text-md text-foreground truncate">{r.name}</span>
              <span className="text-[11px] text-foreground/60">
                {tx(t.media_studio.recent_saved_ago, { time: formatRelativeSince(r.savedAt) })}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StarterTemplatesRow — a small grid of preset canvas shapes on the empty
// state so users do not have to pick width/height/fps numerically every time
// they start a new composition. Applying a template clears the current
// composition and resets the timeline to the preset's W/H/fps; we only
// render this row when the timeline is already empty, so no work is lost.
// ---------------------------------------------------------------------------

function StarterTemplatesRow({ onApply }: { onApply: (template: StarterTemplate) => void }) {
  const { t } = useTranslation();
  return (
    <div className="w-full max-w-2xl flex flex-col items-center gap-2">
      <span className="typo-label text-foreground">{t.media_studio.starter_templates_title}</span>
      <div className="flex flex-wrap items-center gap-2 justify-center">
        {STARTER_TEMPLATES.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            onClick={() => onApply(tpl)}
            className="flex flex-col items-start gap-0.5 px-3 py-2 rounded-card border border-primary/10 bg-card/50 hover:border-rose-500/30 hover:bg-card/70 transition-colors min-w-[10rem]"
          >
            <span className="text-md text-foreground">{starterTemplateName(tpl.id, t)}</span>
            <span className="text-[11px] text-foreground/60 tabular-nums">
              {tpl.width}×{tpl.height} · {tpl.fps}fps
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

type Translations = ReturnType<typeof useTranslation>['t'];

function starterTemplateName(id: StarterTemplate['id'], t: Translations): string {
  switch (id) {
    case 'vertical-9-16':
      return t.media_studio.template_vertical_9_16_name;
    case 'horizontal-16-9':
      return t.media_studio.template_horizontal_16_9_name;
    case 'square':
      return t.media_studio.template_square_name;
  }
}

function formatRelativeSince(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1_000))}s`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h`;
  return `${Math.round(diff / 86_400_000)}d`;
}

// ---------------------------------------------------------------------------
// ExportSuccessStrip — replaces the in-flight progress bar once an export
// lands so the user can play the file or jump to its folder without
// scrubbing through dialog history. Dismissing returns the strip to idle
// (and the user can start another export the normal way).
// ---------------------------------------------------------------------------

function ExportSuccessStrip({
  outputPath,
  onDismiss,
}: {
  outputPath: string;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();

  // Split off the basename and parent folder once — both are derived from the
  // absolute path Tauri gives us, supporting / and \ separators.
  const sepIdx = Math.max(outputPath.lastIndexOf('/'), outputPath.lastIndexOf('\\'));
  const fileName = sepIdx >= 0 ? outputPath.slice(sepIdx + 1) : outputPath;
  const parentDir = sepIdx >= 0 ? outputPath.slice(0, sepIdx) : outputPath;

  const playFile = () => {
    openExternal(outputPath).catch(silentCatch('Open exported file'));
  };
  const showFolder = () => {
    openExternal(parentDir).catch(silentCatch('Open export folder'));
  };

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-t border-primary/10 bg-emerald-500/5">
      <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
      <span className="text-[11px] text-foreground/80 font-medium">{t.media_studio.export_done}</span>
      <span className="text-[11px] text-foreground/60 font-mono truncate flex-1" title={outputPath}>
        {fileName}
      </span>
      <Button variant="ghost" size="sm" onClick={playFile} title={t.media_studio.export_open_file}>
        <Play className="w-3.5 h-3.5" />
        <span className="hidden md:inline">{t.media_studio.export_open_file}</span>
      </Button>
      <Button variant="ghost" size="sm" onClick={showFolder} title={t.media_studio.export_show_in_folder}>
        <FolderOpen className="w-3.5 h-3.5" />
        <span className="hidden md:inline">{t.media_studio.export_show_in_folder}</span>
      </Button>
      <Button variant="ghost" size="sm" onClick={onDismiss} title={t.media_studio.export_dismiss}>
        <X className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

