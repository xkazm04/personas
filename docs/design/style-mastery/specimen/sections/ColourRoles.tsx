// Section c: colour roles. Status as it is, the value-named accents the app
// writes today, and the four proposed meaning-named roles, each on text, a
// chip and a rule, with the active theme's contrast.
import { Section, Split, type View } from '../parts';
import { ROLES, STATUSES, type ThemeName } from '../specimenData';
import contrast from '../contrast.generated.json';
import measure from '../measure.generated.json';
import { ThemeMatrix } from './ThemeMatrix';

// Spelled out in full: these are the exact strings the app ships
// (statusTokens.ts STATUS_PALETTE and Button.tsx ACCENT_CLASSES).
const STATUS_RAW: Record<(typeof STATUSES)[number], string> = {
  success: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  warning: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  error: 'text-red-400 bg-red-500/10 border-red-500/30',
  info: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
};
const STATUS_TOKEN: Record<(typeof STATUSES)[number], string> = {
  success: 'text-status-success bg-status-success/10 border-status-success/30',
  warning: 'text-status-warning bg-status-warning/10 border-status-warning/30',
  error: 'text-status-error bg-status-error/10 border-status-error/30',
  info: 'text-status-info bg-status-info/10 border-status-info/30',
};
const ACCENTS: [string, string][] = [
  ['violet', 'border-violet-500/25 bg-violet-500/10 text-violet-400'],
  ['emerald', 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400'],
  ['amber', 'border-amber-500/25 bg-amber-500/10 text-amber-400'],
  ['rose', 'border-rose-500/25 bg-rose-500/10 text-rose-400'],
  ['indigo', 'border-indigo-500/25 bg-indigo-500/10 text-indigo-400'],
  ['cyan', 'border-cyan-500/25 bg-cyan-500/10 text-cyan-400'],
];
const ROLE_CLASSES: Record<(typeof ROLES)[number]['id'], { text: string; chip: string; rule: string }> = {
  agent: { text: 'text-role-agent', chip: 'bg-role-agent/10 text-role-agent border-role-agent/30', rule: 'border-role-agent/30' },
  human: { text: 'text-role-human', chip: 'bg-role-human/10 text-role-human border-role-human/30', rule: 'border-role-human/30' },
  external: { text: 'text-role-external', chip: 'bg-role-external/10 text-role-external border-role-external/30', rule: 'border-role-external/30' },
  highlight: { text: 'text-role-highlight', chip: 'bg-role-highlight/10 text-role-highlight border-role-highlight/30', rule: 'border-role-highlight/30' },
};
const accentUses = measure.accentColor as Record<string, number>;

function Chip({ cls, children }: { cls: string; children: string }) {
  return <span className={`sp-chip typo-label ${cls}`}>{children}</span>;
}

export function ColourRoles({ view, theme }: { view: View; theme: ThemeName }) {
  const t = contrast.themes[theme];
  return (
    <Section id="colour" title="Colour roles" note="Names are meanings. Ratios: text on canvas / on its own chip / on a card.">
      <Split view={view}>
        {(mode) => (
          <div className="sp-stack-lg">
            <div className="typo-heading text-foreground">Status (kept)</div>
            <div className="sp-grid">
              {STATUSES.map((s) => {
                const g = (t.status as Record<string, { onBg: number; onChip: number; onCard: number } | undefined>)[s];
                return (
                  <div key={s} className="sp-swatch" data-role={`status-${s}`}>
                    <span className={`typo-heading ${mode === 'current' ? STATUS_RAW[s].split(' ')[0] : `text-status-${s}`}`}>{s}</span>
                    <Chip cls={mode === 'current' ? STATUS_RAW[s] : STATUS_TOKEN[s]}>{s === 'error' ? 'Failed' : s === 'warning' ? 'Needs review' : s === 'success' ? 'Delivered' : 'Queued'}</Chip>
                    <span className="typo-caption tabular-nums">
                      {mode === 'current' ? 'STATUS_PALETTE raw steps' : g ? `${g.onBg} / ${g.onChip} / ${g.onCard}` : 'n/a'}
                    </span>
                  </div>
                );
              })}
            </div>
            {mode === 'current' ? (
              <>
                <div className="typo-heading text-foreground">Accents today: value names</div>
                <div className="sp-grid">
                  {ACCENTS.map(([name, cls]) => (
                    <div key={name} className="sp-swatch">
                      <Chip cls={cls}>{`accentColor="${name}"`}</Chip>
                      <span className="typo-caption">{accentUses[name] ?? 0} Button sites. The name says the hue, not the meaning.</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="typo-heading text-foreground">Roles (proposed)</div>
                <div className="sp-grid">
                  {ROLES.map((r) => {
                    const g = (t.roles as Record<string, { onBg: number; onChip: number; onCard: number; hex: string } | null>)[r.id];
                    const c = ROLE_CLASSES[r.id];
                    return (
                      <div key={r.id} className="sp-swatch" data-role={`role-${r.id}`}>
                        <span className={`typo-heading ${c.text}`}>role-{r.id}</span>
                        <Chip cls={c.chip}>{r.id === 'agent' ? 'Drafted by agent' : r.id === 'human' ? 'Your review' : r.id === 'external' ? 'Gmail connector' : 'Selected'}</Chip>
                        <div className={`sp-rule ${c.rule}`} />
                        <span className="typo-caption">{r.meaning}</span>
                        <span className="typo-caption tabular-nums">{g ? `${g.hex}: ${g.onBg} / ${g.onChip} / ${g.onCard}` : 'unbound'}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </Split>
      <ThemeMatrix />
    </Section>
  );
}
