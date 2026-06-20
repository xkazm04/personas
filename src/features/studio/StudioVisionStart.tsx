import { useState } from 'react';
import { Bot, Sparkles } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';

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
}: {
  onSubmit: (name: string, vision: string) => void;
  busy: boolean;
  statusLabel?: string;
}) {
  const [name, setName] = useState('');
  const [vision, setVision] = useState('');

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
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="mara-portfolio"
          className="mb-4 w-full rounded-input border border-border bg-secondary/40 px-3 py-2 text-md outline-none focus:border-primary/50"
        />

        <label className="mb-1 block typo-caption text-foreground/70">What do you want to build?</label>
        <textarea
          value={vision}
          onChange={(e) => setVision(e.target.value)}
          placeholder={EXAMPLE}
          rows={5}
          className="mb-5 w-full resize-none rounded-input border border-border bg-secondary/40 px-3 py-2 text-md leading-relaxed outline-none focus:border-primary/50"
        />

        <Button
          variant="primary"
          className="w-full"
          icon={<Sparkles className="h-4 w-4" />}
          disabled={!canSubmit}
          onClick={() => onSubmit(name.trim(), vision.trim())}
        >
          Build with Athena
        </Button>
      </div>
    </div>
  );
}
