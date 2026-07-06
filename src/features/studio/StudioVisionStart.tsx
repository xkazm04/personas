import { useEffect, useState } from 'react';
import { AlertTriangle, Bot, Sparkles } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { webbuildBunStatus } from '@/api/webbuild';

// Vision-phase project init — the "Build with Athena" from-zero start. The user
// describes what they want; the parent scaffolds + starts the dev server, then
// seeds the build session with this vision so Athena plans it and builds it live
// (doctrine's Vision → Brand → Direction → Foundation spine kicks off here).
const EXAMPLE =
  'A portfolio site for Mara, a freelance web developer — dark and modern, with a hero, a few work samples, a short about section, and a contact form.';

export default function StudioVisionStart({
  onSubmit,
  busy,
  statusLabel,
  error,
}: {
  onSubmit: (name: string, vision: string) => void;
  busy: boolean;
  statusLabel?: string;
  /** Last scaffold/create failure (H9) — shown so a failed start isn't silent. */
  error?: string | null;
}) {
  const [name, setName] = useState('');
  const [vision, setVision] = useState('');
  // H8 preflight — Studio's scaffold + dev server require Bun. Check up front so
  // a missing runtime shows install guidance instead of a mid-scaffold failure.
  const [bunMissing, setBunMissing] = useState(false);
  useEffect(() => {
    let alive = true;
    webbuildBunStatus()
      .then((path) => alive && setBunMissing(!path))
      .catch(() => alive && setBunMissing(false));
    return () => {
      alive = false;
    };
  }, []);

  if (busy) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="flex items-center gap-3 rounded-card border border-border bg-background/80 px-5 py-4 shadow-elevation-2">
          <Bot className="h-5 w-5 text-primary" />
          <span className="text-md text-foreground/80">
            {statusLabel ?? 'Setting up your project…'}
          </span>
          <span className="flex gap-0.5">
            <span className="h-1 w-1 animate-pulse rounded-full bg-primary/70" />
            <span className="h-1 w-1 animate-pulse rounded-full bg-primary/70 [animation-delay:150ms]" />
            <span className="h-1 w-1 animate-pulse rounded-full bg-primary/70 [animation-delay:300ms]" />
          </span>
        </div>
      </div>
    );
  }

  const canSubmit = name.trim().length > 0 && vision.trim().length > 0;
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto px-6 py-8">
      <div className="w-full max-w-lg rounded-modal border border-border bg-background/70 p-6 shadow-elevation-3">
        <div className="mb-3 flex items-center gap-2">
          <Bot className="h-6 w-6 text-primary" />
          <h2 className="typo-title">Build with Athena</h2>
        </div>
        <p className="typo-caption mb-5">
          Describe what you want, and Athena will plan it and build it live in the preview — you
          refine it together as it takes shape.
        </p>

        <label className="mb-1 block typo-caption text-foreground/70">Project name</label>
        <input
          data-testid="studio-vision-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="mara-portfolio"
          className="mb-4 w-full rounded-input border border-border bg-secondary/40 px-3 py-2 text-md outline-none focus:border-primary/50"
        />

        <label className="mb-1 block typo-caption text-foreground/70">What do you want to build?</label>
        <textarea
          data-testid="studio-vision-text"
          value={vision}
          onChange={(e) => setVision(e.target.value)}
          placeholder={EXAMPLE}
          rows={5}
          className="mb-5 w-full resize-none rounded-input border border-border bg-secondary/40 px-3 py-2 text-md leading-relaxed outline-none focus:border-primary/50"
        />

        {bunMissing && (
          <div
            data-testid="studio-vision-bun-missing"
            className="mb-4 flex items-start gap-2 rounded-input border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="leading-relaxed">
              Bun isn&apos;t installed — Studio needs it to scaffold and run projects. Install it
              from bun.sh (or set PERSONAS_BUN_BIN), then restart the app.
            </span>
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
          disabled={!canSubmit || bunMissing}
          onClick={() => onSubmit(name.trim(), vision.trim())}
        >
          Build with Athena
        </Button>
      </div>
    </div>
  );
}
