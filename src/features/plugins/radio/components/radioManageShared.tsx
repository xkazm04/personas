import { Info, Loader2, Pause, Play, Power, RotateCcw } from 'lucide-react';
import type { Station } from '@/lib/bindings/Station';
import type { RadioState } from '@/lib/bindings/RadioState';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Shared building blocks for the Radio management surface (the Settings → Radio
 * "Console" layout). Kept separate so the page + any future variant share one
 * `RadioVariantProps` shape and the same station-grouping / preview controls.
 */
export interface RadioVariantProps {
  stations: Station[];
  state: RadioState | null;
  previewingId: string | null;
  bufferingId: string | null;
  onPreview: (stationId: string) => void;
  radioEnabled: boolean;
  setRadioEnabled: (v: boolean) => void;
  radioAutoResume: boolean;
  setRadioAutoResume: (v: boolean) => void;
  disabledStationIds: string[];
  setStationDisabled: (id: string, disabled: boolean) => void;
}

export interface StationGroup {
  /** Provider brand, used as the group heading (e.g. "SomaFM", "YouTube"). */
  label: string;
  isYouTube: boolean;
  stations: Station[];
}

/**
 * Description / secondary lines render at a light weight. The `typo-caption`
 * token is `font-weight: 500` (heavier than the `typo-body` 400 title), and it
 * is authored unlayered so a Tailwind `font-light` utility can't override it —
 * hence the inline weight. Keeps a title/description pair from inverting.
 */
export const DESC_STYLE = { fontWeight: 300 } as const;

/**
 * Title / primary lines render semibold (600) so a title sits clearly above its
 * thin (300) description. Same reason as `DESC_STYLE`: a `font-medium` utility
 * loses to the unlayered `typo-body` token (400), so the weight is set inline.
 */
export const TITLE_STYLE = { fontWeight: 600 } as const;

/** Group stations by provider (SomaFM streams first, YouTube last). */
export function groupStations(stations: Station[]): StationGroup[] {
  const byLabel = new Map<string, Station[]>();
  for (const s of stations) {
    const label = s.sourceLabel ?? (s.source.kind === 'youtubeTracks' ? 'YouTube' : 'Streams');
    const list = byLabel.get(label) ?? [];
    list.push(s);
    byLabel.set(label, list);
  }
  const groups: StationGroup[] = [];
  for (const [label, list] of byLabel) {
    groups.push({ label, isYouTube: /youtube/i.test(label), stations: list });
  }
  // SomaFM (and any other stream provider) first; YouTube last.
  groups.sort((a, b) => Number(a.isYouTube) - Number(b.isYouTube) || a.label.localeCompare(b.label));
  return groups;
}

export function trackCount(s: Station): number | null {
  return s.source.kind === 'youtubeTracks' ? s.source.tracks.length : null;
}

/** "YouTube needs Premium for ad-free" advisory shown on the YouTube group. */
export function YouTubePremiumNote() {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2 rounded-card border border-amber-500/20 bg-amber-500/5 px-3 py-2">
      <Info className="w-4 h-4 text-amber-400 mt-px shrink-0" />
      <p className="typo-caption text-foreground" style={DESC_STYLE}>{t.radio.youtube_premium_note}</p>
    </div>
  );
}

/** Master power + auto-resume row, shared by the management surface. */
export function RadioMasterControls({
  radioEnabled,
  setRadioEnabled,
  radioAutoResume,
  setRadioAutoResume,
}: Pick<RadioVariantProps, 'radioEnabled' | 'setRadioEnabled' | 'radioAutoResume' | 'setRadioAutoResume'>) {
  const { t } = useTranslation();
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <div className="flex items-center justify-between gap-3 rounded-card border border-primary/10 bg-secondary/10 px-3 py-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <Power className={`w-4 h-4 shrink-0 ${radioEnabled ? 'text-emerald-400' : 'text-foreground/50'}`} />
          <div className="min-w-0">
            <p className="typo-body font-medium text-foreground" style={TITLE_STYLE}>{t.radio.master_footer_title}</p>
            <p className="typo-caption text-foreground" style={DESC_STYLE}>{t.radio.master_footer_desc}</p>
          </div>
        </div>
        <AccessibleToggle checked={radioEnabled} onChange={() => setRadioEnabled(!radioEnabled)} label={t.radio.enable_label} />
      </div>
      <div
        className={`flex items-center justify-between gap-3 rounded-card border border-primary/10 bg-secondary/10 px-3 py-2.5 transition-opacity ${
          radioEnabled ? '' : 'opacity-50 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <RotateCcw className="w-4 h-4 shrink-0 text-foreground" />
          <div className="min-w-0">
            <p className="typo-body font-medium text-foreground" style={TITLE_STYLE}>{t.radio.master_resume_title}</p>
            <p className="typo-caption text-foreground" style={DESC_STYLE}>{t.radio.master_resume_desc}</p>
          </div>
        </div>
        <AccessibleToggle checked={radioAutoResume} onChange={() => setRadioAutoResume(!radioAutoResume)} label={t.radio.auto_resume_label} />
      </div>
    </div>
  );
}

/** Round preview/play control. Shows play → buffering spinner → pause. */
export function PreviewButton({
  accentColor,
  isPreviewing,
  isBuffering,
  onClick,
  size = 'md',
}: {
  accentColor: string;
  isPreviewing: boolean;
  isBuffering: boolean;
  onClick: () => void;
  size?: 'sm' | 'md';
}) {
  const { t } = useTranslation();
  const label = isPreviewing ? t.radio.preview_stop : t.radio.preview_play;
  const dim = size === 'sm' ? 'w-8 h-8' : 'w-10 h-10';
  const icon = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`${dim} rounded-full flex items-center justify-center shrink-0 border transition-colors`}
      style={{
        borderColor: isPreviewing ? accentColor : 'transparent',
        background: isPreviewing ? `${accentColor}22` : 'rgba(255,255,255,0.06)',
        color: isPreviewing ? accentColor : undefined,
      }}
    >
      {isBuffering ? (
        <Loader2 className={`${icon} animate-spin`} style={{ color: accentColor }} />
      ) : isPreviewing ? (
        <Pause className={icon} />
      ) : (
        <Play className={icon} />
      )}
    </button>
  );
}
