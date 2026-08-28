import { useState, type ReactNode } from 'react';
import { Settings2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useStudioStore } from './studioStore';
import StudioDesignKnobs from './StudioDesignKnobs';
import type { BuildEffort, BuildStyle } from '@/api/webbuild';

// C1 effort knob + C4 voice/style picker — per-project build controls in a small
// popover off the chat input. Writes to the active runtime so every turn (manual,
// seed, or autonomous) picks them up. Effort trades speed for quality; voice sets
// how much Athena explains as she works.
//
// The option tables carry i18n KEY NAMES, not English labels: `value` is a
// backend enum token and must stay stable, while what the user reads is looked
// up per render from the active locale (.claude/rules/i18n.md → "Constants with
// Labels").
const EFFORTS: {
  value: BuildEffort;
  labelKey: 'effort_fast' | 'effort_balanced' | 'effort_deep' | 'effort_max';
}[] = [
  { value: 'low', labelKey: 'effort_fast' },
  { value: 'medium', labelKey: 'effort_balanced' },
  { value: 'high', labelKey: 'effort_deep' },
  { value: 'xhigh', labelKey: 'effort_max' },
];
const STYLES: {
  value: BuildStyle;
  labelKey: 'voice_concise' | 'voice_balanced' | 'voice_teaching';
}[] = [
  { value: 'concise', labelKey: 'voice_concise' },
  { value: 'balanced', labelKey: 'voice_balanced' },
  { value: 'teaching', labelKey: 'voice_teaching' },
];
// C8 — curated MCP connectors (ids must match the Rust registry in webbuild::mcp).
const MCP_CONNECTORS: { id: string; labelKey: 'connector_docs' | 'connector_browser' }[] = [
  { id: 'context7', labelKey: 'connector_docs' },
  { id: 'playwright', labelKey: 'connector_browser' },
];

export default function StudioBuildSettings({ id }: { id: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const effort = useStudioStore((s) => s.runtimes[id]?.effort ?? 'xhigh');
  const style = useStudioStore((s) => s.runtimes[id]?.style ?? 'balanced');
  const gatePlan = useStudioStore((s) => s.runtimes[id]?.gatePlan ?? false);
  const mcp = useStudioStore((s) => s.runtimes[id]?.mcp ?? []);
  const setBuildSettings = useStudioStore((s) => s.setBuildSettings);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        data-testid="studio-settings"
        onClick={() => setOpen((v) => !v)}
        aria-label={t.studio.build_settings}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
          open
            ? 'bg-secondary/60 text-primary'
            : 'text-foreground/55 hover:bg-secondary/60 hover:text-primary'
        }`}
      >
        <Settings2 className="h-4 w-4" />
      </button>
      {/* Click-away dismissal. The panel floats over the live preview and every
          other Studio popover (the tab picker) already closes this way; without
          it the only exit was hitting the gear again. */}
      {open && <div className="fixed inset-0 z-20" aria-hidden onClick={() => setOpen(false)} />}
      {open && (
        <div
          data-testid="studio-settings-panel"
          className="absolute bottom-11 right-0 z-30 w-60 rounded-modal border border-border bg-background/95 p-3 shadow-elevation-4 backdrop-blur"
        >
          <Row label={t.studio.effort} hint={t.studio.effort_hint}>
            {EFFORTS.map((o) => (
              <Seg
                key={o.value}
                active={effort === o.value}
                onClick={() => setBuildSettings(id, { effort: o.value })}
              >
                {t.studio[o.labelKey]}
              </Seg>
            ))}
          </Row>
          <Row label={t.studio.voice} hint={t.studio.voice_hint}>
            {STYLES.map((o) => (
              <Seg
                key={o.value}
                active={style === o.value}
                onClick={() => setBuildSettings(id, { style: o.value })}
              >
                {t.studio[o.labelKey]}
              </Seg>
            ))}
          </Row>
          <Row label={t.studio.plan_first} hint={t.studio.plan_first_hint}>
            <Seg active={!gatePlan} onClick={() => setBuildSettings(id, { gatePlan: false })}>
              {t.studio.plan_first_off}
            </Seg>
            <Seg active={gatePlan} onClick={() => setBuildSettings(id, { gatePlan: true })}>
              {t.studio.plan_first_on}
            </Seg>
          </Row>
          <div className="my-2 border-t border-border/60" />
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="typo-caption text-foreground/70">{t.studio.nudge_the_design}</span>
            <span className="text-[10px] text-foreground/40">{t.studio.applies_now}</span>
          </div>
          <StudioDesignKnobs id={id} onApply={() => setOpen(false)} />
          <div className="my-2 border-t border-border/60" />
          <Row label={t.studio.connectors} hint={t.studio.connectors_hint}>
            {MCP_CONNECTORS.map((c) => {
              const on = mcp.includes(c.id);
              return (
                <Seg
                  key={c.id}
                  active={on}
                  onClick={() =>
                    setBuildSettings(id, {
                      mcp: on ? mcp.filter((m) => m !== c.id) : [...mcp, c.id],
                    })
                  }
                >
                  {t.studio[c.labelKey]}
                </Seg>
              );
            })}
          </Row>
        </div>
      )}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="typo-caption text-foreground/70">{label}</span>
        <span className="text-[10px] text-foreground/40">{hint}</span>
      </div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function Seg({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-interactive px-2 py-0.5 text-xs transition-colors ${
        active ? 'bg-primary/20 text-primary' : 'bg-secondary/40 text-foreground/60 hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}
