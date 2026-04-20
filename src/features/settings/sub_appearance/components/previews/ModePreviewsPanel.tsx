// PROTOTYPE — Panel exposing the consolidated Simple-mode redesign preview.
// Lives in Settings → Appearance as a temporary design discovery surface.
// Single entry that opens a modal with two visual variants (tab-switched).
import { useState } from 'react';
import { FlaskConical, Sparkles, LayoutGrid, Gauge, Inbox as InboxIcon } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { SimpleModePreview } from './SimpleModePreview';

export function ModePreviewsPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-modal border border-primary/10 bg-card-bg p-6 space-y-4">
      <div className="flex items-center gap-2.5">
        <FlaskConical className="w-4 h-4 text-foreground/70" />
        <h2 className="text-sm font-mono text-foreground uppercase tracking-wider">
          Simple-mode redesign · preview
        </h2>
      </div>
      <p className="text-[11px] text-foreground/60 leading-relaxed">
        Home Base visual identity in three layouts: a spatial mosaic for quick glance, a console
        grid with live inbox for daily use, and a full review-and-decide inbox for deeper
        interaction. Same personas, same outputs, same connections across all three — pick the
        layout that feels right for Simple mode.
      </p>

      <Button
        variant="ghost"
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-4 p-5 rounded-modal border border-violet-500/25 bg-gradient-to-r from-violet-500/5 via-amber-500/[0.03] to-transparent hover:from-violet-500/10 hover:via-amber-500/[0.06] transition-colors text-left"
      >
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500/20 to-amber-500/10 border border-primary/15 flex items-center justify-center shrink-0">
          <Sparkles className="w-6 h-6 text-violet-200" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-foreground">Open Simple-mode preview</div>
          <div className="text-[11px] text-foreground/60 mt-0.5">
            Personas · connectors · outputs — all in one viewport
          </div>
          <div className="flex items-center gap-3 mt-2 text-[10px] text-foreground/50 flex-wrap">
            <span className="inline-flex items-center gap-1">
              <LayoutGrid className="w-3 h-3" /> Mosaic
            </span>
            <span className="text-foreground/20">·</span>
            <span className="inline-flex items-center gap-1">
              <Gauge className="w-3 h-3" /> Console
            </span>
            <span className="text-foreground/20">·</span>
            <span className="inline-flex items-center gap-1">
              <InboxIcon className="w-3 h-3" /> Inbox
            </span>
          </div>
        </div>
        <span className="text-[11px] font-medium text-violet-300 shrink-0">
          Open preview →
        </span>
      </Button>

      <SimpleModePreview isOpen={open} onClose={() => setOpen(false)} />
    </div>
  );
}
