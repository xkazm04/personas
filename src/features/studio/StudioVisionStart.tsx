import { useEffect, useState } from 'react';
import { AlertTriangle, Bot, Sparkles } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { webbuildBunStatus } from '@/api/webbuild';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

// Vision-phase project init — the "Build with Athena" from-zero start. The user
// describes what they want; the parent scaffolds + starts the dev server, then
// seeds the build session with this vision so Athena plans it and builds it live
// (doctrine's Vision → Brand → Direction → Foundation spine kicks off here).

// Prompt starters — a blank textarea is the hardest first step; these give the
// user a concrete, editable brief to react to (the doctrine's "react, don't
// author"). Clicking one fills the name + vision; the user tweaks the brackets.
//
// Both the chip label and the brief are things the user READS and edits, so both
// are i18n keys resolved per render. `name` is the scaffolded folder name and
// stays an ASCII slug.
const STARTERS: {
  labelKey: 'starter_portfolio' | 'starter_landing' | 'starter_dashboard' | 'starter_blog';
  visionKey: 'vision_portfolio' | 'vision_landing' | 'vision_dashboard' | 'vision_blog';
  emoji: string;
  name: string;
}[] = [
  { labelKey: 'starter_portfolio', visionKey: 'vision_portfolio', emoji: '🎨', name: 'portfolio' },
  { labelKey: 'starter_landing', visionKey: 'vision_landing', emoji: '🚀', name: 'landing' },
  { labelKey: 'starter_dashboard', visionKey: 'vision_dashboard', emoji: '📊', name: 'dashboard' },
  { labelKey: 'starter_blog', visionKey: 'vision_blog', emoji: '✍️', name: 'blog' },
];

export default function StudioVisionStart({
  onSubmit,
  busy,
  error,
}: {
  onSubmit: (name: string, vision: string) => void;
  busy: boolean;
  /** Last scaffold/create failure (H9) — shown so a failed start isn't silent. */
  error?: string | null;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [vision, setVision] = useState('');
  // H8 preflight — Studio's scaffold + dev server require Bun. Check up front so
  // a missing runtime shows install guidance instead of a mid-scaffold failure.
  //
  // Three outcomes, three answers. The probe used to collapse into a boolean, so
  // a rejected `webbuild_bun_status` was recorded as `bunMissing = false` — a
  // check that could not RUN read exactly like one that passed, and the Build
  // button went live on no evidence. studioStore's own `ensureNextReady` states
  // the rule this now follows: an unknown is not a pass. It is not a hard fail
  // either — the probe can reject for transient IPC reasons — so `unknown` says
  // so and offers a retry rather than silently deciding either way.
  const [bunState, setBunState] = useState<'checking' | 'present' | 'missing' | 'unknown'>(
    'checking',
  );
  const [probe, setProbe] = useState(0);
  useEffect(() => {
    let alive = true;
    setBunState('checking');
    webbuildBunStatus()
      .then((path) => alive && setBunState(path ? 'present' : 'missing'))
      .catch((err) => {
        silentCatch('StudioVisionStart:bunStatus')(err);
        if (alive) setBunState('unknown');
      });
    return () => {
      alive = false;
    };
  }, [probe]);
  const bunMissing = bunState === 'missing';
  const bunUnknown = bunState === 'unknown';

  if (busy) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="flex items-center gap-3 rounded-card border border-border bg-background/80 px-5 py-4 shadow-elevation-2">
          <Bot className="h-5 w-5 text-primary" />
          <span className="text-md text-foreground/80">{t.studio.setting_up}</span>
          <span className="flex gap-0.5">
            <span className="h-1 w-1 animate-pulse rounded-full bg-primary/70" />
            <span className="h-1 w-1 animate-pulse rounded-full bg-primary/70 [animation-delay:150ms]" />
            <span className="h-1 w-1 animate-pulse rounded-full bg-primary/70 [animation-delay:300ms]" />
          </span>
        </div>
      </div>
    );
  }

  const applyStarter = (s: (typeof STARTERS)[number]) => {
    setVision(t.studio[s.visionKey]);
    if (!name.trim()) setName(s.name);
  };

  const canSubmit = name.trim().length > 0 && vision.trim().length > 0;
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto px-6 py-8">
      <div className="w-full max-w-lg rounded-modal border border-border bg-background/70 p-6 shadow-elevation-3">
        <div className="mb-2 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 ring-1 ring-primary/30">
            <Bot className="h-5 w-5 text-primary" />
          </span>
          <div>
            <h2 className="typo-title leading-tight">{t.studio.build_with_athena}</h2>
            <p className="typo-caption text-foreground/55">{t.studio.vision_tagline}</p>
          </div>
        </div>
        <p className="typo-caption mb-4 leading-relaxed">{t.studio.vision_intro}</p>

        <div className="mb-5 flex flex-wrap gap-1.5">
          {STARTERS.map((s) => (
            <button
              key={s.labelKey}
              type="button"
              data-testid="studio-vision-starter"
              onClick={() => applyStarter(s)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-xs text-foreground/80 transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-foreground"
            >
              <span aria-hidden>{s.emoji}</span>
              {t.studio[s.labelKey]}
            </button>
          ))}
        </div>

        <label className="mb-1 block typo-caption text-foreground/70">
          {t.studio.project_name}
        </label>
        <input
          data-testid="studio-vision-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.studio.project_name_placeholder}
          className="mb-4 w-full rounded-input border border-border bg-secondary/40 px-3 py-2 text-md outline-none focus:border-primary/50"
        />

        <label className="mb-1 block typo-caption text-foreground/70">
          {t.studio.what_to_build}
        </label>
        <textarea
          data-testid="studio-vision-text"
          value={vision}
          onChange={(e) => setVision(e.target.value)}
          placeholder={t.studio.vision_portfolio}
          rows={5}
          className="mb-5 w-full resize-none rounded-input border border-border bg-secondary/40 px-3 py-2 text-md leading-relaxed outline-none focus:border-primary/50"
        />

        {bunMissing && (
          <div
            data-testid="studio-vision-bun-missing"
            className="mb-4 flex items-start gap-2 rounded-input border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="leading-relaxed">{t.studio.bun_missing}</span>
          </div>
        )}

        {bunUnknown && (
          <div
            data-testid="studio-vision-bun-unknown"
            className="mb-4 flex items-start gap-2 rounded-input border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1 leading-relaxed">{t.studio.bun_unknown}</span>
            <button
              type="button"
              data-testid="studio-vision-bun-retry"
              onClick={() => setProbe((n) => n + 1)}
              className="shrink-0 rounded-interactive border border-warning/40 px-2 py-0.5 text-xs font-medium text-warning transition-colors hover:bg-warning/20"
            >
              {t.common.retry}
            </button>
          </div>
        )}

        {error && (
          <div
            data-testid="studio-vision-error"
            className="mb-4 flex items-start gap-2 rounded-input border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}

        <Button
          data-testid="studio-vision-submit"
          variant="primary"
          className="w-full"
          icon={<Sparkles className="h-4 w-4" />}
          disabled={!canSubmit || bunMissing || bunUnknown}
          onClick={() => onSubmit(name.trim(), vision.trim())}
        >
          {t.studio.build_with_athena}
        </Button>
      </div>
    </div>
  );
}
